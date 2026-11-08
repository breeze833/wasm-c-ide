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

    // Ensure path_filestat_set_times returns ENOENT for non-existent files so touch can create them
    baseImports.path_filestat_set_times = (dirfd, flags, path_ptr, path_len, atim, mtim, fst_flags) => {
      const pathStr = this.readStr(path_ptr, path_len);
      const fullPath = this.resolvePath(dirfd, pathStr);
      if (!this._vfsExists(fullPath) && !this._vfsIsDir(fullPath)) {
        return ENOENT;
      }
      if (this.vfs && typeof this.vfs.setTimes === 'function') {
        try { this.vfs.setTimes(fullPath, atim, mtim); } catch {}
      }
      return ESUCCESS;
    };

    // Ensure path_remove_directory properly removes directory from VFS
    baseImports.path_remove_directory = (dirfd, path_ptr, path_len) => {
      const pathStr = this.readStr(path_ptr, path_len);
      const fullPath = this.resolvePath(dirfd, pathStr);
      if (!this._vfsIsDir(fullPath)) {
        return this._vfsExists(fullPath) ? ENOTDIR : ENOENT;
      }
      if (this.vfs) {
        if (typeof this.vfs.rmdir === 'function') {
          try {
            this.vfs.rmdir(fullPath, false, true);
          } catch (err) {
            if (err.message && err.message.includes('not empty')) return EEXIST;
            return EPERM;
          }
        } else if (typeof this.vfs.remove === 'function') {
          try {
            this.vfs.remove(fullPath, false, true);
          } catch (err) {
            if (err.message && err.message.includes('not empty')) return EEXIST;
            return EPERM;
          }
        }
      }
      if (this.createdDirs) {
        this.createdDirs.delete(fullPath);
      }
      this.deletedFiles.add(fullPath);
      return ESUCCESS;
    };

    // Ensure path_create_directory checks for existence and delegates to vfs.mkdir
    baseImports.path_create_directory = (dirfd, path_ptr, path_len) => {
      const pathStr = this.readStr(path_ptr, path_len);
      const fullPath = this.resolvePath(dirfd, pathStr);
      if (this._vfsExists(fullPath) || this._vfsIsDir(fullPath)) {
        return EEXIST;
      }
      if (this.vfs && typeof this.vfs.mkdir === 'function') {
        try {
          this.vfs.mkdir(fullPath, false, true);
        } catch (err) {
          return EPERM;
        }
      }
      if (this.createdDirs) {
        this.createdDirs.add(fullPath);
      }
      return ESUCCESS;
    };

    // Ensure path_unlink_file validates existence and guards directories
    baseImports.path_unlink_file = (dirfd, path_ptr, path_len) => {
      const pathStr = this.readStr(path_ptr, path_len);
      const fullPath = this.resolvePath(dirfd, pathStr);
      if (this._vfsIsDir(fullPath)) {
        return EISDIR;
      }
      if (!this._vfsExists(fullPath)) {
        return ENOENT;
      }
      this._vfsRemove(fullPath);
      return ESUCCESS;
    };

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
