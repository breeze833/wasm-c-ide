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
  EPERM,
  EROFS,
};

export class WasiHost extends BaseWasiHost {
  constructor(options = {}) {
    const userWasiWrapper = options.wasiWrapper;
    const userEnvProvider = options.envProvider;

    super({
      ...options,
      systemDirs: options.systemDirs || ['/dev', '/usr', '/include', '/lib', '/bin'],
      wasiWrapper: (wasi, host) => {
        const base = userWasiWrapper ? userWasiWrapper(wasi, host) : wasi;
        return wrapWasiPipes(base, host);
      },
      envProvider: (host) => ({
        ...createBusyboxBridge(host),
        ...(userEnvProvider ? userEnvProvider(host) : {}),
      }),
    });

    this.hostBuiltinLookup = options.hostBuiltinLookup || null;
    this.hostBuiltinRun = options.hostBuiltinRun || null;
    this.hostBuiltinName = options.hostBuiltinName || null;
    this.rows = options.rows || 24;
    this.cols = options.cols || 80;
    this.winchFlag = 0;
    this.isInterrupted = options.isInterrupted || null;
    this.interruptToken = options.interruptToken || 0;
  }

  memU32() {
    return new Uint32Array(this.mem().buffer);
  }

  memI64() {
    return new BigInt64Array(this.mem().buffer);
  }
}
