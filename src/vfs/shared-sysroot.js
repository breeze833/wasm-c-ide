// Shared Read-Only Sysroot (SharedSysroot)
// Composes vfs-wasi SSYS binary format and SharedSysrootReader
// with wasm-c-ide toolchain tarball unpacking and sysroot preloading.

import {
  SSYS_MAGIC,
  SSYS_VERSION,
  HEADER_SIZE,
  ENTRY_SIZE,
  fnv1a,
  buildSharedSysroot,
  SharedSysrootReader,
} from 'vfs-wasi';

import { normalizePath } from './vfs.js';
import { Tar } from '../toolchain/tar.js';
import {
  STANDARD_LIBS,
  WASM_HOST_IMPORTS,
  BIN_COMMANDS,
  USR_BIN_COMMANDS,
} from './sysroot.js';

export {
  SSYS_MAGIC,
  SSYS_VERSION,
  HEADER_SIZE,
  ENTRY_SIZE,
  fnv1a,
  buildSharedSysroot,
  SharedSysrootReader,
};

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

  // Library stubs and host imports from sysroot.js
  const existingPaths = new Set(fileEntries.map(e => e.path));

  for (const lib of STANDARD_LIBS) {
    const p = `/usr/lib/${lib}`;
    if (!existingPaths.has(p)) {
      fileEntries.push({ path: p, content: `!<arch>\n/* ${lib} wasi-libc */\n`, isDir: false });
      existingPaths.add(p);
    }
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
 * Fetches a resource while reporting download progress if ReadableStream is available.
 * Gracefully falls back if body is not streamable (e.g. in test environments with mock fetch).
 *
 * @param {string|URL|Request} url
 * @param {object} [options]
 * @param {(progress: { loaded: number, total: number }) => void} [options.onProgress]
 * @returns {Promise<Response>}
 */
export async function fetchWithProgress(url, options = {}) {
  const { onProgress, ...fetchOptions } = options;
  const res = await fetch(url, fetchOptions);

  if (!res || (typeof res.ok !== 'undefined' && !res.ok)) {
    return res;
  }

  // Fallback for mock environments (like tests where res.body or getReader is not implemented)
  if (!res.body || typeof res.body.getReader !== 'function') {
    return res;
  }

  const contentLengthHeader = res.headers && typeof res.headers.get === 'function'
    ? res.headers.get('content-length')
    : null;
  const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) || 0 : 0;

  try {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.length;
        if (typeof onProgress === 'function') {
          onProgress({ loaded, total });
        }
      }
    }

    const combined = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new Response(combined, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (_) {
    return res;
  }
}

/**
 * Loads sysroot.tar.gz from network, decompresses it, and packs it into a SharedArrayBuffer.
 * @param {string} [basePath='/sysroot/wasm']
 * @param {(status: string, progress?: { loaded?: number, total?: number }) => void} [onProgress]
 * @param {object} [options]
 * @returns {Promise<SharedArrayBuffer|ArrayBuffer>}
 */
export async function loadOrBuildSharedSysroot(basePath = '/sysroot/wasm', onProgress = () => {}, options = {}) {
  const cleanBase = (basePath || '/sysroot/wasm').replace(/\/+$/, '');

  const fetchTar = async () => {
    try {
      const res = await fetchWithProgress(`${cleanBase}/sysroot.tar.gz`, {
        onProgress: (p) => {
          onProgress('Fetching standard library sysroot archive (sysroot.tar.gz)...', p);
        },
      });
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

  onProgress('Fetching standard library sysroot archive (sysroot.tar.gz)...');
  const tarBuf = await fetchTar();

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

  onProgress('Packing sysroot into shared memory buffer...');
  return createSharedSysrootFromTar(tarBuf, { ...options, additionalEntries });
}
