// Web Worker: Sandboxed Execution Runtime for compiled a.out
// Delegates WASI/stdin/canvas execution to web-ide-core/wasi/runtime-worker and injects Raylib WebGL/Audio imports

if (typeof self === 'undefined') {
  globalThis.self = globalThis;
  if (!globalThis.postMessage) {
    globalThis.postMessage = () => {};
  }
}

import { createRaylibHost } from 'raylib-wasi';
import { VFS } from '../vfs/vfs.js';
import { SYSTEM_DIRS } from '../vfs/sysroot.js';
import {
  attachRuntimeWorker,
  runWasmBinary,
  ProcExit,
  normalizePath,
} from 'web-ide-core/wasi/runtime-worker';

export { ProcExit, normalizePath };

function resolveRaylibImports({ importsList, importObject, wasiHost, inputSharedBuffer, postMessage }) {
  const hasRaylib = importsList.some(
    (i) => i.module === 'raylib' || i.module === 'gl' || i.module === 'audio'
  );
  if (!hasRaylib) return null;

  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(800, 450);
    const gl = offscreen.getContext('webgl', {
      alpha: false,
      depth: true,
      stencil: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    const raylibHost = createRaylibHost({
      canvas: offscreen,
      gl,
      sharedBuffer: inputSharedBuffer,
      wasiHost,
      width: 800,
      height: 450,
      onInitWindow: (width, height, title) => {
        postMessage({ type: 'graphics_init', width, height, title: title || 'Graphics Display' });
      },
      onFrame: (bitmap) => {
        if (bitmap) {
          postMessage({ type: 'frame', bitmap }, [bitmap]);
        }
      },
      onFPS: (fps) => {
        postMessage({ type: 'fps', fps });
      },
      onClose: () => {
        postMessage({ type: 'graphics_close' });
      },
      onAudioMessage: (audioMsg, transfer) => {
        if (transfer && transfer.length) {
          postMessage(audioMsg, transfer);
        } else {
          postMessage(audioMsg);
        }
      },
    });

    const raylibImports = raylibHost.getImports();
    importObject.gl = new Proxy(raylibImports.gl, {
      get(t, p) {
        return p in t ? t[p] : () => 0;
      },
    });
    importObject.audio = new Proxy(raylibImports.audio || {}, {
      get(t, p) {
        return p in t ? t[p] : () => 0;
      },
    });
    importObject.raylib = new Proxy(raylibImports.raylib, {
      get(t, p) {
        return p in t ? t[p] : () => 0;
      },
    });

    return {
      onInstance: (instance) => {
        raylibHost.setInstance(instance);
      },
    };
  }

  importObject.gl = new Proxy({}, { get: () => () => 0 });
  importObject.raylib = new Proxy({}, { get: () => () => 0 });
  importObject.audio = new Proxy({}, { get: () => () => 0 });
  return null;
}

const workerConfig = {
  cwd: '/workspace',
  envDefaults: { USER: 'student', HOME: '/workspace', PWD: '/workspace' },
  systemDirs: SYSTEM_DIRS,
  vfsFactory: () => new VFS(),
  resolveCustomImports: resolveRaylibImports,
};

attachRuntimeWorker(workerConfig);

export function runWasm(
  wasmBytes,
  argv,
  environ,
  stdinBytes = null,
  raylibSharedBuffer = null,
  initialFiles = {},
  sharedSysrootBuffer = null,
  sharedBuffer = null
) {
  return runWasmBinary(
    wasmBytes,
    {
      argv,
      environ,
      stdinBytes,
      raylibSharedBuffer,
      files: initialFiles,
      sharedSysrootBuffer,
      sharedBuffer,
    },
    {
      ...workerConfig,
      postMessage: (data, transfer) => self.postMessage(data, transfer),
    }
  );
}
