// Web Worker: Sandboxed Execution Runtime for compiled a.out
// Implements WASI syscalls and synchronous stdin using SharedArrayBuffer & Atomics.wait()

if (typeof self === 'undefined') {
  globalThis.self = globalThis;
  if (!globalThis.postMessage) {
    globalThis.postMessage = () => {};
  }
}

import { createRaylibHost } from 'raylib-wasi';
import { createGraphicsImports } from 'canvas-wasi/worker';

const STATE_IDLE = 0;
const STATE_WAITING = 1;
const STATE_READY = 2;
const STATE_EOF = -1;

const CONTROL_STATE_IDX = 0;
const CONTROL_LEN_IDX = 1;
const CONTROL_READ_POS_IDX = 2;

const DATA_OFFSET = 16; // Byte offset in SharedArrayBuffer for stdin input data

let sharedInt32 = null;
let sharedUint8 = null;

class ProcExit extends Error {
  constructor(code, changedFiles = null, deletedFiles = null) {
    super(`Exited with code ${code}`);
    this.code = code;
    this.changedFiles = changedFiles;
    this.deletedFiles = deletedFiles;
  }
}

const ESUCCESS = 0;
const EBADF = 8;
const EEXIST = 20;
const EINVAL = 28;
const EISDIR = 31;
const ENOENT = 44;
const ENOSYS = 52;
const ENOTDIR = 54;
const EPERM = 63;

function readStr(u8, offset, len) {
  let str = '';
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(u8[offset + i]);
  }
  return str;
}

function normalizePath(path) {
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
    const { wasmBytes, sharedBuffer, argv = ['./a.out'], environ = {}, stdinBytes, raylibSharedBuffer, files = {} } = msg;

    if (sharedBuffer) {
      sharedInt32 = new Int32Array(sharedBuffer);
      sharedUint8 = new Uint8Array(sharedBuffer);
    }

    try {
      const res = await runWasm(wasmBytes, argv, environ, stdinBytes, raylibSharedBuffer, files);
      const changes = {};
      if (res && res.changedFiles) {
        for (const [k, v] of res.changedFiles.entries()) {
          changes[k] = v;
        }
      }
      const del = (res && res.deletedFiles) ? Array.from(res.deletedFiles) : [];
      self.postMessage({ type: 'done', exitCode: 0, changedFiles: changes, deletedFiles: del });
    } catch (err) {
      if (err instanceof ProcExit) {
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

export async function runWasm(wasmBytes, argv, environ, stdinBytes = null, raylibSharedBuffer = null, initialFiles = {}) {
  let memoryInstance = null;
  let stdinPos = 0;
  const preloadedStdin = stdinBytes ? (stdinBytes instanceof Uint8Array ? stdinBytes : new Uint8Array(stdinBytes)) : null;

  function memU8() {
    return new Uint8Array(memoryInstance.buffer);
  }
  function memU32() {
    return new Uint32Array(memoryInstance.buffer);
  }

  // Blocking synchronous stdin handler using Atomics or preloaded buffer
  function readStdin(iovs, iovs_len, nread_out) {
    if (preloadedStdin) {
      let totalRead = 0;
      for (let i = 0; i < iovs_len; i++) {
        const bufPtr = memU32()[(iovs >> 2) + i * 2];
        const bufLen = memU32()[(iovs >> 2) + i * 2 + 1];
        const available = preloadedStdin.length - stdinPos;
        if (available > 0) {
          const toCopy = Math.min(bufLen, available);
          memU8().set(preloadedStdin.subarray(stdinPos, stdinPos + toCopy), bufPtr);
          stdinPos += toCopy;
          totalRead += toCopy;
          break;
        }
      }
      memU32()[nread_out >> 2] = totalRead;
      return ESUCCESS;
    }

    let totalRead = 0;

    for (let i = 0; i < iovs_len; i++) {
      const bufPtr = memU32()[(iovs >> 2) + i * 2];
      const bufLen = memU32()[(iovs >> 2) + i * 2 + 1];

      let available = 0;
      let curLen = 0;
      let curPos = 0;

      if (sharedInt32) {
        curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
        curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        available = curLen - curPos;
      }

      if (available <= 0 && sharedInt32) {
        // Notify host that we are blocked waiting for stdin input
        self.postMessage({ type: 'stdin_request' });

        // Set state to WAITING
        Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_WAITING);

        // Synchronously block worker until main thread issues Atomics.notify()
        Atomics.wait(sharedInt32, CONTROL_STATE_IDX, STATE_WAITING);

        const state = Atomics.load(sharedInt32, CONTROL_STATE_IDX);
        if (state === STATE_EOF) {
          break;
        }

        curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
        curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        available = curLen - curPos;
      }

      if (available > 0 && sharedInt32) {
        curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        const toCopy = Math.min(bufLen, available);
        const target = memU8().subarray(bufPtr, bufPtr + toCopy);
        const source = sharedUint8.subarray(DATA_OFFSET + curPos, DATA_OFFSET + curPos + toCopy);

        target.set(source);
        Atomics.add(sharedInt32, CONTROL_READ_POS_IDX, toCopy);
        totalRead += toCopy;
      }

      if (totalRead > 0) break;
    }

    memU32()[nread_out >> 2] = totalRead;
    return ESUCCESS;
  }

  const fsMap = new Map();
  const changedFiles = new Map();
  const deletedFiles = new Set();
  const createdDirs = new Set(['/', '/workspace', '/usr', '/bin', '/usr/include', '/usr/lib']);
  const openFiles = new Map();
  let nextFd = 10;

  for (const [k, v] of Object.entries(initialFiles || {})) {
    const norm = normalizePath(k);
    const u8 = typeof v === 'string'
      ? new TextEncoder().encode(v)
      : (v instanceof Uint8Array ? v : new Uint8Array(v));
    fsMap.set(norm, u8);
    let p = norm;
    while (p.lastIndexOf('/') > 0) {
      p = p.substring(0, p.lastIndexOf('/'));
      createdDirs.add(p);
    }
  }

  function isDir(p) {
    if (createdDirs.has(p)) return true;
    const prefix = p === '/' ? '/' : `${p}/`;
    for (const k of fsMap.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  function resolvePath(dirfd, pathStr) {
    let base = '/workspace';
    if (dirfd === 3 || dirfd === 4) base = '/workspace';
    else if (dirfd === 5) base = '/';
    else if (openFiles.has(dirfd)) base = openFiles.get(dirfd).path;

    if (!pathStr || pathStr === '.') return normalizePath(base);
    if (pathStr.startsWith('/')) return normalizePath(pathStr);
    return normalizePath(`${base}/${pathStr}`);
  }

  const wasi = {
    proc_exit(code) {
      throw new ProcExit(code, changedFiles, deletedFiles);
    },

    fd_write(fd, iovs, iovs_len, nwritten_out) {
      if (fd === 1 || fd === 2) {
        let totalWritten = 0;
        let text = '';
        for (let i = 0; i < iovs_len; i++) {
          const ptr = memU32()[(iovs >> 2) + i * 2];
          const len = memU32()[(iovs >> 2) + i * 2 + 1];
          text += readStr(memU8(), ptr, len);
          totalWritten += len;
        }
        memU32()[nwritten_out >> 2] = totalWritten;
        self.postMessage({ type: 'stdout', data: text });
        return ESUCCESS;
      }

      const file = openFiles.get(fd);
      if (!file || file.isDir || !file.canWrite) {
        return EBADF;
      }

      let data = fsMap.get(file.path) || new Uint8Array(0);
      let totalWritten = 0;

      for (let i = 0; i < iovs_len; i++) {
        const ptr = memU32()[(iovs >> 2) + i * 2];
        const len = memU32()[(iovs >> 2) + i * 2 + 1];
        if (len <= 0) continue;

        if (file.isAppend) {
          file.cursor = data.length;
        }

        const needed = file.cursor + len;
        if (needed > data.length) {
          const nextData = new Uint8Array(needed);
          nextData.set(data);
          data = nextData;
          fsMap.set(file.path, data);
        }

        data.set(memU8().subarray(ptr, ptr + len), file.cursor);
        file.cursor += len;
        totalWritten += len;
      }

      changedFiles.set(file.path, data);
      deletedFiles.delete(file.path);
      memU32()[nwritten_out >> 2] = totalWritten;
      return ESUCCESS;
    },

    fd_read(fd, iovs, iovs_len, nread_out) {
      if (fd === 0) {
        return readStdin(iovs, iovs_len, nread_out);
      }

      const file = openFiles.get(fd);
      if (!file || file.isDir || !file.canRead) {
        return EBADF;
      }

      const data = fsMap.get(file.path) || new Uint8Array(0);
      let totalRead = 0;

      for (let i = 0; i < iovs_len; i++) {
        const ptr = memU32()[(iovs >> 2) + i * 2];
        const len = memU32()[(iovs >> 2) + i * 2 + 1];
        if (len <= 0) continue;

        const available = Math.max(0, data.length - file.cursor);
        if (available === 0) break;

        const toCopy = Math.min(len, available);
        memU8().set(data.subarray(file.cursor, file.cursor + toCopy), ptr);
        file.cursor += toCopy;
        totalRead += toCopy;

        if (toCopy < len) break;
      }

      memU32()[nread_out >> 2] = totalRead;
      return ESUCCESS;
    },

    fd_close(fd) {
      if (fd >= 0 && fd <= 5) {
        return ESUCCESS;
      }
      if (openFiles.has(fd)) {
        const file = openFiles.get(fd);
        openFiles.delete(fd);
        if (changedFiles.has(file.path)) {
          const data = fsMap.get(file.path);
          try {
            self.postMessage({ type: 'file_sync', path: file.path, data });
          } catch (_) {}
        }
      }
      return ESUCCESS;
    },

    fd_seek(fd, offset, whence, newoffset_out) {
      if (fd === 0 || fd === 1 || fd === 2) {
        return ESUCCESS;
      }
      const file = openFiles.get(fd);
      if (!file || file.isDir) {
        return EBADF;
      }
      const data = fsMap.get(file.path) || new Uint8Array(0);
      const offNum = Number(offset);
      let target = file.cursor;

      if (whence === 0) {
        target = offNum;
      } else if (whence === 1) {
        target = file.cursor + offNum;
      } else if (whence === 2) {
        target = data.length + offNum;
      } else {
        return EINVAL;
      }

      if (target < 0) {
        return EINVAL;
      }

      file.cursor = target;
      const view = new BigInt64Array(memoryInstance.buffer);
      view[newoffset_out >> 3] = BigInt(file.cursor);
      return ESUCCESS;
    },

    fd_tell(fd, offset_out) {
      const file = openFiles.get(fd);
      if (!file || file.isDir) {
        return EBADF;
      }
      const view = new BigInt64Array(memoryInstance.buffer);
      view[offset_out >> 3] = BigInt(file.cursor);
      return ESUCCESS;
    },

    fd_fdstat_get(fd, stat_out) {
      memU8().fill(0, stat_out, stat_out + 24);
      const view = new BigInt64Array(memoryInstance.buffer);
      const ALL_RIGHTS = 0x1fffffffffffffffn;

      if (fd === 0 || fd === 1 || fd === 2) {
        memU8()[stat_out] = 2; // __WASI_FILETYPE_CHARACTER_DEVICE
        view[(stat_out + 8) >> 3] = ALL_RIGHTS;
        view[(stat_out + 16) >> 3] = ALL_RIGHTS;
        return ESUCCESS;
      }
      if (fd === 3 || fd === 4 || fd === 5) {
        memU8()[stat_out] = 3; // __WASI_FILETYPE_DIRECTORY
        view[(stat_out + 8) >> 3] = ALL_RIGHTS;
        view[(stat_out + 16) >> 3] = ALL_RIGHTS;
        return ESUCCESS;
      }
      const file = openFiles.get(fd);
      if (!file) {
        return EBADF;
      }
      memU8()[stat_out] = file.isDir ? 3 : 4; // REGULAR_FILE = 4
      if (file.isAppend) {
        memU8()[stat_out + 2] = 1; // __WASI_FDFLAG_APPEND
      }
      view[(stat_out + 8) >> 3] = ALL_RIGHTS;
      view[(stat_out + 16) >> 3] = ALL_RIGHTS;
      return ESUCCESS;
    },

    fd_fdstat_set_flags(fd, flags) {
      const file = openFiles.get(fd);
      if (file) {
        file.isAppend = (flags & 1) !== 0;
      }
      return ESUCCESS;
    },

    fd_fdstat_set_rights() { return ESUCCESS; },

    fd_filestat_get(fd, stat_out) {
      memU8().fill(0, stat_out, stat_out + 64);
      const view = new BigInt64Array(memoryInstance.buffer);
      const nowNs = BigInt(Date.now()) * 1000000n;

      if (fd === 0 || fd === 1 || fd === 2) {
        memU8()[stat_out + 16] = 2; // CHARACTER_DEVICE
        view[(stat_out + 24) >> 3] = 1n;
        view[(stat_out + 32) >> 3] = 0n;
        view[(stat_out + 40) >> 3] = nowNs;
        view[(stat_out + 48) >> 3] = nowNs;
        view[(stat_out + 56) >> 3] = nowNs;
        return ESUCCESS;
      }

      if (fd === 3 || fd === 4 || fd === 5) {
        memU8()[stat_out + 16] = 3; // DIRECTORY
        view[(stat_out + 24) >> 3] = 1n;
        view[(stat_out + 32) >> 3] = 0n;
        view[(stat_out + 40) >> 3] = nowNs;
        view[(stat_out + 48) >> 3] = nowNs;
        view[(stat_out + 56) >> 3] = nowNs;
        return ESUCCESS;
      }

      const file = openFiles.get(fd);
      if (!file) {
        return EBADF;
      }

      if (file.isDir) {
        memU8()[stat_out + 16] = 3;
        view[(stat_out + 24) >> 3] = 1n;
        view[(stat_out + 32) >> 3] = 0n;
      } else {
        const data = fsMap.get(file.path) || new Uint8Array(0);
        memU8()[stat_out + 16] = 4;
        view[(stat_out + 24) >> 3] = 1n;
        view[(stat_out + 32) >> 3] = BigInt(data.length);
      }

      view[(stat_out + 40) >> 3] = nowNs;
      view[(stat_out + 48) >> 3] = nowNs;
      view[(stat_out + 56) >> 3] = nowNs;
      return ESUCCESS;
    },

    fd_filestat_set_size(fd, size) {
      const file = openFiles.get(fd);
      if (!file || file.isDir || !file.canWrite) {
        return EBADF;
      }
      const targetLen = Math.max(0, Number(size));
      const data = fsMap.get(file.path) || new Uint8Array(0);
      const nextData = new Uint8Array(targetLen);
      nextData.set(data.subarray(0, Math.min(data.length, targetLen)));
      fsMap.set(file.path, nextData);
      changedFiles.set(file.path, nextData);
      return ESUCCESS;
    },

    fd_filestat_set_times() { return ESUCCESS; },

    fd_pread(fd, iovs, iovs_len, offset, nread_out) {
      const file = openFiles.get(fd);
      if (!file || file.isDir || !file.canRead) return EBADF;
      const data = fsMap.get(file.path) || new Uint8Array(0);
      let pos = Number(offset);
      let totalRead = 0;
      for (let i = 0; i < iovs_len; i++) {
        const bufPtr = memU32()[(iovs >> 2) + i * 2];
        const bufLen = memU32()[(iovs >> 2) + i * 2 + 1];
        if (bufLen <= 0) continue;
        const available = Math.max(0, data.length - pos);
        if (available === 0) break;
        const toCopy = Math.min(bufLen, available);
        memU8().set(data.subarray(pos, pos + toCopy), bufPtr);
        pos += toCopy;
        totalRead += toCopy;
        if (toCopy < bufLen) break;
      }
      memU32()[nread_out >> 2] = totalRead;
      return ESUCCESS;
    },

    fd_pwrite(fd, iovs, iovs_len, offset, nwritten_out) {
      const file = openFiles.get(fd);
      if (!file || file.isDir || !file.canWrite) return EBADF;
      let data = fsMap.get(file.path) || new Uint8Array(0);
      let pos = Number(offset);
      let totalWritten = 0;
      for (let i = 0; i < iovs_len; i++) {
        const bufPtr = memU32()[(iovs >> 2) + i * 2];
        const bufLen = memU32()[(iovs >> 2) + i * 2 + 1];
        if (bufLen <= 0) continue;
        const needed = pos + bufLen;
        if (needed > data.length) {
          const nextData = new Uint8Array(needed);
          nextData.set(data);
          data = nextData;
          fsMap.set(file.path, data);
        }
        data.set(memU8().subarray(bufPtr, bufPtr + bufLen), pos);
        pos += bufLen;
        totalWritten += bufLen;
      }
      changedFiles.set(file.path, data);
      deletedFiles.delete(file.path);
      memU32()[nwritten_out >> 2] = totalWritten;
      return ESUCCESS;
    },

    fd_sync(fd) {
      if (openFiles.has(fd)) {
        const file = openFiles.get(fd);
        if (changedFiles.has(file.path)) {
          const data = fsMap.get(file.path);
          try {
            self.postMessage({ type: 'file_sync', path: file.path, data });
          } catch (_) {}
        }
      }
      return ESUCCESS;
    },

    fd_datasync(fd) {
      return wasi.fd_sync(fd);
    },

    fd_allocate() { return ESUCCESS; },
    fd_advise() { return ESUCCESS; },

    fd_readdir(fd, buf, buf_len, cookie, nwritten_out) {
      let dirPath = '/workspace';
      if (fd === 3 || fd === 4) dirPath = '/workspace';
      else if (fd === 5) dirPath = '/';
      else if (openFiles.has(fd) && openFiles.get(fd).isDir) dirPath = openFiles.get(fd).path;
      else return EBADF;

      const entries = [];
      const seen = new Set();
      const prefix = dirPath === '/' ? '/' : `${dirPath}/`;
      for (const p of fsMap.keys()) {
        if (p.startsWith(prefix)) {
          const rest = p.substring(prefix.length);
          const name = rest.split('/')[0];
          if (name && !seen.has(name)) {
            seen.add(name);
            const isSubDir = rest.includes('/');
            entries.push({ name, isDir: isSubDir });
          }
        }
      }

      let cookieIndex = Number(cookie);
      let written = 0;
      for (let i = cookieIndex; i < entries.length; i++) {
        const entry = entries[i];
        const nameBytes = new TextEncoder().encode(entry.name);
        const entryLen = 24 + nameBytes.length;
        if (written + entryLen > buf_len) break;

        const base = buf + written;
        memU8().fill(0, base, base + 24);
        const view = new BigInt64Array(memoryInstance.buffer);
        view[base >> 3] = BigInt(i + 1); // d_next
        view[(base + 8) >> 3] = BigInt(i + 1); // d_ino
        memU32()[(base + 16) >> 2] = nameBytes.length; // d_namlen
        memU8()[base + 20] = entry.isDir ? 3 : 4; // d_type

        memU8().set(nameBytes, base + 24);
        written += entryLen;
      }
      memU32()[nwritten_out >> 2] = written;
      return ESUCCESS;
    },

    fd_renumber() { return EBADF; },

    fd_prestat_get(fd, stat_out) {
      let name = null;
      if (fd === 3) name = '.';
      else return EBADF;

      memU8().fill(0, stat_out, stat_out + 8);
      memU8()[stat_out] = 0; // __WASI_PREOPENTYPE_DIR
      memU32()[(stat_out + 4) >> 2] = name.length;
      return ESUCCESS;
    },

    fd_prestat_dir_name(fd, path_ptr, path_len) {
      let name = null;
      if (fd === 3) name = '.';
      else return EBADF;

      const toCopy = Math.min(name.length, path_len);
      for (let i = 0; i < toCopy; i++) {
        memU8()[path_ptr + i] = name.charCodeAt(i);
      }
      return ESUCCESS;
    },

    path_open(dirfd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fdflags, opened_fd_ptr) {
      const pathStr = readStr(memU8(), path_ptr, path_len);
      const fullPath = resolvePath(dirfd, pathStr);

      const WASI_O_CREAT = 1;
      const WASI_O_DIRECTORY = 2;
      const WASI_O_EXCL = 4;
      const WASI_O_TRUNC = 8;
      const WASI_FDFLAG_APPEND = 1;

      if (oflags & WASI_O_DIRECTORY) {
        if (isDir(fullPath)) {
          const fd = nextFd++;
          openFiles.set(fd, {
            fd,
            path: fullPath,
            isDir: true,
            canRead: true,
            canWrite: false,
            isAppend: false,
            cursor: 0,
          });
          memU32()[opened_fd_ptr >> 2] = fd;
          return ESUCCESS;
        }
        return fsMap.has(fullPath) ? ENOTDIR : ENOENT;
      }

      const exists = fsMap.has(fullPath);

      if (exists && isDir(fullPath)) {
        return EISDIR;
      }

      if (exists) {
        if ((oflags & WASI_O_CREAT) && (oflags & WASI_O_EXCL)) {
          return EEXIST;
        }
        if (oflags & WASI_O_TRUNC) {
          const empty = new Uint8Array(0);
          fsMap.set(fullPath, empty);
          changedFiles.set(fullPath, empty);
          deletedFiles.delete(fullPath);
        }
      } else {
        if (!(oflags & WASI_O_CREAT)) {
          return ENOENT;
        }
        const empty = new Uint8Array(0);
        fsMap.set(fullPath, empty);
        changedFiles.set(fullPath, empty);
        deletedFiles.delete(fullPath);

        let p = fullPath;
        while (p.lastIndexOf('/') > 0) {
          p = p.substring(0, p.lastIndexOf('/'));
          createdDirs.add(p);
        }
      }

      const rightsBig = typeof fs_rights_base === 'bigint' ? fs_rights_base : BigInt(fs_rights_base || 0);
      const canRead = (rightsBig === 0n) || ((rightsBig & (1n << 1n)) !== 0n);
      const canWrite = (rightsBig === 0n)
        ? Boolean((oflags & (WASI_O_CREAT | WASI_O_TRUNC)) || (fdflags & WASI_FDFLAG_APPEND))
        : ((rightsBig & (1n << 6n)) !== 0n);
      const isAppend = (fdflags & WASI_FDFLAG_APPEND) !== 0;

      const curData = fsMap.get(fullPath) || new Uint8Array(0);
      const fd = nextFd++;
      openFiles.set(fd, {
        fd,
        path: fullPath,
        isDir: false,
        canRead,
        canWrite,
        isAppend,
        cursor: isAppend ? curData.length : 0,
      });

      memU32()[opened_fd_ptr >> 2] = fd;
      return ESUCCESS;
    },

    path_filestat_get(dirfd, flags, path_ptr, path_len, stat_out) {
      const pathStr = readStr(memU8(), path_ptr, path_len);
      const fullPath = resolvePath(dirfd, pathStr);

      memU8().fill(0, stat_out, stat_out + 64);
      const view = new BigInt64Array(memoryInstance.buffer);
      const nowNs = BigInt(Date.now()) * 1000000n;

      if (isDir(fullPath)) {
        memU8()[stat_out + 16] = 3; // DIRECTORY
        view[(stat_out + 24) >> 3] = 1n;
        view[(stat_out + 32) >> 3] = 0n;
        view[(stat_out + 40) >> 3] = nowNs;
        view[(stat_out + 48) >> 3] = nowNs;
        view[(stat_out + 56) >> 3] = nowNs;
        return ESUCCESS;
      }

      if (fsMap.has(fullPath)) {
        const data = fsMap.get(fullPath) || new Uint8Array(0);
        memU8()[stat_out + 16] = 4; // REGULAR_FILE
        view[(stat_out + 24) >> 3] = 1n;
        view[(stat_out + 32) >> 3] = BigInt(data.length);
        view[(stat_out + 40) >> 3] = nowNs;
        view[(stat_out + 48) >> 3] = nowNs;
        view[(stat_out + 56) >> 3] = nowNs;
        return ESUCCESS;
      }

      return ENOENT;
    },

    path_filestat_set_times() { return ESUCCESS; },
    path_create_directory(dirfd, path_ptr, path_len) {
      const pathStr = readStr(memU8(), path_ptr, path_len);
      const fullPath = resolvePath(dirfd, pathStr);
      createdDirs.add(fullPath);
      return ESUCCESS;
    },
    path_link() { return ENOSYS; },
    path_readlink() { return ENOSYS; },

    path_rename(old_dirfd, old_path_ptr, old_path_len, new_dirfd, new_path_ptr, new_path_len) {
      const oldPathStr = readStr(memU8(), old_path_ptr, old_path_len);
      const newPathStr = readStr(memU8(), new_path_ptr, new_path_len);
      const oldFullPath = resolvePath(old_dirfd, oldPathStr);
      const newFullPath = resolvePath(new_dirfd, newPathStr);

      if (fsMap.has(oldFullPath)) {
        const data = fsMap.get(oldFullPath);
        fsMap.delete(oldFullPath);
        changedFiles.delete(oldFullPath);
        deletedFiles.add(oldFullPath);

        fsMap.set(newFullPath, data);
        changedFiles.set(newFullPath, data);
        deletedFiles.delete(newFullPath);

        try {
          self.postMessage({ type: 'file_delete', path: oldFullPath });
          self.postMessage({ type: 'file_sync', path: newFullPath, data });
        } catch (_) {}
        return ESUCCESS;
      }
      return ENOENT;
    },

    path_symlink() { return ENOSYS; },

    path_unlink_file(dirfd, path_ptr, path_len) {
      const pathStr = readStr(memU8(), path_ptr, path_len);
      const fullPath = resolvePath(dirfd, pathStr);

      if (fsMap.has(fullPath)) {
        fsMap.delete(fullPath);
        changedFiles.delete(fullPath);
        deletedFiles.add(fullPath);
        try {
          self.postMessage({ type: 'file_delete', path: fullPath });
        } catch (_) {}
        return ESUCCESS;
      }
      return ENOENT;
    },

    path_remove_directory(dirfd, path_ptr, path_len) {
      const pathStr = readStr(memU8(), path_ptr, path_len);
      const fullPath = resolvePath(dirfd, pathStr);
      createdDirs.delete(fullPath);
      return ESUCCESS;
    },

    environ_sizes_get(count_out, size_out) {
      const keys = Object.keys(environ);
      let size = 0;
      for (const k of keys) {
        size += k.length + environ[k].length + 2;
      }
      memU32()[count_out >> 2] = keys.length;
      memU32()[size_out >> 2] = size;
      return ESUCCESS;
    },

    environ_get(ptrs, buf) {
      let b = buf;
      let p = ptrs >> 2;
      for (const k of Object.keys(environ)) {
        memU32()[p++] = b;
        const entry = `${k}=${environ[k]}\0`;
        for (let i = 0; i < entry.length; i++) {
          memU8()[b++] = entry.charCodeAt(i);
        }
      }
      return ESUCCESS;
    },

    args_sizes_get(argc_out, size_out) {
      let size = 0;
      for (const a of argv) {
        size += a.length + 1;
      }
      memU32()[argc_out >> 2] = argv.length;
      memU32()[size_out >> 2] = size;
      return ESUCCESS;
    },

    args_get(ptrs, buf) {
      let b = buf;
      let p = ptrs >> 2;
      for (const a of argv) {
        memU32()[p++] = b;
        for (let i = 0; i < a.length; i++) {
          memU8()[b++] = a.charCodeAt(i);
        }
        memU8()[b++] = 0;
      }
      return ESUCCESS;
    },

    clock_time_get(clock_id, precision, time_out) {
      const now = BigInt(Date.now()) * 1000000n;
      const view = new BigInt64Array(memoryInstance.buffer);
      view[time_out >> 3] = now;
      return ESUCCESS;
    },

    clock_res_get(clock_id, res_out) {
      const view = new BigInt64Array(memoryInstance.buffer);
      view[res_out >> 3] = 1000n;
      return ESUCCESS;
    },

    random_get(buf, len) {
      crypto.getRandomValues(memU8().subarray(buf, buf + len));
      return ESUCCESS;
    },

    poll_oneoff() { return ESUCCESS; },
    sched_yield() { return ESUCCESS; },
  };

  const wasiProxy = new Proxy(wasi, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => ESUCCESS;
    }
  });

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
  const hasRaylib = importsList.some(i => i.module === 'raylib' || i.module === 'gl');

  const importObject = {
    wasi_snapshot_preview1: wasiProxy,
    wasi_unstable: wasiProxy,
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
    });

    const raylibImports = raylibHost.getImports();
    importObject.gl = new Proxy(raylibImports.gl, {
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

  return { changedFiles, deletedFiles };
}
