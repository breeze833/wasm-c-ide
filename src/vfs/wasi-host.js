// Unified Platform Host for wasm-c-ide
// Composes baseline WASI Preview 1 (wasi-host) and BusyBox host bridge & MemoryPipe (busybox-wasi)
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
  EPERM,
  EROFS,
} from 'wasi-host';

import {
  MemoryPipe,
  createBusyboxBridge,
  wrapWasiPipes,
  attachBusybox,
  createBusyboxHostOptions,
} from 'busybox-wasi/host';

export {
  BaseWasiHost,
  ProcExit,
  normalizePath,
  MemoryPipe,
  createBusyboxBridge,
  wrapWasiPipes,
  attachBusybox,
  createBusyboxHostOptions,
  ESUCCESS,
  EBADF,
  EEXIST,
  EINVAL,
  EISDIR,
  ENOENT,
  ENOSYS,
  ENOTDIR,
  EPERM,
  EROFS,
};

export class WasiHost extends BaseWasiHost {
  constructor(options = {}) {
    super(createBusyboxHostOptions({
      ...options,
      systemDirs: options.systemDirs || ['/dev', '/usr', '/include', '/lib', '/bin'],
    }));
  }

  memU32() {
    return new Uint32Array(this.mem().buffer);
  }

  memI64() {
    return new BigInt64Array(this.mem().buffer);
  }
}
