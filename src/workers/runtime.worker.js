// Web Worker: Sandboxed Execution Runtime for compiled a.out
// Implements WASI syscalls and synchronous stdin using SharedArrayBuffer & Atomics.wait()

import { createRaylibHost } from '../toolchain/raylib-host.js';

const STATE_IDLE = 0;
const STATE_WAITING = 1;
const STATE_READY = 2;
const STATE_EOF = -1;

const CONTROL_STATE_IDX = 0;
const CONTROL_LEN_IDX = 1;
const CONTROL_READ_POS_IDX = 2;

const DATA_OFFSET = 16; // Byte offset in SharedArrayBuffer for stdin input data

let sharedInt32 = null;
let sharedUint8 = null;

class ProcExit extends Error {
  constructor(code) {
    super(`Exited with code ${code}`);
    this.code = code;
  }
}

const ESUCCESS = 0;
const EBADF = 8;
const ENOENT = 44;
const ENOSYS = 52;

function readStr(u8, offset, len) {
  let str = '';
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(u8[offset + i]);
  }
  return str;
}

let currentMouseX = -1;
let currentMouseY = -1;
let currentMouseButtons = 0;
let currentMouseWheel = 0;
const currentKeysDown = new Uint8Array(512);

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'input_event' && msg.event) {
    if (msg.event.type === 'mouse') {
      currentMouseX = msg.event.x;
      currentMouseY = msg.event.y;
      currentMouseButtons = msg.event.buttons;
      currentMouseWheel = msg.event.wheel;
    } else if (msg.event.type === 'keydown') {
      if (msg.event.key >= 0 && msg.event.key < 512) {
        currentKeysDown[msg.event.key] = 1;
      }
    } else if (msg.event.type === 'keyup') {
      if (msg.event.key >= 0 && msg.event.key < 512) {
        currentKeysDown[msg.event.key] = 0;
      }
    } else if (msg.event.type === 'blur') {
      currentKeysDown.fill(0);
      currentMouseButtons = 0;
    }
    return;
  }

  if (msg.type === 'run') {
    const { wasmBytes, sharedBuffer, argv = ['./a.out'], environ = {}, stdinBytes, raylibSharedBuffer } = msg;

    if (sharedBuffer) {
      sharedInt32 = new Int32Array(sharedBuffer);
      sharedUint8 = new Uint8Array(sharedBuffer);
    }

    try {
      await runWasm(wasmBytes, argv, environ, stdinBytes, raylibSharedBuffer);
      self.postMessage({ type: 'done', exitCode: 0 });
    } catch (err) {
      if (err instanceof ProcExit) {
        self.postMessage({ type: 'done', exitCode: err.code });
      } else {
        self.postMessage({ type: 'error', error: err.message, stack: err.stack });
      }
    }
  }
};

async function runWasm(wasmBytes, argv, environ, stdinBytes = null, raylibSharedBuffer = null) {
  let memoryInstance = null;
  let stdinPos = 0;
  const preloadedStdin = stdinBytes ? (stdinBytes instanceof Uint8Array ? stdinBytes : new Uint8Array(stdinBytes)) : null;

  function memU8() {
    return new Uint8Array(memoryInstance.buffer);
  }
  function memU32() {
    return new Uint32Array(memoryInstance.buffer);
  }

  // Blocking synchronous stdin handler using Atomics or preloaded buffer
  function readStdin(iovs, iovs_len, nread_out) {
    if (preloadedStdin) {
      let totalRead = 0;
      for (let i = 0; i < iovs_len; i++) {
        const bufPtr = memU32()[(iovs >> 2) + i * 2];
        const bufLen = memU32()[(iovs >> 2) + i * 2 + 1];
        const available = preloadedStdin.length - stdinPos;
        if (available > 0) {
          const toCopy = Math.min(bufLen, available);
          memU8().set(preloadedStdin.subarray(stdinPos, stdinPos + toCopy), bufPtr);
          stdinPos += toCopy;
          totalRead += toCopy;
          break;
        }
      }
      memU32()[nread_out >> 2] = totalRead;
      return ESUCCESS;
    }

    let totalRead = 0;

    for (let i = 0; i < iovs_len; i++) {
      const bufPtr = memU32()[(iovs >> 2) + i * 2];
      const bufLen = memU32()[(iovs >> 2) + i * 2 + 1];

      let available = 0;
      let curLen = 0;
      let curPos = 0;

      if (sharedInt32) {
        curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
        curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        available = curLen - curPos;
      }

      if (available <= 0 && sharedInt32) {
        // Notify host that we are blocked waiting for stdin input
        self.postMessage({ type: 'stdin_request' });

        // Set state to WAITING
        Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_WAITING);

        // Synchronously block worker until main thread issues Atomics.notify()
        Atomics.wait(sharedInt32, CONTROL_STATE_IDX, STATE_WAITING);

        const state = Atomics.load(sharedInt32, CONTROL_STATE_IDX);
        if (state === STATE_EOF) {
          break;
        }

        curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
        curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        available = curLen - curPos;
      }

      if (available > 0 && sharedInt32) {
        curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        const toCopy = Math.min(bufLen, available);
        const target = memU8().subarray(bufPtr, bufPtr + toCopy);
        const source = sharedUint8.subarray(DATA_OFFSET + curPos, DATA_OFFSET + curPos + toCopy);

        target.set(source);
        Atomics.add(sharedInt32, CONTROL_READ_POS_IDX, toCopy);
        totalRead += toCopy;
      }

      if (totalRead > 0) break;
    }

    memU32()[nread_out >> 2] = totalRead;
    return ESUCCESS;
  }

  const wasi = {
    proc_exit(code) {
      throw new ProcExit(code);
    },

    fd_write(fd, iovs, iovs_len, nwritten_out) {
      let totalWritten = 0;
      let text = '';

      for (let i = 0; i < iovs_len; i++) {
        const ptr = memU32()[(iovs >> 2) + i * 2];
        const len = memU32()[(iovs >> 2) + i * 2 + 1];
        text += readStr(memU8(), ptr, len);
        totalWritten += len;
      }

      memU32()[nwritten_out >> 2] = totalWritten;

      if (fd === 1 || fd === 2) {
        self.postMessage({ type: 'stdout', data: text });
        return ESUCCESS;
      }

      return EBADF;
    },

    fd_read(fd, iovs, iovs_len, nread_out) {
      if (fd === 0) {
        return readStdin(iovs, iovs_len, nread_out);
      }
      memU32()[nread_out >> 2] = 0;
      return EBADF;
    },

    fd_close() { return ESUCCESS; },
    fd_seek() { return ESUCCESS; },
    fd_fdstat_get(fd, stat_out) {
      memU8().fill(0, stat_out, stat_out + 24);
      if (fd === 0 || fd === 1 || fd === 2) {
        memU8()[stat_out] = 2; // __WASI_FILETYPE_CHARACTER_DEVICE (identifies tty streams)
      }
      return ESUCCESS;
    },
    fd_fdstat_set_flags() { return ESUCCESS; },
    fd_fdstat_set_rights() { return ESUCCESS; },
    fd_filestat_get(fd, stat_out) {
      memU8().fill(0, stat_out, stat_out + 64);
      return ESUCCESS;
    },
    fd_filestat_set_size() { return ESUCCESS; },
    fd_filestat_set_times() { return ESUCCESS; },
    fd_pread() { return EBADF; },
    fd_pwrite() { return EBADF; },
    fd_tell() { return ESUCCESS; },
    fd_sync() { return ESUCCESS; },
    fd_datasync() { return ESUCCESS; },
    fd_allocate() { return ESUCCESS; },
    fd_advise() { return ESUCCESS; },
    fd_readdir() { return ESUCCESS; },
    fd_renumber() { return EBADF; },

    fd_prestat_get() { return EBADF; },
    fd_prestat_dir_name() { return EBADF; },

    path_open() { return ENOENT; },
    path_filestat_get() { return ENOENT; },
    path_filestat_set_times() { return ENOENT; },
    path_create_directory() { return ESUCCESS; },
    path_link() { return ENOENT; },
    path_readlink() { return ENOENT; },
    path_rename() { return ENOENT; },
    path_symlink() { return ENOENT; },
    path_unlink_file() { return ENOENT; },
    path_remove_directory() { return ENOENT; },

    environ_sizes_get(count_out, size_out) {
      const keys = Object.keys(environ);
      let size = 0;
      for (const k of keys) {
        size += k.length + environ[k].length + 2;
      }
      memU32()[count_out >> 2] = keys.length;
      memU32()[size_out >> 2] = size;
      return ESUCCESS;
    },

    environ_get(ptrs, buf) {
      let b = buf;
      let p = ptrs >> 2;
      for (const k of Object.keys(environ)) {
        memU32()[p++] = b;
        const entry = `${k}=${environ[k]}\0`;
        for (let i = 0; i < entry.length; i++) {
          memU8()[b++] = entry.charCodeAt(i);
        }
      }
      return ESUCCESS;
    },

    args_sizes_get(argc_out, size_out) {
      let size = 0;
      for (const a of argv) {
        size += a.length + 1;
      }
      memU32()[argc_out >> 2] = argv.length;
      memU32()[size_out >> 2] = size;
      return ESUCCESS;
    },

    args_get(ptrs, buf) {
      let b = buf;
      let p = ptrs >> 2;
      for (const a of argv) {
        memU32()[p++] = b;
        for (let i = 0; i < a.length; i++) {
          memU8()[b++] = a.charCodeAt(i);
        }
        memU8()[b++] = 0;
      }
      return ESUCCESS;
    },

    clock_time_get(clock_id, precision, time_out) {
      const now = BigInt(Date.now()) * 1000000n;
      const view = new BigInt64Array(memoryInstance.buffer);
      view[time_out >> 3] = now;
      return ESUCCESS;
    },

    clock_res_get(clock_id, res_out) {
      const view = new BigInt64Array(memoryInstance.buffer);
      view[res_out >> 3] = 1000n;
      return ESUCCESS;
    },

    random_get(buf, len) {
      crypto.getRandomValues(memU8().subarray(buf, buf + len));
      return ESUCCESS;
    },

    poll_oneoff() { return ESUCCESS; },
    sched_yield() { return ESUCCESS; },
  };

  const wasiProxy = new Proxy(wasi, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => ESUCCESS;
    }
  });

  const env = {
    getcwd(buf, size) {
      const cwd = '/workspace';
      if (!buf || size <= 0) return 0;
      const len = Math.min(size - 1, cwd.length);
      for (let i = 0; i < len; i++) {
        memU8()[buf + i] = cwd.charCodeAt(i);
      }
      memU8()[buf + len] = 0;
      return buf;
    },
    chdir() { return 0; },
    time(time_out) {
      const sec = Math.floor(Date.now() / 1000);
      if (time_out) {
        memU32()[time_out >> 2] = sec;
      }
      return sec;
    },
    __assert_fail() {
      return 0;
    },
  };

  const envProxy = new Proxy(env, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => 0;
    }
  });

  const module = await WebAssembly.compile(wasmBytes);
  const importsList = WebAssembly.Module.imports(module);
  const hasRaylib = importsList.some(i => i.module === 'raylib' || i.module === 'gl');

  const importObject = {
    wasi_snapshot_preview1: wasiProxy,
    wasi_unstable: wasiProxy,
    env: envProxy,
  };

  let raylibHost = null;

  let gfxWidth = 800;
  let gfxHeight = 450;
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let lastFpsTime = performance.now();

  let offscreen2d = null;
  let ctx2d = null;

  const get2dContext = () => {
    if (!offscreen2d && typeof OffscreenCanvas !== 'undefined') {
      offscreen2d = new OffscreenCanvas(gfxWidth, gfxHeight);
      ctx2d = offscreen2d.getContext('2d');
    } else if (offscreen2d && (offscreen2d.width !== gfxWidth || offscreen2d.height !== gfxHeight)) {
      offscreen2d.width = gfxWidth;
      offscreen2d.height = gfxHeight;
    }
    return ctx2d;
  };

  const decodeStr = (ptr) => {
    if (!ptr || !memoryInstance) return '';
    try {
      const u8 = new Uint8Array(memoryInstance.buffer, ptr);
      let end = 0;
      while (u8[end] !== 0) end++;
      return new TextDecoder('utf-8').decode(new Uint8Array(memoryInstance.buffer, ptr, end));
    } catch (_) {
      return '';
    }
  };


  const finishPresent = () => {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      self.postMessage({ type: 'fps', fps });
      frameCount = 0;
      lastFpsTime = now;
    }
  };

  const presentBuffer = (ptr, w, h) => {
    if (!memoryInstance || !ptr || w <= 0 || h <= 0) return;
    const byteLen = w * h * 4;
    try {
      const ctx = get2dContext();
      if (ctx && offscreen2d) {
        if (offscreen2d.width !== w || offscreen2d.height !== h) {
          offscreen2d.width = w;
          offscreen2d.height = h;
        }
        const imgData = ctx.createImageData(w, h);
        imgData.data.set(new Uint8Array(memoryInstance.buffer, ptr, byteLen));
        ctx.putImageData(imgData, 0, 0);

        if (typeof offscreen2d.transferToImageBitmap === 'function') {
          try {
            const bitmap = offscreen2d.transferToImageBitmap();
            if (bitmap) {
              self.postMessage({ type: 'frame', bitmap }, [bitmap]);
              finishPresent();
              return;
            }
          } catch (_) {}
        }
      }

      // Synchronous transferable ArrayBuffer fallback for environments without 2D transferToImageBitmap
      const copyBuffer = memoryInstance.buffer.slice(ptr, ptr + byteLen);
      self.postMessage({ type: 'frame_buffer', buffer: copyBuffer, width: w, height: h }, [copyBuffer]);
    } catch (_) {}

    finishPresent();
  };

  const genericGraphics = {
    graphics_init: (w, h, titlePtr) => {
      gfxWidth = w > 0 ? w : 800;
      gfxHeight = h > 0 ? h : 450;
      if (offscreen2d) {
        offscreen2d.width = gfxWidth;
        offscreen2d.height = gfxHeight;
      }
      let titleStr = decodeStr(titlePtr) || 'Graphics Display';
      self.postMessage({ type: 'graphics_init', width: gfxWidth, height: gfxHeight, title: titleStr });
    },

    graphics_present: (pixelsPtr) => {
      presentBuffer(pixelsPtr, gfxWidth, gfxHeight);
    },

    graphics_present_rgba: (rgbaPtr, w, h) => {
      presentBuffer(rgbaPtr, w, h);
    },

    graphics_wait_frame: (targetFps) => {
      const fps = targetFps > 0 ? targetFps : 60;
      const targetDelta = 1000 / fps;
      const now = performance.now();
      const elapsed = now - lastFrameTime;
      const waitMs = Math.max(1, Math.floor(targetDelta - elapsed));
      if (raylibSharedBuffer && typeof Atomics !== 'undefined') {
        const syncWord = new Int32Array(raylibSharedBuffer, 372, 1);
        Atomics.wait(syncWord, 0, 0, Math.min(waitMs, 50));
      }
      lastFrameTime = performance.now();
    },

    graphics_should_close: () => {
      if (raylibSharedBuffer) {
        const v = new DataView(raylibSharedBuffer);
        return v.getInt32(20, true) !== 0 ? 1 : 0;
      }
      return 0;
    },

    graphics_close: () => {
      self.postMessage({ type: 'graphics_close' });
    },

    graphics_get_mouse: (xPtr, yPtr, btnPtr, wheelPtr) => {
      let mx = -1;
      let my = -1;
      let btn = 0;
      let wheel = 0;

      if (raylibSharedBuffer) {
        const v = new DataView(raylibSharedBuffer);
        mx = Math.round(v.getFloat32(24, true));
        my = Math.round(v.getFloat32(28, true));
        wheel = Math.round(v.getFloat32(36, true));
        btn = v.getUint32(40, true);
      } else {
        mx = currentMouseX;
        my = currentMouseY;
        btn = currentMouseButtons;
        wheel = currentMouseWheel;
      }

      if (memoryInstance) {
        const memView = new DataView(memoryInstance.buffer);
        if (xPtr) memView.setInt32(xPtr, mx, true);
        if (yPtr) memView.setInt32(yPtr, my, true);
        if (btnPtr) memView.setUint32(btnPtr, btn, true);
        if (wheelPtr) memView.setInt32(wheelPtr, wheel, true);
      }
    },

    graphics_is_key_down: (key) => {
      if (raylibSharedBuffer && key >= 0 && key < 512) {
        const v = new DataView(raylibSharedBuffer);
        const word = Math.floor(key / 32);
        const bit = key % 32;
        const wordVal = v.getUint32(44 + word * 4, true);
        if ((wordVal >>> bit) & 1) return 1;
      }
      if (key >= 0 && key < 512) {
        return currentKeysDown[key] ? 1 : 0;
      }
      return 0;
    },

    /* --- HTML5 Canvas 2D Vector Primitives --- */
    canvas_present: () => {
      if (!offscreen2d) return;
      if (typeof offscreen2d.transferToImageBitmap === 'function') {
        try {
          const bitmap = offscreen2d.transferToImageBitmap();
          if (bitmap) {
            self.postMessage({ type: 'frame', bitmap }, [bitmap]);
            finishPresent();
            return;
          }
        } catch (_) {}
      }
      if (typeof createImageBitmap !== 'undefined') {
        createImageBitmap(offscreen2d).then((bitmap) => {
          self.postMessage({ type: 'frame', bitmap }, [bitmap]);
        }).catch(() => {});
      }
      finishPresent();
    },

    canvas_clear_rect: (x, y, w, h) => {
      const ctx = get2dContext();
      if (ctx) ctx.clearRect(x, y, w, h);
    },

    canvas_fill_rect: (x, y, w, h) => {
      const ctx = get2dContext();
      if (ctx) ctx.fillRect(x, y, w, h);
    },

    canvas_stroke_rect: (x, y, w, h) => {
      const ctx = get2dContext();
      if (ctx) ctx.strokeRect(x, y, w, h);
    },

    canvas_begin_path: () => {
      const ctx = get2dContext();
      if (ctx) ctx.beginPath();
    },

    canvas_close_path: () => {
      const ctx = get2dContext();
      if (ctx) ctx.closePath();
    },

    canvas_move_to: (x, y) => {
      const ctx = get2dContext();
      if (ctx) ctx.moveTo(x, y);
    },

    canvas_line_to: (x, y) => {
      const ctx = get2dContext();
      if (ctx) ctx.lineTo(x, y);
    },

    canvas_arc: (x, y, radius, startAngle, endAngle, counterclockwise) => {
      const ctx = get2dContext();
      if (ctx) ctx.arc(x, y, radius, startAngle, endAngle, Boolean(counterclockwise));
    },

    canvas_fill: () => {
      const ctx = get2dContext();
      if (ctx) ctx.fill();
    },

    canvas_stroke: () => {
      const ctx = get2dContext();
      if (ctx) ctx.stroke();
    },

    canvas_set_fill_style: (stylePtr) => {
      const ctx = get2dContext();
      if (ctx) ctx.fillStyle = decodeStr(stylePtr);
    },

    canvas_set_stroke_style: (stylePtr) => {
      const ctx = get2dContext();
      if (ctx) ctx.strokeStyle = decodeStr(stylePtr);
    },

    canvas_set_fill_rgb: (r, g, b) => {
      const ctx = get2dContext();
      if (ctx) ctx.fillStyle = `rgb(${r & 255},${g & 255},${b & 255})`;
    },

    canvas_set_line_width: (width) => {
      const ctx = get2dContext();
      if (ctx) ctx.lineWidth = width;
    },

    canvas_set_line_cap: (capPtr) => {
      const ctx = get2dContext();
      if (ctx) ctx.lineCap = decodeStr(capPtr);
    },

    canvas_fill_text: (textPtr, x, y) => {
      const ctx = get2dContext();
      if (ctx) ctx.fillText(decodeStr(textPtr), x, y);
    },

    canvas_stroke_text: (textPtr, x, y) => {
      const ctx = get2dContext();
      if (ctx) ctx.strokeText(decodeStr(textPtr), x, y);
    },

    canvas_set_font: (fontPtr) => {
      const ctx = get2dContext();
      if (ctx) ctx.font = decodeStr(fontPtr);
    },

    canvas_save: () => {
      const ctx = get2dContext();
      if (ctx) ctx.save();
    },

    canvas_restore: () => {
      const ctx = get2dContext();
      if (ctx) ctx.restore();
    },

    canvas_translate: (x, y) => {
      const ctx = get2dContext();
      if (ctx) ctx.translate(x, y);
    },

    canvas_rotate: (rad) => {
      const ctx = get2dContext();
      if (ctx) ctx.rotate(rad);
    },

    canvas_scale: (sx, sy) => {
      const ctx = get2dContext();
      if (ctx) ctx.scale(sx, sy);
    },
  };

  importObject.graphics = new Proxy(genericGraphics, {
    get(t, p) {
      if (p in t) return t[p];
      return () => 0;
    }
  });
  importObject.fb = importObject.graphics;
  importObject.canvas = importObject.graphics;

  // Also bind to env for programs linking graphics_* / canvas_* into default env module
  for (const [name, fn] of Object.entries(genericGraphics)) {
    env[name] = fn;
  }

  if (hasRaylib && typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(800, 450);
    const gl = offscreen.getContext('webgl', {
      alpha: false,
      depth: true,
      stencil: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    raylibHost = createRaylibHost({
      canvas: offscreen,
      gl,
      sharedBuffer: raylibSharedBuffer,
      width: 800,
      height: 450,
      print: (text) => self.postMessage({ type: 'stdout', data: text }),
      printErr: (text) => self.postMessage({ type: 'stdout', data: text }),
      onFrame: (bitmap) => {
        if (bitmap) {
          self.postMessage({ type: 'frame', bitmap }, [bitmap]);
        }
      },
      onFPS: (fps) => {
        self.postMessage({ type: 'fps', fps });
      },
      onClose: () => {
        self.postMessage({ type: 'graphics_close' });
      },
    });

    const raylibImports = raylibHost.getImports();
    importObject.gl = new Proxy(raylibImports.gl, {
      get(t, p) {
        if (p in t) return t[p];
        return () => 0;
      }
    });
    importObject.raylib = new Proxy({
      ...raylibImports.raylib,
      raylib_host_init_window: (w, h, titlePtr) => {
        if (offscreen) {
          offscreen.width = w;
          offscreen.height = h;
        }
        const res = raylibImports.raylib.raylib_host_init_window(w, h, titlePtr);
        let titleStr = 'Graphics Display';
        try {
          if (titlePtr && memoryInstance) {
            const u8 = new Uint8Array(memoryInstance.buffer, titlePtr);
            let end = 0;
            while (u8[end] !== 0) end++;
            titleStr = new TextDecoder('utf-8').decode(new Uint8Array(memoryInstance.buffer, titlePtr, end));
          }
        } catch (_) {}
        self.postMessage({ type: 'graphics_init', width: w, height: h, title: titleStr });
        return res;
      },
    }, {
      get(t, p) {
        if (p in t) return t[p];
        return () => 0;
      }
    });
  } else if (hasRaylib) {
    importObject.gl = new Proxy({}, { get: () => () => 0 });
    importObject.raylib = new Proxy({}, { get: () => () => 0 });
  }

  const instance = await WebAssembly.instantiate(module, importObject);
  memoryInstance = instance.exports.memory;
  if (raylibHost) {
    raylibHost.setInstance(instance);
  }

  if (typeof instance.exports._start === 'function') {
    instance.exports._start();
  } else if (typeof instance.exports.main === 'function') {
    instance.exports.main();
  }
}
