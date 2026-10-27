// Virtual File System (MEMFS)
// Manages hierarchical in-memory storage for /workspace and /usr

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

    // Ensure root directories exist
    this.mkdir('/workspace', true, true);
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
    this._notify({ type: 'write', path: norm, isDir: false });
  }

  readFile(path, asText = true) {
    const norm = normalizePath(path);
    const node = this._resolve(norm);

    if (!node) {
      throw new Error(`No such file or directory: ${norm}`);
    }
    if (node.isDir) {
      throw new Error(`Is a directory: ${norm}`);
    }

    if (asText) {
      return new TextDecoder().decode(node.content);
    }
    return node.content;
  }

  exists(path) {
    const norm = normalizePath(path);
    return this._resolve(norm) !== null;
  }

  stat(path) {
    const norm = normalizePath(path);
    const node = this._resolve(norm);
    if (!node) return null;

    return {
      name: node.name,
      isDir: node.isDir,
      size: node.isDir ? 0 : node.content.byteLength,
      mtime: node.mtime,
    };
  }

  readDir(path) {
    const norm = normalizePath(path);
    const node = this._resolve(norm);
    if (!node) {
      throw new Error(`No such file or directory: ${norm}`);
    }
    if (!node.isDir) {
      throw new Error(`Not a directory: ${norm}`);
    }

    const results = [];
    for (const [name, child] of node.children.entries()) {
      results.push({
        name,
        isDir: child.isDir,
        size: child.isDir ? 0 : child.content.byteLength,
        mtime: child.mtime,
      });
    }

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
