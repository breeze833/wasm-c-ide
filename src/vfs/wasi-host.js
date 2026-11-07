// Unified Platform Host for wasm-c-ide
// Composes baseline WASI Preview 1 (clang-wasi) and BusyBox host bridge & MemoryPipe (busybox-wasi)
// directly backed by in-memory VFS.

import {
  WasiHost as BaseWasiHost,
  ProcExit,
  normalizePath,
  ESUCCESS,
  EBADF,
  EEXIST,
  EINVAL,
  EISDIR,
  ENOENT,
  ENOSYS,
  ENOTDIR,
  EPERM
} from 'clang-wasi/host';

import {
  MemoryPipe,
  createBusyboxBridge,
  wrapWasiPipes
} from 'busybox-wasi/host';

export {
  BaseWasiHost,
  ProcExit,
  normalizePath,
  MemoryPipe,
  createBusyboxBridge,
  wrapWasiPipes,
  ESUCCESS,
  EBADF,
  EEXIST,
  EINVAL,
  EISDIR,
  ENOENT,
  ENOSYS,
  ENOTDIR,
  EPERM
};

export class WasiHost extends BaseWasiHost {
  constructor(options = {}) {
    super(options);
    this.hostBuiltinLookup = options.hostBuiltinLookup || null;
    this.hostBuiltinRun = options.hostBuiltinRun || null;
    this.hostBuiltinName = options.hostBuiltinName || null;
    this.rows = options.rows || 24;
    this.cols = options.cols || 80;
    this.winchFlag = 0;
    this.isInterrupted = options.isInterrupted || null;
    this.interruptToken = options.interruptToken || 0;
  }

  getImports() {
    const baseImports = super.getImports();
    return wrapWasiPipes(baseImports, this);
  }

  createImportObject(customEnv = {}) {
    const wasi = this.getImports();
    const busyboxEnv = createBusyboxBridge(this);

    const mergedEnv = {
      ...busyboxEnv,
      ...customEnv,
    };

    return {
      wasi_snapshot_preview1: wasi,
      wasi_unstable: wasi,
      env: new Proxy(mergedEnv, {
        get(t, p) {
          if (p in t) return t[p];
          return () => 0;
        }
      })
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WasiHost,
    BaseWasiHost,
    MemoryPipe,
    createBusyboxBridge,
    wrapWasiPipes,
    ProcExit,
    normalizePath,
    ESUCCESS,
    EBADF,
    EEXIST,
    EINVAL,
    EISDIR,
    ENOENT,
    ENOSYS,
    ENOTDIR,
    EPERM,
  };
}
