#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { Tar } from '../src/toolchain/tar.js';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot } from '../src/vfs/sysroot.js';
import { GRAPHICS_H, GRAPHICS_CANVAS_H } from 'canvas-wasi/headers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Polyfill fetch for Node.js environment to load local sysroot files while preserving native fetch for remote URLs
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, ...args) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    return nativeFetch(url, ...args);
  }
  let clean = String(url).replace(/^\/?sysroot\//, 'public/sysroot/').replace(/^\//, '');
  if (clean.startsWith('sysroot/')) clean = 'public/' + clean;
  const resolved = path.resolve(projectRoot, clean);
  const data = fs.readFileSync(resolved);
  return {
    ok: true,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    text: async () => data.toString('utf-8')
  };
};

const CLANG_WASI_TAG = 'v19.1.0';
const CLANG_WASI_BASE_URL = `https://github.com/breeze833/clang-wasi/releases/download/${CLANG_WASI_TAG}`;
const RAYLIB_WASI_BASE_URL = 'https://github.com/breeze833/raylib-wasi/releases/download/latest';
const LIBTURTLE_REPO_URL = 'https://github.com/breeze833/libturtle.git';
const SQLITE_WASI_TAG = 'v3.54.1';
const SQLITE_WASI_VERSION = '3.54.1';
const SQLITE_WASI_BASE_URL = `https://github.com/breeze833/sqlite-wasi/releases/download/${SQLITE_WASI_TAG}`;
const BUSYBOX_WASI_BASE_URL = 'https://github.com/breeze833/busybox-wasi/releases/download/latest';
const MAKE_WASI_BASE_URL = 'https://github.com/breeze833/make-wasi/releases/download/latest';

const WASM_DIR = path.join(projectRoot, 'public', 'sysroot', 'wasm');
const RAYLIB_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'raylib');
const TURTLE_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'turtle');
const SQLITE_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'sqlite');
const LIBTURTLE_BUILD_DIR = path.join(projectRoot, 'build', 'libturtle');

const REQUIRED_FILES = [
  path.join(WASM_DIR, 'llvm-box.wasm'),
  path.join(WASM_DIR, 'sysroot.tar.gz'),
  path.join(WASM_DIR, 'libraylib.a'),
  path.join(WASM_DIR, 'libturtle.a'),
  path.join(WASM_DIR, 'libturtle_canvas-wasi.a'),
  path.join(WASM_DIR, 'libturtle_raylib.a'),
  path.join(WASM_DIR, 'libsqlite3.a'),
  path.join(WASM_DIR, 'sqlite3.wasm'),
  path.join(WASM_DIR, 'busybox.wasm'),
  path.join(WASM_DIR, 'make.wasm'),
  path.join(RAYLIB_INC_DIR, 'raylib.h'),
  path.join(RAYLIB_INC_DIR, 'raymath.h'),
  path.join(RAYLIB_INC_DIR, 'rlgl.h'),
  path.join(RAYLIB_INC_DIR, 'raygui.h'),
  path.join(TURTLE_INC_DIR, 'turtle.h'),
  path.join(TURTLE_INC_DIR, 'turtle_backend_canvas_wasi.h'),
  path.join(TURTLE_INC_DIR, 'turtle_backend_raylib.h'),
  path.join(SQLITE_INC_DIR, 'sqlite3.h'),
  path.join(SQLITE_INC_DIR, 'sqlite3ext.h'),
  path.join(projectRoot, 'public', 'sysroot', 'include', 'graphics.h'),
  path.join(projectRoot, 'public', 'sysroot', 'include', 'graphics_canvas.h'),
];

const force = process.argv.includes('--force');

function allAssetsPresent() {
  for (const filePath of REQUIRED_FILES) {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return false;
  }
  return true;
}

async function downloadToFile(url, destPath) {
  console.log(`[sysroot] Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }

  const tmpPath = `${destPath}.tmp`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, destPath);
  const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2);
  console.log(`[sysroot] Saved ${path.relative(projectRoot, destPath)} (${sizeMb} MB)`);
}

async function downloadClangWasiAssets() {
  // Download toolchain binaries from clang-wasi releases
  const binaries = ['llvm-box.wasm', 'sysroot.tar.gz'];
  for (const name of binaries) {
    const dest = path.join(WASM_DIR, name);
    if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`[sysroot] ${name} already present, skipping.`);
      continue;
    }
    const url = `${CLANG_WASI_BASE_URL}/${name}`;
    await downloadToFile(url, dest);
  }
}

async function downloadRaylibAssets() {
  const raylibFiles = [
    path.join(WASM_DIR, 'libraylib.a'),
    path.join(RAYLIB_INC_DIR, 'raylib.h'),
    path.join(RAYLIB_INC_DIR, 'raymath.h'),
    path.join(RAYLIB_INC_DIR, 'rlgl.h'),
    path.join(RAYLIB_INC_DIR, 'raygui.h'),
  ];

  const needsDownload = force || raylibFiles.some((f) => !fs.existsSync(f) || fs.statSync(f).size === 0);
  if (!needsDownload) {
    console.log('[sysroot] Raylib assets already present, skipping.');
    return;
  }

  const localDist = process.env.RAYLIB_WASI_DIR
    ? path.join(process.env.RAYLIB_WASI_DIR, 'dist')
    : path.resolve(projectRoot, '../raylib-wasi/dist');
  const moduleDist = path.join(projectRoot, 'node_modules/raylib-wasi/dist');

  const sourceDist = (fs.existsSync(path.join(localDist, 'lib/libraylib.a')) && fs.existsSync(path.join(localDist, 'include')) && fs.existsSync(path.join(localDist, 'include/raygui.h')))
    ? localDist
    : (fs.existsSync(path.join(moduleDist, 'lib/libraylib.a')) && fs.existsSync(path.join(moduleDist, 'include')))
      ? moduleDist
      : null;

  if (sourceDist) {
    fs.mkdirSync(RAYLIB_INC_DIR, { recursive: true });
    fs.copyFileSync(path.join(sourceDist, 'lib/libraylib.a'), path.join(WASM_DIR, 'libraylib.a'));
    fs.copyFileSync(path.join(sourceDist, 'include/raylib.h'), path.join(RAYLIB_INC_DIR, 'raylib.h'));
    fs.copyFileSync(path.join(sourceDist, 'include/raymath.h'), path.join(RAYLIB_INC_DIR, 'raymath.h'));
    fs.copyFileSync(path.join(sourceDist, 'include/rlgl.h'), path.join(RAYLIB_INC_DIR, 'rlgl.h'));
    if (fs.existsSync(path.join(sourceDist, 'include/raygui.h'))) {
      fs.copyFileSync(path.join(sourceDist, 'include/raygui.h'), path.join(RAYLIB_INC_DIR, 'raygui.h'));
    }
    console.log(`[sysroot] Copied Raylib assets from ${path.relative(projectRoot, sourceDist)}.`);
  } else if (needsDownload) {
    const url = `${RAYLIB_WASI_BASE_URL}/raylib-wasi.tar.gz`;
    console.log(`[sysroot] Downloading ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const uncompressed = gunzipSync(Buffer.from(arrayBuf));
    const tar = new Tar(uncompressed.buffer.slice(uncompressed.byteOffset, uncompressed.byteOffset + uncompressed.byteLength));
    const entries = tar.getEntries();

    const fileMap = {
      'lib/libraylib.a': path.join(WASM_DIR, 'libraylib.a'),
      'package/dist/lib/libraylib.a': path.join(WASM_DIR, 'libraylib.a'),
      'include/raylib.h': path.join(RAYLIB_INC_DIR, 'raylib.h'),
      'package/dist/include/raylib.h': path.join(RAYLIB_INC_DIR, 'raylib.h'),
      'include/raymath.h': path.join(RAYLIB_INC_DIR, 'raymath.h'),
      'package/dist/include/raymath.h': path.join(RAYLIB_INC_DIR, 'raymath.h'),
      'include/rlgl.h': path.join(RAYLIB_INC_DIR, 'rlgl.h'),
      'package/dist/include/rlgl.h': path.join(RAYLIB_INC_DIR, 'rlgl.h'),
      'include/raygui.h': path.join(RAYLIB_INC_DIR, 'raygui.h'),
      'package/dist/include/raygui.h': path.join(RAYLIB_INC_DIR, 'raygui.h'),
    };

    for (const entry of entries) {
      if (fileMap[entry.filename] && entry.contents) {
        const dest = fileMap[entry.filename];
        const tmpPath = `${dest}.tmp`;
        fs.writeFileSync(tmpPath, entry.contents);
        fs.renameSync(tmpPath, dest);
        console.log(`[sysroot] Extracted ${path.relative(projectRoot, dest)} (${entry.contents.length} bytes)`);
      }
    }
  }
}

async function downloadTurtleAssets() {
  fs.mkdirSync(TURTLE_INC_DIR, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'build'), { recursive: true });

  // 1. Clone or update libturtle in build/libturtle
  if (!fs.existsSync(LIBTURTLE_BUILD_DIR)) {
    console.log('[sysroot] Cloning libturtle into build/libturtle...');
    execSync(`git clone --depth 1 ${LIBTURTLE_REPO_URL} "${LIBTURTLE_BUILD_DIR}"`, { stdio: 'inherit' });
  } else {
    console.log('[sysroot] Updating libturtle in build/libturtle...');
    try {
      execSync(`git -C "${LIBTURTLE_BUILD_DIR}" pull --rebase`, { stdio: 'inherit' });
    } catch (err) {
      console.warn('[sysroot] git pull failed, using existing clone:', err.message);
    }
  }

  // 2. Copy user-facing headers to sysroot
  const headerMap = {
    'turtle.h': path.join(LIBTURTLE_BUILD_DIR, 'include', 'turtle.h'),
    'turtle_backend_canvas_wasi.h': path.join(LIBTURTLE_BUILD_DIR, 'backend', 'canvas-wasi', 'include', 'turtle_backend_canvas_wasi.h'),
    'turtle_backend_raylib.h': path.join(LIBTURTLE_BUILD_DIR, 'backend', 'raylib', 'include', 'turtle_backend_raylib.h'),
  };

  const headerContents = {};
  for (const [name, srcPath] of Object.entries(headerMap)) {
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Expected header ${srcPath} does not exist in libturtle clone`);
    }
    const content = fs.readFileSync(srcPath, 'utf-8');
    headerContents[name] = content;
    fs.writeFileSync(path.join(TURTLE_INC_DIR, name), content);
    console.log(`[sysroot] Copied ${name} to sysroot.`);
  }

  // Ensure turtle_hal.h is never published in the distributed sysroot
  const unpublishedHalPath = path.join(TURTLE_INC_DIR, 'turtle_hal.h');
  if (fs.existsSync(unpublishedHalPath)) {
    fs.rmSync(unpublishedHalPath, { force: true });
  }

  // 3. Build libraries using in-tree WebAssembly toolchain (llvm-box.wasm & ar.js)
  const libTurtlePath = path.join(WASM_DIR, 'libturtle.a');
  const libCanvasWasiPath = path.join(WASM_DIR, 'libturtle_canvas-wasi.a');
  const libRaylibTurtlePath = path.join(WASM_DIR, 'libturtle_raylib.a');

  console.log('[sysroot] Compiling libturtle static archives using WebAssembly toolchain (llvm-box.wasm)...');

  const vfs = new VFS();
  mountSysroot(vfs);

  const { WasmToolchain } = await import('../src/toolchain/wasm-clang.js');
  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  // Mount source files and headers into VFS
  vfs.writeFile('/workspace/include/turtle.h', fs.readFileSync(path.join(LIBTURTLE_BUILD_DIR, 'include', 'turtle.h')), Date.now(), true);
  vfs.writeFile('/workspace/include/turtle_hal.h', fs.readFileSync(path.join(LIBTURTLE_BUILD_DIR, 'include', 'turtle_hal.h')), Date.now(), true);
  vfs.writeFile('/workspace/src/turtle.c', fs.readFileSync(path.join(LIBTURTLE_BUILD_DIR, 'src', 'turtle.c')), Date.now(), true);

  // Compile core turtle.c
  let code = await tc.compile('/workspace/src/turtle.c', '/workspace/build/turtle.o', 'c', ['-I/workspace/include']);
  if (code !== 0) throw new Error(`Failed to compile turtle.c: exit code ${code}`);

  // Compile Canvas-wasi HAL
  vfs.writeFile('/workspace/include/turtle_backend_canvas_wasi.h', fs.readFileSync(path.join(LIBTURTLE_BUILD_DIR, 'backend', 'canvas-wasi', 'include', 'turtle_backend_canvas_wasi.h')), Date.now(), true);
  vfs.writeFile('/workspace/include/graphics_canvas.h', Buffer.from(GRAPHICS_CANVAS_H), Date.now(), true);
  vfs.writeFile('/workspace/include/graphics.h', Buffer.from(GRAPHICS_H), Date.now(), true);
  vfs.writeFile('/workspace/src/hal_canvas_wasi.c', fs.readFileSync(path.join(LIBTURTLE_BUILD_DIR, 'backend', 'canvas-wasi', 'hal_canvas_wasi.c')), Date.now(), true);

  code = await tc.compile('/workspace/src/hal_canvas_wasi.c', '/workspace/build/hal_canvas.o', 'c', ['-I/workspace/include', '-D_POSIX_C_SOURCE=200809L']);
  if (code !== 0) throw new Error(`Failed to compile hal_canvas_wasi.c: exit code ${code}`);

  // Compile Raylib HAL
  vfs.writeFile('/workspace/include/turtle_backend_raylib.h', fs.readFileSync(path.join(LIBTURTLE_BUILD_DIR, 'backend', 'raylib', 'include', 'turtle_backend_raylib.h')), Date.now(), true);
  vfs.writeFile('/workspace/src/hal_raylib.c', fs.readFileSync(path.join(LIBTURTLE_BUILD_DIR, 'backend', 'raylib', 'hal_raylib.c')), Date.now(), true);
  vfs.writeFile('/workspace/include/raylib.h', fs.readFileSync(path.join(RAYLIB_INC_DIR, 'raylib.h')), Date.now(), true);

  code = await tc.compile('/workspace/src/hal_raylib.c', '/workspace/build/hal_raylib.o', 'c', ['-I/workspace/include']);
  if (code !== 0) throw new Error(`Failed to compile hal_raylib.c: exit code ${code}`);

  // Build static archives using llvm-box ar
  code = await tc.runTool('ar', ['rcs', '/workspace/build/libturtle.a', '/workspace/build/turtle.o', '/workspace/build/hal_canvas.o']);
  if (code !== 0) throw new Error(`Failed to create libturtle.a: exit code ${code}`);
  const canvasArchive = vfs.readFile('/workspace/build/libturtle.a', false);
  fs.writeFileSync(libCanvasWasiPath, canvasArchive);
  fs.writeFileSync(libTurtlePath, canvasArchive);

  code = await tc.runTool('ar', ['rcs', '/workspace/build/libturtle_raylib.a', '/workspace/build/turtle.o', '/workspace/build/hal_raylib.o']);
  if (code !== 0) throw new Error(`Failed to create libturtle_raylib.a: exit code ${code}`);
  const raylibArchive = vfs.readFile('/workspace/build/libturtle_raylib.a', false);
  fs.writeFileSync(libRaylibTurtlePath, raylibArchive);

  console.log('[sysroot] Installed libturtle.a & libturtle_canvas-wasi.a');
  console.log('[sysroot] Installed libturtle_raylib.a');
}

async function downloadSqliteAssets() {
  const sqliteFiles = [
    path.join(WASM_DIR, 'libsqlite3.a'),
    path.join(WASM_DIR, 'sqlite3.wasm'),
    path.join(SQLITE_INC_DIR, 'sqlite3.h'),
    path.join(SQLITE_INC_DIR, 'sqlite3ext.h'),
  ];

  const needsDownload = force || sqliteFiles.some((f) => !fs.existsSync(f) || fs.statSync(f).size === 0);
  if (!needsDownload) {
    console.log('[sysroot] SQLite assets already present, skipping.');
    return;
  }

  fs.mkdirSync(SQLITE_INC_DIR, { recursive: true });

  const moduleDistLib = path.join(projectRoot, 'node_modules/sqlite-wasi/lib/libsqlite3.a');
  const moduleDistBin = path.join(projectRoot, 'node_modules/sqlite-wasi/bin/sqlite3.wasm');
  const moduleDistInc = path.join(projectRoot, 'node_modules/sqlite-wasi/include');

  if (fs.existsSync(moduleDistLib) && fs.existsSync(moduleDistBin) && fs.existsSync(moduleDistInc)) {
    fs.copyFileSync(moduleDistLib, path.join(WASM_DIR, 'libsqlite3.a'));
    fs.copyFileSync(moduleDistBin, path.join(WASM_DIR, 'sqlite3.wasm'));
    fs.copyFileSync(path.join(moduleDistInc, 'sqlite3.h'), path.join(SQLITE_INC_DIR, 'sqlite3.h'));
    fs.copyFileSync(path.join(moduleDistInc, 'sqlite3ext.h'), path.join(SQLITE_INC_DIR, 'sqlite3ext.h'));
    console.log('[sysroot] Copied SQLite assets from node_modules/sqlite-wasi.');
  } else if (needsDownload) {
    const url = `${SQLITE_WASI_BASE_URL}/sqlite-wasi-${SQLITE_WASI_VERSION}.tgz`;
    console.log(`[sysroot] Downloading ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const uncompressed = gunzipSync(Buffer.from(arrayBuf));
    const tar = new Tar(uncompressed.buffer.slice(uncompressed.byteOffset, uncompressed.byteOffset + uncompressed.byteLength));
    const entries = tar.getEntries();

    const fileMap = {
      'package/lib/libsqlite3.a': path.join(WASM_DIR, 'libsqlite3.a'),
      'package/bin/sqlite3.wasm': path.join(WASM_DIR, 'sqlite3.wasm'),
      'package/include/sqlite3.h': path.join(SQLITE_INC_DIR, 'sqlite3.h'),
      'package/include/sqlite3ext.h': path.join(SQLITE_INC_DIR, 'sqlite3ext.h'),
      'lib/libsqlite3.a': path.join(WASM_DIR, 'libsqlite3.a'),
      'bin/sqlite3.wasm': path.join(WASM_DIR, 'sqlite3.wasm'),
      'include/sqlite3.h': path.join(SQLITE_INC_DIR, 'sqlite3.h'),
      'include/sqlite3ext.h': path.join(SQLITE_INC_DIR, 'sqlite3ext.h'),
    };

    for (const entry of entries) {
      if (fileMap[entry.filename] && entry.contents) {
        const dest = fileMap[entry.filename];
        const tmpPath = `${dest}.tmp`;
        fs.writeFileSync(tmpPath, entry.contents);
        fs.renameSync(tmpPath, dest);
        console.log(`[sysroot] Extracted ${path.relative(projectRoot, dest)} (${entry.contents.length} bytes)`);
      }
    }
  }
}

async function downloadBusyboxAssets() {
  const destPath = path.join(WASM_DIR, 'busybox.wasm');
  if (!force && fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    console.log('[sysroot] busybox.wasm already present, skipping.');
    return;
  }

  const url = `${BUSYBOX_WASI_BASE_URL}/busybox.wasm`;
  await downloadToFile(url, destPath);
}

async function downloadMakeAssets() {
  const destPath = path.join(WASM_DIR, 'make.wasm');
  if (!force && fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    console.log('[sysroot] make.wasm already present, skipping.');
    return;
  }

  const url = `${MAKE_WASI_BASE_URL}/make.wasm`;
  await downloadToFile(url, destPath);
}

function createTarHeader(name, size, mode = 0o644) {
  const buf = new Uint8Array(512);
  const writeStr = (str, offset, maxLen) => {
    for (let i = 0; i < Math.min(str.length, maxLen); i++) {
      buf[offset + i] = str.charCodeAt(i);
    }
  };
  const writeOctal = (num, offset, len) => {
    const s = num.toString(8).padStart(len - 1, '0') + '\0';
    writeStr(s, offset, len);
  };

  writeStr(name, 0, 100);
  writeOctal(mode, 100, 8);
  writeOctal(0, 108, 8);
  writeOctal(0, 116, 8);
  writeOctal(size, 124, 12);
  writeOctal(Math.floor(Date.now() / 1000), 136, 12);
  for (let i = 148; i < 156; i++) buf[i] = 32;
  buf[156] = 48; // '0'
  writeStr('ustar', 257, 5);
  buf[262] = 0;
  writeStr('00', 263, 2);

  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i];
  const csStr = checksum.toString(8).padStart(6, '0') + '\0 ';
  writeStr(csStr, 148, 8);
  return buf;
}

async function syncCustomHeaders() {
  const incDir = path.join(projectRoot, 'public', 'sysroot', 'include');
  fs.mkdirSync(incDir, { recursive: true });

  // 1. Write graphics headers
  fs.writeFileSync(path.join(incDir, 'graphics.h'), GRAPHICS_H);
  fs.writeFileSync(path.join(incDir, 'graphics_canvas.h'), GRAPHICS_CANVAS_H);

  // 2. Ensure flat copies in public/sysroot/include/
  const flatMappings = [
    [path.join(RAYLIB_INC_DIR, 'raylib.h'), path.join(incDir, 'raylib.h')],
    [path.join(RAYLIB_INC_DIR, 'raymath.h'), path.join(incDir, 'raymath.h')],
    [path.join(RAYLIB_INC_DIR, 'rlgl.h'), path.join(incDir, 'rlgl.h')],
    [path.join(RAYLIB_INC_DIR, 'raygui.h'), path.join(incDir, 'raygui.h')],
    [path.join(TURTLE_INC_DIR, 'turtle.h'), path.join(incDir, 'turtle.h')],
    [path.join(TURTLE_INC_DIR, 'turtle_backend_canvas_wasi.h'), path.join(incDir, 'turtle_backend_canvas_wasi.h')],
    [path.join(TURTLE_INC_DIR, 'turtle_backend_raylib.h'), path.join(incDir, 'turtle_backend_raylib.h')],
    [path.join(SQLITE_INC_DIR, 'sqlite3.h'), path.join(incDir, 'sqlite3.h')],
    [path.join(SQLITE_INC_DIR, 'sqlite3ext.h'), path.join(incDir, 'sqlite3ext.h')],
  ];

  for (const [src, dest] of flatMappings) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // 3. Append headers to sysroot.tar.gz if not already present
  const sysrootTarGzPath = path.join(WASM_DIR, 'sysroot.tar.gz');
  if (!fs.existsSync(sysrootTarGzPath)) return;

  const rawGz = fs.readFileSync(sysrootTarGzPath);
  const tarBuf = gunzipSync(rawGz);
  const tar = new Tar(tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength));
  let dataEnd = 0;
  let hasRaylib = false;
  let entry;
  while ((entry = tar.readEntry())) {
    dataEnd = tar.offset;
    if (entry.filename === 'include/raylib.h' || entry.filename === './include/raylib.h') {
      hasRaylib = true;
    }
  }

  if (hasRaylib && !force) {
    console.log('[sysroot] Custom headers already packed in sysroot.tar.gz.');
    return;
  }

  console.log('[sysroot] Packing custom headers into sysroot.tar.gz...');
  const headersToPack = [
    { name: 'include/raylib.h', content: fs.readFileSync(path.join(incDir, 'raylib.h')) },
    { name: 'include/raymath.h', content: fs.readFileSync(path.join(incDir, 'raymath.h')) },
    { name: 'include/rlgl.h', content: fs.readFileSync(path.join(incDir, 'rlgl.h')) },
    { name: 'include/raygui.h', content: fs.readFileSync(path.join(incDir, 'raygui.h')) },
    { name: 'include/turtle.h', content: fs.readFileSync(path.join(incDir, 'turtle.h')) },
    { name: 'include/turtle_backend_canvas_wasi.h', content: fs.readFileSync(path.join(incDir, 'turtle_backend_canvas_wasi.h')) },
    { name: 'include/turtle_backend_raylib.h', content: fs.readFileSync(path.join(incDir, 'turtle_backend_raylib.h')) },
    { name: 'include/sqlite3.h', content: fs.readFileSync(path.join(incDir, 'sqlite3.h')) },
    { name: 'include/sqlite3ext.h', content: fs.readFileSync(path.join(incDir, 'sqlite3ext.h')) },
    { name: 'include/graphics.h', content: Buffer.from(GRAPHICS_H) },
    { name: 'include/graphics_canvas.h', content: Buffer.from(GRAPHICS_CANVAS_H) },
    { name: 'include/wasm32-wasip1/raylib.h', content: fs.readFileSync(path.join(incDir, 'raylib.h')) },
    { name: 'include/wasm32-wasip1/raymath.h', content: fs.readFileSync(path.join(incDir, 'raymath.h')) },
    { name: 'include/wasm32-wasip1/rlgl.h', content: fs.readFileSync(path.join(incDir, 'rlgl.h')) },
    { name: 'include/wasm32-wasip1/raygui.h', content: fs.readFileSync(path.join(incDir, 'raygui.h')) },
    { name: 'include/wasm32-wasip1/turtle.h', content: fs.readFileSync(path.join(incDir, 'turtle.h')) },
    { name: 'include/wasm32-wasip1/turtle_backend_canvas_wasi.h', content: fs.readFileSync(path.join(incDir, 'turtle_backend_canvas_wasi.h')) },
    { name: 'include/wasm32-wasip1/turtle_backend_raylib.h', content: fs.readFileSync(path.join(incDir, 'turtle_backend_raylib.h')) },
    { name: 'include/wasm32-wasip1/sqlite3.h', content: fs.readFileSync(path.join(incDir, 'sqlite3.h')) },
    { name: 'include/wasm32-wasip1/sqlite3ext.h', content: fs.readFileSync(path.join(incDir, 'sqlite3ext.h')) },
    { name: 'include/wasm32-wasip1/graphics.h', content: Buffer.from(GRAPHICS_H) },
    { name: 'include/wasm32-wasip1/graphics_canvas.h', content: Buffer.from(GRAPHICS_CANVAS_H) },
  ];

  const parts = [tarBuf.subarray(0, dataEnd)];
  for (const h of headersToPack) {
    const hdr = createTarHeader(h.name, h.content.length);
    const padLen = (512 - (h.content.length % 512)) % 512;
    parts.push(hdr);
    parts.push(h.content);
    if (padLen > 0) parts.push(new Uint8Array(padLen));
  }
  parts.push(new Uint8Array(1024));

  const newTar = Buffer.concat(parts);
  const reGz = gzipSync(newTar, { level: 6 });
  fs.writeFileSync(sysrootTarGzPath, reGz);
  console.log(`[sysroot] Packed ${headersToPack.length} headers into sysroot.tar.gz (${reGz.length} bytes).`);
}

async function main() {
  const incDir = path.join(projectRoot, 'public', 'sysroot', 'include');
  fs.mkdirSync(incDir, { recursive: true });
  fs.mkdirSync(WASM_DIR, { recursive: true });
  fs.mkdirSync(RAYLIB_INC_DIR, { recursive: true });
  fs.mkdirSync(TURTLE_INC_DIR, { recursive: true });
  fs.mkdirSync(SQLITE_INC_DIR, { recursive: true });

  // Ensure baseline graphics headers are present on disk early
  fs.writeFileSync(path.join(incDir, 'graphics.h'), GRAPHICS_H);
  fs.writeFileSync(path.join(incDir, 'graphics_canvas.h'), GRAPHICS_CANVAS_H);

  if (!force && allAssetsPresent()) {
    console.log('[sysroot] All toolchain & sysroot assets are present.');
    await syncCustomHeaders();
    return;
  }

  console.log('[sysroot] Ensuring toolchain and sysroot assets...');
  await downloadClangWasiAssets();
  await downloadRaylibAssets();
  await downloadTurtleAssets();
  await downloadSqliteAssets();
  await downloadBusyboxAssets();
  await downloadMakeAssets();
  await syncCustomHeaders();
  console.log('[sysroot] All assets successfully downloaded and ready.');
}

main().catch((err) => {
  console.error('[sysroot] Error downloading sysroot assets:', err);
  process.exit(1);
});
