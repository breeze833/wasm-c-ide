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

export const EROFS = 65;

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

    // Ensure path_filestat_get preserves actual mtime from VFS nodes
    const origPathFilestatGet = baseImports.path_filestat_get;
    baseImports.path_filestat_get = (dirfd, flags, path_ptr, path_len, stat_out) => {
      const res = origPathFilestatGet(dirfd, flags, path_ptr, path_len, stat_out);
      if (res === ESUCCESS && this.vfs && typeof this.vfs.stat === 'function') {
        const pathStr = this.readStr(path_ptr, path_len);
        const fullPath = this.resolvePath(dirfd, pathStr);
        const st = this.vfs.stat(fullPath);
        if (st && st.mtime) {
          const mtimeNs = BigInt(st.mtime) * 1000000n;
          this.memI64()[(stat_out + 48) >> 3] = mtimeNs;
        }
      }
      return res;
    };

    // Ensure fd_filestat_get preserves actual mtime from VFS nodes
    const origFdFilestatGet = baseImports.fd_filestat_get;
    baseImports.fd_filestat_get = (fd, stat_out) => {
      const res = origFdFilestatGet(fd, stat_out);
      if (res === ESUCCESS && this.vfs && typeof this.vfs.stat === 'function') {
        let p = null;
        for (const preopen of this.preopens) {
          if (preopen.fd === fd) { p = preopen.path; break; }
        }
        if (!p && this.openFiles.has(fd)) {
          p = this.openFiles.get(fd).path;
        }
        if (p) {
          const st = this.vfs.stat(p);
          if (st && st.mtime) {
            const mtimeNs = BigInt(st.mtime) * 1000000n;
            this.memI64()[(stat_out + 48) >> 3] = mtimeNs;
          }
        }
      }
      return res;
    };

    // Ensure path_filestat_set_times returns ENOENT for non-existent files so touch can create them,
    // and correctly updates the modification timestamp in VFS
    baseImports.path_filestat_set_times = (dirfd, flags, path_ptr, path_len, atim, mtim, fst_flags) => {
      const pathStr = this.readStr(path_ptr, path_len);
      const fullPath = this.resolvePath(dirfd, pathStr);
      if (!this._vfsExists(fullPath) && !this._vfsIsDir(fullPath)) {
        return ENOENT;
      }
      let mtimeNs = BigInt(Date.now()) * 1000000n;
      if ((fst_flags & 4) !== 0) {
        mtimeNs = mtim;
      }
      if (this.vfs && typeof this.vfs.setTimes === 'function') {
        try { this.vfs.setTimes(fullPath, atim, mtimeNs); } catch (_) {}
      } else if (this.vfs && typeof this.vfs._resolve === 'function') {
        const node = this.vfs._resolve(fullPath);
        if (node) {
          node.mtime = Number(mtimeNs / 1000000n);
          if (typeof this.vfs._notify === 'function') {
            this.vfs._notify({ type: 'write', path: fullPath, isDir: node.isDir, mtime: node.mtime });
          }
        }
      }
      if (this.changedFiles && this._vfsExists(fullPath) && !this._vfsIsDir(fullPath)) {
        const bytes = this._vfsReadFile(fullPath);
        if (bytes) this.changedFiles.set(fullPath, bytes);
      }
      return ESUCCESS;
    };

    // Ensure fd_filestat_set_times updates mtime timestamp on open file descriptors
    baseImports.fd_filestat_set_times = (fd, atim, mtim, fst_flags) => {
      let p = null;
      for (const preopen of this.preopens) {
        if (preopen.fd === fd) { p = preopen.path; break; }
      }
      if (!p && this.openFiles.has(fd)) {
        p = this.openFiles.get(fd).path;
      }
      if (!p) return EBADF;
      let mtimeNs = BigInt(Date.now()) * 1000000n;
      if ((fst_flags & 4) !== 0) {
        mtimeNs = mtim;
      }
      if (this.vfs && typeof this.vfs.setTimes === 'function') {
        try { this.vfs.setTimes(p, atim, mtimeNs); } catch (_) {}
      } else if (this.vfs && typeof this.vfs._resolve === 'function') {
        const node = this.vfs._resolve(p);
        if (node) {
          node.mtime = Number(mtimeNs / 1000000n);
          if (typeof this.vfs._notify === 'function') {
            this.vfs._notify({ type: 'write', path: p, isDir: node.isDir, mtime: node.mtime });
          }
        }
      }
      if (this.changedFiles && this._vfsExists(p) && !this._vfsIsDir(p)) {
        const bytes = this._vfsReadFile(p);
        if (bytes) this.changedFiles.set(p, bytes);
      }
      return ESUCCESS;
    };

    // Ensure path_remove_directory properly removes directory from VFS
    baseImports.path_remove_directory = (dirfd, path_ptr, path_len) => {
      const pathStr = this.readStr(path_ptr, path_len);
      const fullPath = this.resolvePath(dirfd, pathStr);
      if (this.vfs && typeof this.vfs._isReadOnly === 'function' && this.vfs._isReadOnly(fullPath)) {
        return EROFS;
      }
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
      if (this.vfs && typeof this.vfs._isReadOnly === 'function' && this.vfs._isReadOnly(fullPath)) {
        return EROFS;
      }
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
      if (this.vfs && typeof this.vfs._isReadOnly === 'function' && this.vfs._isReadOnly(fullPath)) {
        return EROFS;
      }
      if (this._vfsIsDir(fullPath)) {
        return EISDIR;
      }
      if (!this._vfsExists(fullPath)) {
        return ENOENT;
      }
      this._vfsRemove(fullPath);
      return ESUCCESS;
    };

    // Ensure path_open enforces read-only safety on system directories
    const origPathOpen = baseImports.path_open;
    baseImports.path_open = (dirfd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fdflags, opened_fd_ptr) => {
      const pathStr = this.readStr(path_ptr, path_len);
      const fullPath = this.resolvePath(dirfd, pathStr);

      if (this.vfs && typeof this.vfs._isReadOnly === 'function' && this.vfs._isReadOnly(fullPath)) {
        const WASI_O_CREAT = 1;
        const WASI_O_TRUNC = 8;
        const WASI_FDFLAG_APPEND = 1;
        const rightsBig = typeof fs_rights_base === 'bigint' ? fs_rights_base : BigInt(fs_rights_base || 0);
        const canWrite = (rightsBig === 0n)
          ? Boolean((oflags & (WASI_O_CREAT | WASI_O_TRUNC)) || (fdflags & WASI_FDFLAG_APPEND))
          : ((rightsBig & (1n << 6n)) !== 0n);

        if ((oflags & (WASI_O_CREAT | WASI_O_TRUNC)) !== 0 || (fdflags & WASI_FDFLAG_APPEND) !== 0 || canWrite) {
          return EROFS;
        }
      }

      return origPathOpen(dirfd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fdflags, opened_fd_ptr);
    };

    // Ensure path_rename enforces read-only safety on system directories and tracks file movement
    const origPathRename = baseImports.path_rename;
    baseImports.path_rename = (old_fd, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) => {
      const oldPathStr = this.readStr(old_path_ptr, old_path_len);
      const oldFull = this.resolvePath(old_fd, oldPathStr);
      const newPathStr = this.readStr(new_path_ptr, new_path_len);
      const newFull = this.resolvePath(new_fd, newPathStr);
      if (this.vfs && typeof this.vfs._isReadOnly === 'function' && (this.vfs._isReadOnly(oldFull) || this.vfs._isReadOnly(newFull))) {
        return EROFS;
      }
      const res = origPathRename(old_fd, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len);
      if (res === ESUCCESS) {
        this.deletedFiles.add(oldFull);
        this.changedFiles.delete(oldFull);
        if (this._vfsExists(newFull)) {
          this.changedFiles.set(newFull, this._vfsReadFile(newFull));
        }
      }
      return res;
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
    EROFS,
  };
}
