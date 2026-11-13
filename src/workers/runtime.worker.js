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
import { createStdinReader } from 'stdin-wasi/worker';
import { VFS } from '../vfs/vfs.js';
import { WasiHost, ProcExit, normalizePath } from '../vfs/wasi-host.js';

export { ProcExit, normalizePath };

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
    const { wasmBytes, sharedBuffer, argv = ['./a.out'], environ = {}, stdinBytes, raylibSharedBuffer, files = {}, sharedSysrootBuffer = null } = msg;

    try {
      const res = await runWasm(wasmBytes, argv, environ, stdinBytes, raylibSharedBuffer, files, sharedSysrootBuffer, sharedBuffer);
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

export async function runWasm(wasmBytes, argv, environ, stdinBytes = null, raylibSharedBuffer = null, initialFiles = {}, sharedSysrootBuffer = null, sharedBuffer = null) {
  let memoryInstance = null;

  function memU8() {
    return new Uint8Array(memoryInstance.buffer);
  }
  function memU32() {
    return new Uint32Array(memoryInstance.buffer);
  }

  const readStdin = createStdinReader({
    sharedBuffer,
    stdinBytes,
    getMemory: () => memoryInstance,
    notifyHost: () => self.postMessage({ type: 'stdin_request' }),
  });

  const vfs = new VFS();
  if (sharedSysrootBuffer) {
    vfs.setSharedSysroot(sharedSysrootBuffer);
  }
  for (const [k, v] of Object.entries(initialFiles || {})) {
    const norm = normalizePath(k);
    const u8 = typeof v === 'string'
      ? new TextEncoder().encode(v)
      : (v instanceof Uint8Array ? v : new Uint8Array(v));
    vfs.writeFile(norm, u8, Date.now(), true);
  }

  const wasiHost = new WasiHost({
    vfs,
    cwd: '/workspace',
    argv: argv || ['./a.out'],
    environ: { USER: 'student', HOME: '/workspace', PWD: '/workspace', ...(environ || {}) },
    preopens: [
      { fd: 3, path: '/workspace', name: '.' },
      { fd: 4, path: '/', name: '/' },
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
  const hasRaylib = importsList.some(i => i.module === 'raylib' || i.module === 'gl' || i.module === 'audio');

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
      onAudioMessage: (audioMsg, transfer) => {
        if (transfer && transfer.length) {
          self.postMessage(audioMsg, transfer);
        } else {
          self.postMessage(audioMsg);
        }
      },
    });

    const raylibImports = raylibHost.getImports();
    importObject.gl = new Proxy(raylibImports.gl, {
      get(t, p) {
        if (p in t) return t[p];
        return () => 0;
      }
    });
    importObject.audio = new Proxy(raylibImports.audio || {}, {
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
    importObject.audio = new Proxy({}, { get: () => () => 0 });
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
