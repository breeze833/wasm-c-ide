// Virtual File System (VFS)
// Extends vfs-wasi OverlayVFS with wasm-c-ide specific system root directory initialization,
// backward-compatible method signatures, and heap memory optimization upon SharedSysroot mount.

import { OverlayVFS, EROFS } from 'vfs-wasi';
import { SharedSysrootReader } from './shared-sysroot.js';

export { EROFS };

export function normalizePath(path) {
  if (!path) return '/';
  const isAbsolute = path.startsWith('/');
  const parts = path.split('/').filter(p => p && p !== '.');
  const resolved = [];

  for (const part of parts) {
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  const result = (isAbsolute ? '/' : '') + resolved.join('/');
  return result === '' ? '/' : result;
}

export class VFS extends OverlayVFS {
  constructor(options = {}) {
    super({ ...options, workingDir: '/' });

    // Ensure root directories exist
    this.mkdir('/workspace', true, true);
    this.mkdir('/dev', true, true);
    this.mkdir('/usr', true, true);
    this.mkdir('/usr/include', true, true);
    this.mkdir('/usr/lib', true, true);
    this.mkdir('/usr/bin', true, true);
    this.mkdir('/bin', true, true);
    this.mkdir('/include', true, true);
    this.mkdir('/lib', true, true);
  }

  _isReadOnly(path) {
    const norm = normalizePath(path);
    return (
      norm.startsWith('/dev') ||
      norm.startsWith('/usr') ||
      norm.startsWith('/bin') ||
      norm.startsWith('/include') ||
      norm.startsWith('/lib')
    );
  }

  _resolve(path, createIntermediate = false) {
    const norm = normalizePath(path);
    if (norm === '/') return this.root;

    const parts = norm.split('/').filter(Boolean);
    let current = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let next = current.children.get(part);

      if (!next) {
        if (createIntermediate) {
          next = {
            name: part,
            isDir: true,
            children: new Map(),
            mtime: Date.now(),
          };
          current.children.set(part, next);
        } else {
          return null;
        }
      }

      current = next;
    }

    return current;
  }

  mkdir(path, recursiveOrOptions = true, allowReadOnly = false) {
    let recursive = true;
    let allowRO = allowReadOnly;
    let mode = 0o040755;

    if (typeof recursiveOrOptions === 'boolean') {
      recursive = recursiveOrOptions;
    } else if (typeof recursiveOrOptions === 'object' && recursiveOrOptions !== null) {
      if (recursiveOrOptions.recursive !== undefined) recursive = recursiveOrOptions.recursive;
      if (recursiveOrOptions.allowReadOnly !== undefined) allowRO = recursiveOrOptions.allowReadOnly;
      if (recursiveOrOptions.mode !== undefined) mode = recursiveOrOptions.mode;
    }

    const norm = normalizePath(path);
    if (norm === '/') return;
    if (!allowRO && this._isReadOnly(norm)) {
      const err = new Error(`Permission denied: Cannot create directory in read-only path ${norm}`);
      err.code = 'EROFS';
      err.errno = EROFS;
      throw err;
    }

    return super.mkdir(path, { recursive, allowReadOnly: allowRO, mode });
  }

  writeFile(path, content, mtimeOrOptions = Date.now(), allowReadOnly = false) {
    let mtime = Date.now();
    let allowRO = allowReadOnly;
    let mode = 0o100644;

    if (typeof mtimeOrOptions === 'number') {
      mtime = mtimeOrOptions;
    } else if (typeof mtimeOrOptions === 'object' && mtimeOrOptions !== null) {
      if (mtimeOrOptions.mtime !== undefined) mtime = mtimeOrOptions.mtime;
      if (mtimeOrOptions.allowReadOnly !== undefined) allowRO = mtimeOrOptions.allowReadOnly;
      if (mtimeOrOptions.mode !== undefined) mode = mtimeOrOptions.mode;
    }

    const norm = normalizePath(path);
    if (!allowRO && this._isReadOnly(norm)) {
      const err = new Error(`Permission denied: Cannot write to read-only path ${norm}`);
      err.code = 'EROFS';
      err.errno = EROFS;
      throw err;
    }

    return super.writeFile(path, content, { mtime, allowReadOnly: allowRO, mode });
  }

  readFile(path, asText = true) {
    // In wasm-c-ide, asText defaults to true for text editing & scripts
    return super.readFile(path, asText);
  }

  readBinary(path) {
    return this.readFile(path, false);
  }

  remove(path, recursive = false, isSystem = false) {
    const norm = normalizePath(path);
    if (!isSystem && this._isReadOnly(norm)) {
      const err = new Error(`Permission denied: Cannot remove ${norm}`);
      err.code = 'EROFS';
      err.errno = EROFS;
      throw err;
    }
    return super.remove(path, recursive, isSystem);
  }

  rmdir(path, recursive = false, isSystem = false) {
    return this.remove(path, recursive, isSystem);
  }

  rename(oldPath, newPath) {
    const oldNorm = normalizePath(oldPath);
    const newNorm = normalizePath(newPath);

    if (this._isReadOnly(oldNorm) || this._isReadOnly(newNorm)) {
      const err = new Error('Permission denied: Cannot rename read-only paths');
      err.code = 'EROFS';
      err.errno = EROFS;
      throw err;
    }
    return super.rename(oldPath, newPath);
  }

  setTimes(path, atim, mtim) {
    const norm = normalizePath(path);
    if (this._isReadOnly(norm)) {
      const err = new Error(`Permission denied: Cannot modify timestamp of read-only path ${norm}`);
      err.code = 'EROFS';
      err.errno = EROFS;
      throw err;
    }
    const node = this._resolve(norm);
    if (!node) {
      const err = new Error(`No such file or directory: ${norm}`);
      err.code = 'ENOENT';
      err.errno = 44;
      throw err;
    }
    let mtimeMs = Date.now();
    if (typeof mtim === 'bigint') {
      mtimeMs = Number(mtim / 1000000n);
    } else if (typeof mtim === 'number' && !isNaN(mtim) && mtim > 0) {
      mtimeMs = mtim;
    }
    if (node.mtime && mtimeMs <= node.mtime) {
      mtimeMs = node.mtime + 1;
    }
    node.mtime = mtimeMs;
    this._notify({ type: 'write', path: norm, isDir: node.isDir, mtime: mtimeMs });
    return mtimeMs;
  }

  setSharedSysroot(readerOrBuffer) {
    super.setSharedSysroot(readerOrBuffer);

    // Free heap memory by clearing early-boot mock nodes in system paths now backed by SharedSysroot
    for (const sysDir of ['/usr/include', '/usr/lib', '/include', '/bin']) {
      const node = this._resolve(sysDir);
      if (node && node.isDir && node.children) {
        node.children.clear();
      }
    }
  }
}
