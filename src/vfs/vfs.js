// Virtual File System (VFS)
// Manages hierarchical in-memory storage for /workspace, /usr, /include, and /lib

import { SharedSysrootReader } from './shared-sysroot.js';

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

export class VFS {
  constructor() {
    this.root = {
      name: '',
      isDir: true,
      children: new Map(),
      mtime: Date.now(),
    };
    this.listeners = new Set();
    this.sharedSysroot = null;

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

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('VFS listener error:', err);
      }
    }
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

  mkdir(path, recursive = true, allowReadOnly = false) {
    const norm = normalizePath(path);
    if (norm === '/') return;
    if (!allowReadOnly && this._isReadOnly(norm)) {
      throw new Error(`Permission denied: Cannot create directory in read-only path ${norm}`);
    }

    const parts = norm.split('/').filter(Boolean);
    let current = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let next = current.children.get(part);

      if (!next) {
        if (!recursive && i < parts.length - 1) {
          throw new Error(`No such file or directory: ${parts.slice(0, i + 1).join('/')}`);
        }
        next = {
          name: part,
          isDir: true,
          children: new Map(),
          mtime: Date.now(),
        };
        current.children.set(part, next);
      } else if (!next.isDir) {
        throw new Error(`Not a directory: ${parts.slice(0, i + 1).join('/')}`);
      }

      current = next;
    }

    this._notify({ type: 'mkdir', path: norm });
  }

  writeFile(path, content, mtime = Date.now(), allowReadOnly = false) {
    const norm = normalizePath(path);
    if (!allowReadOnly && this._isReadOnly(norm)) {
      throw new Error(`Permission denied: Cannot write to read-only path ${norm}`);
    }

    const parts = norm.split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('Cannot write to root');

    const fileName = parts.pop();
    const dirPath = '/' + parts.join('/');
    const dirNode = this._resolve(dirPath, true);

    if (!dirNode.isDir) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    let buffer;
    if (typeof content === 'string') {
      buffer = new TextEncoder().encode(content);
    } else if (content instanceof Uint8Array) {
      buffer = content;
    } else if (content instanceof ArrayBuffer) {
      buffer = new Uint8Array(content);
    } else {
      buffer = new Uint8Array(0);
    }

    const existing = dirNode.children.get(fileName);
    if (existing && existing.isDir) {
      throw new Error(`Is a directory: ${norm}`);
    }

    const node = {
      name: fileName,
      isDir: false,
      content: buffer,
      mtime,
    };

    dirNode.children.set(fileName, node);
    this._notify({ type: 'write', path: norm, isDir: false, mtime });
  }

  setTimes(path, atim, mtim) {
    const norm = normalizePath(path);
    if (this._isReadOnly(norm)) {
      throw new Error(`Permission denied: Cannot modify read-only path ${norm}`);
    }
    const node = this._resolve(norm);
    if (!node) {
      throw new Error(`No such file or directory: ${norm}`);
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
    if (!readerOrBuffer) {
      this.sharedSysroot = null;
      return;
    }
    if (readerOrBuffer instanceof SharedSysrootReader) {
      this.sharedSysroot = readerOrBuffer;
    } else {
      this.sharedSysroot = new SharedSysrootReader(readerOrBuffer);
    }

    // Free heap memory by clearing early-boot mock nodes in system paths now backed by SharedSysroot
    for (const sysDir of ['/usr/include', '/usr/lib', '/include', '/bin']) {
      const node = this._resolve(sysDir);
      if (node && node.isDir && node.children) {
        node.children.clear();
      }
    }
  }

  readFile(path, asText = true) {
    const norm = normalizePath(path);

    // If SharedSysroot is mounted, it serves as the single source of truth for immutable system directories
    if (this.sharedSysroot && (norm.startsWith('/usr/') || norm.startsWith('/include/') || norm.startsWith('/lib/') || norm.startsWith('/bin/')) && this.sharedSysroot.exists(norm)) {
      return this.sharedSysroot.readFile(norm, asText);
    }

    const node = this._resolve(norm);

    if (node) {
      if (node.isDir) {
        throw new Error(`Is a directory: ${norm}`);
      }
      if (asText) {
        if (typeof SharedArrayBuffer !== 'undefined' && node.content && node.content.buffer instanceof SharedArrayBuffer) {
          const unshared = new Uint8Array(node.content.byteLength);
          unshared.set(node.content);
          return new TextDecoder().decode(unshared);
        }
        return new TextDecoder().decode(node.content);
      }
      return node.content;
    }

    if (this.sharedSysroot && this.sharedSysroot.exists(norm)) {
      return this.sharedSysroot.readFile(norm, asText);
    }

    throw new Error(`No such file or directory: ${norm}`);
  }

  exists(path) {
    const norm = normalizePath(path);
    if (this._resolve(norm) !== null) return true;
    if (this.sharedSysroot && this.sharedSysroot.exists(norm)) return true;
    return false;
  }

  stat(path) {
    const norm = normalizePath(path);
    const node = this._resolve(norm);
    if (node) {
      return {
        name: node.name,
        isDir: node.isDir,
        size: node.isDir ? 0 : (node.content ? node.content.byteLength : 0),
        mtime: node.mtime,
      };
    }
    if (this.sharedSysroot) {
      const s = this.sharedSysroot.stat(norm);
      if (s) return s;
    }
    return null;
  }

  isDir(path) {
    const s = this.stat(path);
    return s ? Boolean(s.isDir) : false;
  }

  readDir(path) {
    const norm = normalizePath(path);
    const node = this._resolve(norm);
    const resultMap = new Map();

    if (node && node.isDir) {
      for (const [name, child] of node.children.entries()) {
        resultMap.set(name, {
          name,
          isDir: child.isDir,
          size: child.isDir ? 0 : (child.content ? child.content.byteLength : 0),
          mtime: child.mtime,
        });
      }
    }

    if (this.sharedSysroot && this.sharedSysroot.isDir(norm)) {
      const sysChildren = this.sharedSysroot.readDir(norm);
      for (const child of sysChildren) {
        if (!resultMap.has(child.name)) {
          resultMap.set(child.name, child);
        }
      }
    }

    if (resultMap.size === 0 && (!node || !node.isDir) && (!this.sharedSysroot || !this.sharedSysroot.isDir(norm))) {
      throw new Error(`No such file or directory: ${norm}`);
    }

    const results = Array.from(resultMap.values());
    return results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  remove(path, recursive = false, isSystem = false) {
    const norm = normalizePath(path);
    if (norm === '/' || norm === '/workspace') {
      throw new Error(`Cannot remove root or workspace: ${norm}`);
    }
    if (!isSystem && this._isReadOnly(norm)) {
      throw new Error(`Permission denied: Cannot remove ${norm}`);
    }

    const parts = norm.split('/').filter(Boolean);
    const name = parts.pop();
    const parentPath = '/' + parts.join('/');
    const parentNode = this._resolve(parentPath);

    if (!parentNode || !parentNode.isDir) {
      throw new Error(`No such file or directory: ${norm}`);
    }

    const targetNode = parentNode.children.get(name);
    if (!targetNode) {
      throw new Error(`No such file or directory: ${norm}`);
    }

    if (targetNode.isDir && targetNode.children.size > 0 && !recursive) {
      throw new Error(`Directory not empty: ${norm}`);
    }

    parentNode.children.delete(name);
    this._notify({ type: 'remove', path: norm, isDir: targetNode.isDir });
  }

  rmdir(path, recursive = false, isSystem = false) {
    return this.remove(path, recursive, isSystem);
  }

  rename(oldPath, newPath) {
    const oldNorm = normalizePath(oldPath);
    const newNorm = normalizePath(newPath);

    if (this._isReadOnly(oldNorm) || this._isReadOnly(newNorm)) {
      throw new Error('Permission denied: Cannot rename read-only paths');
    }

    if (oldNorm === newNorm) {
      return;
    }

    const sourceNode = this._resolve(oldNorm);
    if (!sourceNode) {
      throw new Error(`Source not found: ${oldNorm}`);
    }

    // If destination is an existing directory, move into it with source basename
    let targetNorm = newNorm;
    const destNode = this._resolve(newNorm);
    if (destNode && destNode.isDir) {
      const oldParts = oldNorm.split('/').filter(Boolean);
      const oldName = oldParts[oldParts.length - 1];
      targetNorm = newNorm === '/' ? `/${oldName}` : `${newNorm}/${oldName}`;
      if (this._isReadOnly(targetNorm)) {
        throw new Error('Permission denied: Cannot rename into read-only path');
      }
      if (oldNorm === targetNorm) {
        return;
      }
    }

    if (sourceNode.isDir && (targetNorm + '/').startsWith(oldNorm + '/')) {
      throw new Error(`Cannot move directory into itself: ${targetNorm}`);
    }

    const oldParts = oldNorm.split('/').filter(Boolean);
    const oldName = oldParts.pop();
    const oldParent = this._resolve('/' + oldParts.join('/'));

    const newParts = targetNorm.split('/').filter(Boolean);
    const newName = newParts.pop();
    const newParent = this._resolve('/' + newParts.join('/'), true);

    if (!newParent || !newParent.isDir) {
      throw new Error(`Destination directory not found: /${newParts.join('/')}`);
    }

    const existingDest = newParent.children.get(newName);
    if (existingDest) {
      if (existingDest.isDir && !sourceNode.isDir) {
        throw new Error(`Cannot overwrite directory with non-directory: ${targetNorm}`);
      }
      if (!existingDest.isDir && sourceNode.isDir) {
        throw new Error(`Cannot overwrite non-directory with directory: ${targetNorm}`);
      }
      if (existingDest.isDir && sourceNode.isDir && existingDest.children.size > 0) {
        throw new Error(`Directory not empty: ${targetNorm}`);
      }
    }

    oldParent.children.delete(oldName);
    sourceNode.name = newName;
    newParent.children.set(newName, sourceNode);

    this._notify({ type: 'rename', oldPath: oldNorm, path: targetNorm });
  }

  // Returns all files under a path recursively as flat array of { path, isDir, content, mtime }
  getAllFiles(basePath = '/workspace') {
    const norm = normalizePath(basePath);
    const results = [];

    const traverse = (currentPath, node) => {
      const fullPath = currentPath === '/' ? `/${node.name}` : `${currentPath}/${node.name}`;
      if (!node.isDir) {
        results.push({
          path: fullPath,
          isDir: false,
          content: node.content,
          mtime: node.mtime,
        });
      } else {
        if (fullPath !== '/' && fullPath !== norm) {
          results.push({
            path: fullPath,
            isDir: true,
            mtime: node.mtime,
          });
        }
        for (const child of node.children.values()) {
          traverse(fullPath === '/' ? '' : fullPath, child);
        }
      }
    };

    const baseNode = this._resolve(norm);
    if (baseNode) {
      for (const child of baseNode.children.values()) {
        traverse(norm, child);
      }
    }

    return results;
  }
}
