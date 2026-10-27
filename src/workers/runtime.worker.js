// Web Worker: Sandboxed Execution Runtime for compiled a.out
// Implements WASI syscalls via unified WasiHost and synchronous stdin using SharedArrayBuffer & Atomics.wait()

if (typeof self === 'undefined') {
  globalThis.self = globalThis;
  if (!globalThis.postMessage) {
    globalThis.postMessage = () => {};
  }
}

import { createRaylibHost } from 'raylib-wasi';
import { createGraphicsImports } from 'canvas-wasi/worker';
import { WasiHost, ProcExit, normalizePath, ESUCCESS } from '../vfs/wasi-host.js';

export { ProcExit, normalizePath };

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
let activeGraphicsHost = null;

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'input_event' && msg.event) {
    if (activeGraphicsHost && typeof activeGraphicsHost.handleInputEvent === 'function') {
      activeGraphicsHost.handleInputEvent(msg.event);
    }
    return;
  }

  if (msg.type === 'run') {
    const { wasmBytes, sharedBuffer, argv = ['./a.out'], environ = {}, stdinBytes, raylibSharedBuffer, files = {} } = msg;

    if (sharedBuffer) {
      sharedInt32 = new Int32Array(sharedBuffer);
      sharedUint8 = new Uint8Array(sharedBuffer);
    }

    try {
      const res = await runWasm(wasmBytes, argv, environ, stdinBytes, raylibSharedBuffer, files);
      const changes = {};
      if (res && res.changedFiles) {
        for (const [k, v] of res.changedFiles.entries()) {
          changes[k] = v;
        }
      }
      const del = (res && res.deletedFiles) ? Array.from(res.deletedFiles) : [];
      self.postMessage({ type: 'done', exitCode: 0, changedFiles: changes, deletedFiles: del });
    } catch (err) {
      if (err instanceof ProcExit || (err && err.code !== undefined && err.message && err.message.startsWith('Exited with code'))) {
        const changes = {};
        if (err.changedFiles) {
          for (const [k, v] of err.changedFiles.entries()) {
            changes[k] = v;
          }
        }
        const del = (err.deletedFiles) ? Array.from(err.deletedFiles) : [];
        self.postMessage({ type: 'done', exitCode: err.code, changedFiles: changes, deletedFiles: del });
      } else {
        self.postMessage({ type: 'error', error: err.message, stack: err.stack });
      }
    }
  }
};

export async function runWasm(wasmBytes, argv, environ, stdinBytes = null, raylibSharedBuffer = null, initialFiles = {}) {
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
  function readStdin(iovs, iovs_len, nread_out, host) {
    if (preloadedStdin) {
      let totalRead = 0;
      for (let i = 0; i < iovs_len; i++) {
        const bufPtr = host.memU32()[(iovs >> 2) + i * 2];
        const bufLen = host.memU32()[(iovs >> 2) + i * 2 + 1];
        const available = preloadedStdin.length - stdinPos;
        if (available > 0) {
          const toCopy = Math.min(bufLen, available);
          host.memU8().set(preloadedStdin.subarray(stdinPos, stdinPos + toCopy), bufPtr);
          stdinPos += toCopy;
          totalRead += toCopy;
          break;
        }
      }
      host.memU32()[nread_out >> 2] = totalRead;
      return ESUCCESS;
    }

    let totalRead = 0;

    for (let i = 0; i < iovs_len; i++) {
      const bufPtr = host.memU32()[(iovs >> 2) + i * 2];
      const bufLen = host.memU32()[(iovs >> 2) + i * 2 + 1];

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
        const target = host.memU8().subarray(bufPtr, bufPtr + toCopy);
        const source = sharedUint8.subarray(DATA_OFFSET + curPos, DATA_OFFSET + curPos + toCopy);

        target.set(source);
        Atomics.add(sharedInt32, CONTROL_READ_POS_IDX, toCopy);
        totalRead += toCopy;
      }

      if (totalRead > 0) break;
    }

    host.memU32()[nread_out >> 2] = totalRead;
    return ESUCCESS;
  }

  const fsMap = new Map();
  for (const [k, v] of Object.entries(initialFiles || {})) {
    const norm = normalizePath(k);
    const u8 = typeof v === 'string'
      ? new TextEncoder().encode(v)
      : (v instanceof Uint8Array ? v : new Uint8Array(v));
    fsMap.set(norm, u8);
  }

  const wasiHost = new WasiHost({
    vfs: fsMap,
    cwd: '/workspace',
    argv: argv || ['./a.out'],
    environ: environ || { USER: 'student', PWD: '/workspace' },
    preopens: [
      { fd: 3, path: '/workspace', name: '.' },
    ],
    stdin: readStdin,
    stdout: (text) => self.postMessage({ type: 'stdout', data: text }),
    stderr: (text) => self.postMessage({ type: 'stdout', data: text }),
    getMemory: () => memoryInstance,
    onFileSync: (path, data) => {
      try {
        self.postMessage({ type: 'file_sync', path, data });
      } catch (_) {}
    },
    onFileDelete: (path) => {
      try {
        self.postMessage({ type: 'file_delete', path });
      } catch (_) {}
    },
  });

  const wasi = wasiHost.getImports();

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
    wasi_snapshot_preview1: wasi,
    wasi_unstable: wasi,
    env: envProxy,
  };

  let raylibHost = null;

  activeGraphicsHost = createGraphicsImports({
    getMemory: () => memoryInstance,
    sharedBuffer: raylibSharedBuffer,
    postMessage: (data, transfer) => self.postMessage(data, transfer)
  });
  const genericGraphics = activeGraphicsHost.env;

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

  return { changedFiles: wasiHost.changedFiles, deletedFiles: wasiHost.deletedFiles };
}
