#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { Tar } from '../src/toolchain/tar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const CLANG_WASI_TAG = 'v19.1.0';
const CLANG_WASI_BASE_URL = `https://github.com/breeze833/clang-wasi/releases/download/${CLANG_WASI_TAG}`;
const RAYLIB_WASI_BASE_URL = 'https://github.com/breeze833/raylib-wasi/releases/download/latest';
const LIBTURTLE_REPO_URL = 'https://github.com/breeze833/libturtle.git';

const WASM_DIR = path.join(projectRoot, 'public', 'sysroot', 'wasm');
const RAYLIB_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'raylib');
const TURTLE_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'turtle');
const LIBTURTLE_BUILD_DIR = path.join(projectRoot, 'build', 'libturtle');
const TURTLE_HEADERS_JS = path.join(projectRoot, 'src', 'vfs', 'turtle-headers.js');

const REQUIRED_FILES = [
  path.join(WASM_DIR, 'llvm-box.wasm'),
  path.join(WASM_DIR, 'sysroot.tar.gz'),
  path.join(WASM_DIR, 'libraylib.a'),
  path.join(WASM_DIR, 'libturtle.a'),
  path.join(WASM_DIR, 'libturtle_canvas-wasi.a'),
  path.join(WASM_DIR, 'libturtle_raylib.a'),
  path.join(RAYLIB_INC_DIR, 'raylib.h'),
  path.join(RAYLIB_INC_DIR, 'raymath.h'),
  path.join(RAYLIB_INC_DIR, 'rlgl.h'),
  path.join(TURTLE_INC_DIR, 'turtle.h'),
  path.join(TURTLE_INC_DIR, 'turtle_backend_canvas_wasi.h'),
  path.join(TURTLE_INC_DIR, 'turtle_backend_raylib.h'),
  TURTLE_HEADERS_JS,
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
  ];

  const needsDownload = force || raylibFiles.some((f) => !fs.existsSync(f) || fs.statSync(f).size === 0);
  if (!needsDownload) {
    console.log('[sysroot] Raylib assets already present, skipping.');
    return;
  }

  const moduleDistLib = path.join(projectRoot, 'node_modules/raylib-wasi/dist/lib/libraylib.a');
  const moduleDistInc = path.join(projectRoot, 'node_modules/raylib-wasi/dist/include');
  if (fs.existsSync(moduleDistLib) && fs.existsSync(moduleDistInc)) {
    fs.mkdirSync(RAYLIB_INC_DIR, { recursive: true });
    fs.copyFileSync(moduleDistLib, path.join(WASM_DIR, 'libraylib.a'));
    fs.copyFileSync(path.join(moduleDistInc, 'raylib.h'), path.join(RAYLIB_INC_DIR, 'raylib.h'));
    fs.copyFileSync(path.join(moduleDistInc, 'raymath.h'), path.join(RAYLIB_INC_DIR, 'raymath.h'));
    fs.copyFileSync(path.join(moduleDistInc, 'rlgl.h'), path.join(RAYLIB_INC_DIR, 'rlgl.h'));
    console.log('[sysroot] Copied Raylib assets from node_modules/raylib-wasi/dist.');
    return;
  }

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
    'include/raylib.h': path.join(RAYLIB_INC_DIR, 'raylib.h'),
    'include/raymath.h': path.join(RAYLIB_INC_DIR, 'raymath.h'),
    'include/rlgl.h': path.join(RAYLIB_INC_DIR, 'rlgl.h'),
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

  // 3. Auto-generate src/vfs/turtle-headers.js
  const generatedJs = `// Auto-generated by scripts/download-sysroot.js - DO NOT EDIT MANUALLY\nexport const TURTLE_HEADERS = {\n  'turtle.h': ${JSON.stringify(headerContents['turtle.h'])},\n  'turtle_backend_canvas_wasi.h': ${JSON.stringify(headerContents['turtle_backend_canvas_wasi.h'])},\n  'turtle_backend_raylib.h': ${JSON.stringify(headerContents['turtle_backend_raylib.h'])},\n};\n`;
  fs.writeFileSync(TURTLE_HEADERS_JS, generatedJs);
  console.log('[sysroot] Generated src/vfs/turtle-headers.js');

  // 4. Build libraries using make utility
  const libTurtlePath = path.join(WASM_DIR, 'libturtle.a');
  const libCanvasWasiPath = path.join(WASM_DIR, 'libturtle_canvas-wasi.a');
  const libRaylibTurtlePath = path.join(WASM_DIR, 'libturtle_raylib.a');

  console.log('[sysroot] Building libturtle static archives for WebAssembly via make...');

  // Build canvas-wasi backend
  execSync(`make -C "${LIBTURTLE_BUILD_DIR}" clean BACKEND=canvas-wasi 2>/dev/null || true`);
  execSync(`make -C "${LIBTURTLE_BUILD_DIR}" BACKEND=canvas-wasi`, { stdio: 'inherit' });
  const builtCanvasLib = path.join(LIBTURTLE_BUILD_DIR, 'build', 'canvas-wasi', 'libturtle_canvas-wasi.a');
  fs.copyFileSync(builtCanvasLib, libCanvasWasiPath);
  fs.copyFileSync(builtCanvasLib, libTurtlePath);

  // Build raylib backend for WebAssembly
  execSync(`make -C "${LIBTURTLE_BUILD_DIR}" clean BACKEND=raylib 2>/dev/null || true`);
  execSync(
    `make -C "${LIBTURTLE_BUILD_DIR}" BACKEND=raylib ` +
    `CC=clang AR=llvm-ar CFLAGS="-O2 --target=wasm32-wasi" ` +
    `INCLUDES="-Iinclude -Ibackend/raylib/include -I${RAYLIB_INC_DIR}"`,
    { stdio: 'inherit' }
  );
  const builtRaylibLib = path.join(LIBTURTLE_BUILD_DIR, 'build', 'raylib', 'libturtle_raylib.a');
  fs.copyFileSync(builtRaylibLib, libRaylibTurtlePath);

  console.log('[sysroot] Installed libturtle.a & libturtle_canvas-wasi.a');
  console.log('[sysroot] Installed libturtle_raylib.a');
}

async function main() {
  if (!force && allAssetsPresent()) {
    console.log('[sysroot] All toolchain & sysroot assets are present. Skipping download.');
    return;
  }

  fs.mkdirSync(WASM_DIR, { recursive: true });
  fs.mkdirSync(RAYLIB_INC_DIR, { recursive: true });
  fs.mkdirSync(TURTLE_INC_DIR, { recursive: true });

  console.log('[sysroot] Ensuring toolchain and sysroot assets...');
  await downloadClangWasiAssets();
  await downloadRaylibAssets();
  await downloadTurtleAssets();
  console.log('[sysroot] All assets successfully downloaded and ready.');
}

main().catch((err) => {
  console.error('[sysroot] Error downloading sysroot assets:', err);
  process.exit(1);
});
