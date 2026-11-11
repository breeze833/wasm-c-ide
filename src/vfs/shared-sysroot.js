// Shared Read-Only Sysroot (SharedSysroot)
// Packs standard C/C++ sysroot headers and static runtime libraries into a single
// memory-mapped SharedArrayBuffer, enabling zero-copy, zero-heap-duplication VFS reads
// across the Tri-Worker architecture (compiler.worker.js, shell.worker.js, runtime.worker.js).

import { normalizePath } from './vfs.js';
import { Tar } from '../toolchain/tar.js';
import {
  STANDARD_C_HEADERS,
  STANDARD_CPP_HEADERS,
  STANDARD_LIBS,
  WASM_HOST_IMPORTS,
  BIN_COMMANDS,
  USR_BIN_COMMANDS,
} from './sysroot.js';

export const SSYS_MAGIC = 0x53535953; // 'SSYS' in little-endian
export const SSYS_VERSION = 1;
export const HEADER_SIZE = 64;
export const ENTRY_SIZE = 32;

export function fnv1a(str) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * Builds a contiguous, memory-mapped SharedArrayBuffer containing all sysroot files.
 * @param {Array<{path: string, content?: Uint8Array|string, isDir?: boolean, mtime?: number, mode?: number}>|Record<string, Uint8Array|string>} inputEntries
 * @param {object} [options]
 * @param {boolean} [options.useArrayBuffer=false] Force standard ArrayBuffer instead of SharedArrayBuffer
 * @returns {SharedArrayBuffer|ArrayBuffer}
 */
export function buildSharedSysroot(inputEntries, options = {}) {
  const fileMap = new Map();
  const dirSet = new Set(['/']);

  function addDir(dirPath) {
    const norm = normalizePath(dirPath);
    if (!norm || norm === '/') return;
    const parts = norm.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += '/' + p;
      dirSet.add(cur);
    }
  }

  // Normalize input entries
  if (Array.isArray(inputEntries)) {
    for (const item of inputEntries) {
      if (!item || !item.path) continue;
      const norm = normalizePath(item.path);
      if (item.isDir) {
        addDir(norm);
      } else {
        const u8 = typeof item.content === 'string'
          ? new TextEncoder().encode(item.content)
          : (item.content instanceof Uint8Array
              ? item.content
              : (item.content ? new Uint8Array(item.content) : new Uint8Array(0)));
        fileMap.set(norm, {
          content: u8,
          mtime: item.mtime || Date.now(),
          mode: item.mode || 0o100444, // S_IFREG | r--r--r--
          isDir: false,
        });
        const lastSlash = norm.lastIndexOf('/');
        if (lastSlash > 0) {
          addDir(norm.substring(0, lastSlash));
        }
      }
    }
  } else if (inputEntries && typeof inputEntries === 'object') {
    for (const [path, val] of Object.entries(inputEntries)) {
      const norm = normalizePath(path);
      const u8 = typeof val === 'string'
        ? new TextEncoder().encode(val)
        : (val instanceof Uint8Array ? val : new Uint8Array(val || 0));
      fileMap.set(norm, {
        content: u8,
        mtime: Date.now(),
        mode: 0o100444,
        isDir: false,
      });
      const lastSlash = norm.lastIndexOf('/');
      if (lastSlash > 0) {
        addDir(norm.substring(0, lastSlash));
      }
    }
  }

  // Collect all entries (directories + files)
  const allEntries = [];
  for (const d of Array.from(dirSet).sort()) {
    allEntries.push({
      path: d,
      isDir: true,
      content: null,
      mtime: Date.now(),
      mode: 0o040555, // S_IFDIR | r-xr-xr-x
    });
  }

  for (const [p, item] of fileMap.entries()) {
    allEntries.push({
      path: p,
      isDir: false,
      content: item.content,
      mtime: item.mtime,
      mode: item.mode,
    });
  }

  const count = allEntries.length;
  const indexTableSize = count * ENTRY_SIZE;

  // Pre-calculate string table and data segment sizes
  const encoder = new TextEncoder();
  const encodedPaths = allEntries.map(e => encoder.encode(e.path));
  let stringTableSize = 0;
  for (const pBytes of encodedPaths) {
    stringTableSize += pBytes.byteLength;
  }
  // Align string table to 8 bytes
  const alignedStringTableSize = (stringTableSize + 7) & ~7;

  let dataSegmentSize = 0;
  for (const e of allEntries) {
    if (!e.isDir && e.content) {
      dataSegmentSize += (e.content.byteLength + 3) & ~3; // 4-byte align each file data
    }
  }

  const stringTableOffset = HEADER_SIZE + indexTableSize;
  const dataSegmentOffset = stringTableOffset + alignedStringTableSize;
  const totalBufferSize = dataSegmentOffset + dataSegmentSize;

  const BufferClass = (typeof SharedArrayBuffer !== 'undefined' && !options.useArrayBuffer)
    ? SharedArrayBuffer
    : ArrayBuffer;
  const buffer = new BufferClass(totalBufferSize);

  const u8 = new Uint8Array(buffer);
  const dataView = new DataView(buffer);

  // Write header
  dataView.setUint32(0x00, SSYS_MAGIC, true);
  dataView.setUint32(0x04, SSYS_VERSION, true);
  dataView.setUint32(0x08, count, true);
  dataView.setUint32(0x0C, stringTableOffset, true);
  dataView.setUint32(0x10, stringTableSize, true);
  dataView.setUint32(0x14, dataSegmentOffset, true);
  dataView.setUint32(0x18, dataSegmentSize, true);
  dataView.setUint32(0x1C, totalBufferSize, true);

  // Write index table, string table, and data segment
  let curStrOffset = 0;
  let curDataOffset = 0;

  for (let i = 0; i < count; i++) {
    const entry = allEntries[i];
    const pBytes = encodedPaths[i];
    const pathLen = pBytes.byteLength;
    const entryOffset = HEADER_SIZE + i * ENTRY_SIZE;
    const hash = fnv1a(entry.path);

    // Copy path bytes to string table
    u8.set(pBytes, stringTableOffset + curStrOffset);

    let fileDataOffset = 0;
    let fileDataLen = 0;

    if (!entry.isDir && entry.content) {
      fileDataOffset = curDataOffset;
      fileDataLen = entry.content.byteLength;
      u8.set(entry.content, dataSegmentOffset + curDataOffset);
      curDataOffset += (fileDataLen + 3) & ~3;
    }

    // Write index entry (32 bytes)
    dataView.setUint32(entryOffset + 0x00, hash, true);
    dataView.setUint32(entryOffset + 0x04, curStrOffset, true);
    dataView.setUint32(entryOffset + 0x08, pathLen, true);
    dataView.setUint32(entryOffset + 0x0C, fileDataOffset, true);
    dataView.setUint32(entryOffset + 0x10, fileDataLen, true);
    dataView.setUint32(entryOffset + 0x14, entry.mode, true);
    dataView.setUint32(entryOffset + 0x18, Math.floor(entry.mtime / 1000), true);
    dataView.setUint32(entryOffset + 0x1C, entry.isDir ? 1 : 0, true);

    curStrOffset += pathLen;
  }

  return buffer;
}

/**
 * Reader client for the memory-mapped SharedSysroot buffer.
 * Provides O(1) file lookups, zero-copy Uint8Array views, and unified directory queries.
 */
export class SharedSysrootReader {
  /**
   * @param {SharedArrayBuffer|ArrayBuffer} buffer
   */
  constructor(buffer) {
    if (!buffer) {
      throw new Error('SharedSysrootReader: buffer is required');
    }

    this.buffer = buffer;
    this.dataView = new DataView(buffer);
    this.u8 = new Uint8Array(buffer);

    const magic = this.dataView.getUint32(0x00, true);
    if (magic !== SSYS_MAGIC) {
      throw new Error(`SharedSysrootReader: Invalid magic 0x${magic.toString(16)} (expected 0x${SSYS_MAGIC.toString(16)})`);
    }

    this.version = this.dataView.getUint32(0x04, true);
    this.count = this.dataView.getUint32(0x08, true);
    this.stringTableOffset = this.dataView.getUint32(0x0C, true);
    this.stringTableSize = this.dataView.getUint32(0x10, true);
    this.dataSegmentOffset = this.dataView.getUint32(0x14, true);
    this.dataSegmentSize = this.dataView.getUint32(0x18, true);
    this.totalBufferSize = this.dataView.getUint32(0x1C, true);

    this.entries = new Map();
    this.dirChildren = new Map();

    this._parseIndex();
  }

  _parseIndex() {
    const decoder = new TextDecoder();

    // Copy string table bytes into an unshared buffer so TextDecoder can safely decode paths
    // (W3C Encoding Standard forbids decoding directly from SharedArrayBuffer views)
    const strTableBytes = new Uint8Array(this.stringTableSize);
    strTableBytes.set(this.u8.subarray(this.stringTableOffset, this.stringTableOffset + this.stringTableSize));

    for (let i = 0; i < this.count; i++) {
      const entryOffset = HEADER_SIZE + i * ENTRY_SIZE;
      const strOffset = this.dataView.getUint32(entryOffset + 0x04, true);
      const strLen = this.dataView.getUint32(entryOffset + 0x08, true);
      const dataOffset = this.dataView.getUint32(entryOffset + 0x0C, true);
      const dataLen = this.dataView.getUint32(entryOffset + 0x10, true);
      const mode = this.dataView.getUint32(entryOffset + 0x14, true);
      const mtimeSec = this.dataView.getUint32(entryOffset + 0x18, true);
      const isDir = this.dataView.getUint32(entryOffset + 0x1C, true) === 1;

      const pathBytes = strTableBytes.subarray(strOffset, strOffset + strLen);
      const path = decoder.decode(pathBytes);

      const entry = {
        path,
        isDir,
        dataOffset,
        dataLength: dataLen,
        mode,
        mtime: mtimeSec * 1000,
      };

      this.entries.set(path, entry);

      // Track child entries for readdir
      if (path !== '/') {
        const lastSlash = path.lastIndexOf('/');
        const parentDir = lastSlash === 0 ? '/' : path.substring(0, lastSlash);
        const childName = path.substring(lastSlash + 1);

        let children = this.dirChildren.get(parentDir);
        if (!children) {
          children = new Set();
          this.dirChildren.set(parentDir, children);
        }
        children.add(childName);
      }
    }
  }

  exists(path) {
    const norm = normalizePath(path);
    return this.entries.has(norm);
  }

  isDir(path) {
    const norm = normalizePath(path);
    const entry = this.entries.get(norm);
    return entry ? entry.isDir : false;
  }

  stat(path) {
    const norm = normalizePath(path);
    const entry = this.entries.get(norm);
    if (!entry) return null;

    const lastSlash = norm.lastIndexOf('/');
    const name = lastSlash >= 0 ? norm.substring(lastSlash + 1) : norm;

    return {
      name,
      isDir: entry.isDir,
      size: entry.isDir ? 0 : entry.dataLength,
      mtime: entry.mtime,
      mode: entry.mode,
    };
  }

  readFile(path, asText = false) {
    const norm = normalizePath(path);
    const entry = this.entries.get(norm);
    if (!entry) {
      throw new Error(`No such file or directory: ${norm}`);
    }
    if (entry.isDir) {
      throw new Error(`Is a directory: ${norm}`);
    }

    const start = this.dataSegmentOffset + entry.dataOffset;
    const view = this.u8.subarray(start, start + entry.dataLength);

    if (asText) {
      if (typeof SharedArrayBuffer !== 'undefined' && view.buffer instanceof SharedArrayBuffer) {
        const unshared = new Uint8Array(view.byteLength);
        unshared.set(view);
        return new TextDecoder().decode(unshared);
      }
      return new TextDecoder().decode(view);
    }
    return view;
  }

  readDir(path) {
    const norm = normalizePath(path);
    const entry = this.entries.get(norm);
    if (!entry) {
      throw new Error(`No such file or directory: ${norm}`);
    }
    if (!entry.isDir) {
      throw new Error(`Not a directory: ${norm}`);
    }

    const childrenNames = this.dirChildren.get(norm);
    if (!childrenNames) return [];

    const results = [];
    for (const name of childrenNames) {
      const childPath = norm === '/' ? `/${name}` : `${norm}/${name}`;
      const child = this.entries.get(childPath);
      if (child) {
        results.push({
          name,
          isDir: child.isDir,
          size: child.isDir ? 0 : child.dataLength,
          mtime: child.mtime,
          mode: child.mode,
        });
      }
    }

    return results.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  getAllPaths() {
    return Array.from(this.entries.keys());
  }
}

/**
 * Creates a SharedSysroot buffer from an uncompressed or decompressed sysroot tar buffer,
 * integrating standard libc/libc++ headers, mirrors, symlinks, and virtual custom headers.
 * @param {ArrayBuffer|Uint8Array} tarBuffer
 * @param {object} [options]
 * @returns {SharedArrayBuffer|ArrayBuffer}
 */
export function createSharedSysrootFromTar(tarBuffer, options = {}) {
  const tar = new Tar(tarBuffer);
  const entries = tar.getEntries();
  const fileEntries = [];

  const fileContentMap = new Map();
  for (const entry of entries) {
    const cleanName = (entry.filename || '').replace(/^\.?\/+/, '');
    if (!cleanName) continue;
    if (entry.type === '5') {
      fileEntries.push({ path: '/' + cleanName, isDir: true, mode: 0o040555 });
    } else if (entry.contents) {
      const fullPath = '/' + cleanName;
      fileContentMap.set(fullPath, entry.contents);
      fileEntries.push({ path: fullPath, content: entry.contents, isDir: false });

      // Mirror libraries
      if (cleanName.startsWith('lib/wasm32-wasip1/')) {
        const libName = cleanName.substring('lib/wasm32-wasip1/'.length);
        if (libName) {
          fileEntries.push({ path: `/usr/lib/${libName}`, content: entry.contents, isDir: false });
          fileEntries.push({ path: `/lib/wasm32-wasi/${libName}`, content: entry.contents, isDir: false });
        }
      } else if (cleanName.startsWith('lib/wasm32-wasi/')) {
        const libName = cleanName.substring('lib/wasm32-wasi/'.length);
        if (libName) {
          fileEntries.push({ path: `/usr/lib/${libName}`, content: entry.contents, isDir: false });
          fileEntries.push({ path: `/lib/wasm32-wasip1/${libName}`, content: entry.contents, isDir: false });
        }
      }

      // Mirror headers
      if (cleanName.startsWith('include/wasm32-wasip1/')) {
        const sub = cleanName.substring('include/wasm32-wasip1/'.length);
        if (sub && !sub.startsWith('c++/')) {
          fileEntries.push({ path: `/usr/include/${sub}`, content: entry.contents, isDir: false });
          fileEntries.push({ path: `/include/${sub}`, content: entry.contents, isDir: false });
        }
      } else if (cleanName.startsWith('include/')) {
        const sub = cleanName.substring('include/'.length);
        if (sub && !sub.startsWith('wasm32-') && !sub.startsWith('c++/')) {
          fileEntries.push({ path: `/usr/include/${sub}`, content: entry.contents, isDir: false });
        }
      }
    }
  }

  // Resolve symlinks
  for (const entry of entries) {
    if (entry.type === '2' && entry.linkname) {
      const cleanName = (entry.filename || '').replace(/^\.?\/+/, '');
      if (!cleanName) continue;
      const lastSlash = cleanName.lastIndexOf('/');
      const parentDir = lastSlash !== -1 ? cleanName.substring(0, lastSlash) : '';
      let targetPath = entry.linkname.replace(/^\.?\/+/, '');
      if (parentDir && !entry.linkname.startsWith('/')) {
        targetPath = `${parentDir}/${targetPath}`;
      }
      const targetFullPath = '/' + targetPath.replace(/^\.?\/+/, '');
      const content = fileContentMap.get(targetFullPath);
      if (content) {
        fileEntries.push({ path: '/' + cleanName, content, isDir: false });
      }
    }
  }

  // Custom virtual headers & library stubs from sysroot.js
  for (const [filename, content] of Object.entries(STANDARD_C_HEADERS)) {
    fileEntries.push({ path: `/usr/include/${filename}`, content, isDir: false });
  }
  for (const [filename, content] of Object.entries(STANDARD_CPP_HEADERS)) {
    fileEntries.push({ path: `/usr/include/${filename}`, content, isDir: false });
  }
  for (const lib of STANDARD_LIBS) {
    fileEntries.push({ path: `/usr/lib/${lib}`, content: `!<arch>\n/* ${lib} wasi-libc */\n`, isDir: false });
  }
  fileEntries.push({
    path: '/usr/lib/wasm-host-imports.txt',
    content: WASM_HOST_IMPORTS.join('\n') + '\n',
    isDir: false,
  });

  const wasmBinaryStub = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  for (const cmd of BIN_COMMANDS) {
    fileEntries.push({ path: `/bin/${cmd}`, content: wasmBinaryStub, isDir: false });
  }
  for (const cmd of USR_BIN_COMMANDS) {
    fileEntries.push({ path: `/usr/bin/${cmd}`, content: wasmBinaryStub, isDir: false });
  }

  // Append any explicitly provided additional entries (e.g. preloaded static libraries)
  if (Array.isArray(options.additionalEntries)) {
    for (const item of options.additionalEntries) {
      if (item && item.path) {
        fileEntries.push(item);
      }
    }
  }

  return buildSharedSysroot(fileEntries, options);
}

/**
 * Loads sysroot.tar.gz from network, decompresses it, and packs it into a SharedArrayBuffer.
 * @param {string} [basePath='/sysroot/wasm']
 * @param {(status: string) => void} [onProgress]
 * @param {object} [options]
 * @returns {Promise<SharedArrayBuffer|ArrayBuffer>}
 */
export async function loadOrBuildSharedSysroot(basePath = '/sysroot/wasm', onProgress = () => {}, options = {}) {
  const cleanBase = (basePath || '/sysroot/wasm').replace(/\/+$/, '');

  onProgress('Fetching standard library sysroot archive (sysroot.tar.gz)...');
  const fetchTar = async () => {
    try {
      const res = await fetch(`${cleanBase}/sysroot.tar.gz`);
      if (res && (res.ok || typeof res.ok === 'undefined')) {
        const buf = await res.arrayBuffer();
        const u8 = new Uint8Array(buf);
        if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
          if (typeof DecompressionStream !== 'undefined') {
            onProgress('Decompressing sysroot archive (gzip, ~108MB)...');
            const stream = new Response(u8).body.pipeThrough(new DecompressionStream('gzip'));
            return await new Response(stream).arrayBuffer();
          }
        }
        return buf;
      }
    } catch (_) {}
    return await fetch(`${cleanBase}/sysroot.tar`).then(r => r.arrayBuffer());
  };

  const preloadConfigs = [
    {
      file: 'libturtle.a',
      targets: [
        '/usr/lib/libturtle.a',
        '/usr/lib/libturtle_canvas-wasi.a',
        '/lib/wasm32-wasip1/libturtle.a',
        '/lib/wasm32-wasip1/libturtle_canvas-wasi.a',
        '/lib/wasm32-wasi/libturtle.a',
        '/lib/wasm32-wasi/libturtle_canvas-wasi.a',
      ],
    },
    {
      file: 'libraylib.a',
      targets: [
        '/usr/lib/libraylib.a',
        '/lib/wasm32-wasip1/libraylib.a',
        '/lib/wasm32-wasi/libraylib.a',
      ],
    },
    {
      file: 'libturtle_raylib.a',
      targets: [
        '/usr/lib/libturtle_raylib.a',
        '/lib/wasm32-wasip1/libturtle_raylib.a',
        '/lib/wasm32-wasi/libturtle_raylib.a',
      ],
    },
    {
      file: 'libsqlite3.a',
      targets: [
        '/usr/lib/libsqlite3.a',
        '/lib/wasm32-wasip1/libsqlite3.a',
        '/lib/wasm32-wasi/libsqlite3.a',
      ],
    },
  ];

  const additionalEntries = Array.isArray(options.additionalEntries) ? [...options.additionalEntries] : [];
  if (options.preloadLibraries !== false) {
    onProgress('Preloading runtime libraries (libraylib, libturtle, libsqlite3)...');
    await Promise.all(
      preloadConfigs.map(async (cfg) => {
        try {
          const res = await fetch(`${cleanBase}/${cfg.file}`);
          if (res && (res.ok || typeof res.ok === 'undefined')) {
            const buf = await res.arrayBuffer();
            const u8 = new Uint8Array(buf);
            for (const target of cfg.targets) {
              additionalEntries.push({ path: target, content: u8, isDir: false });
            }
          }
        } catch (_) {}
      })
    );
  }

  const tarBuf = await fetchTar();
  onProgress('Packing sysroot into shared memory buffer...');
  return createSharedSysrootFromTar(tarBuf, { ...options, additionalEntries });
}
