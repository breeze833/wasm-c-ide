#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import { Tar } from '../src/toolchain/tar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const CLANG_WASI_TAG = 'v19.1.0';
const CLANG_WASI_BASE_URL = `https://github.com/breeze833/clang-wasi/releases/download/${CLANG_WASI_TAG}`;
const RAYLIB_WASI_BASE_URL = 'https://github.com/breeze833/raylib-wasi/releases/download/latest';

const WASM_DIR = path.join(projectRoot, 'public', 'sysroot', 'wasm');
const RAYLIB_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'raylib');

const REQUIRED_FILES = [
  path.join(WASM_DIR, 'clang.wasm'),
  path.join(WASM_DIR, 'lld.wasm'),
  path.join(WASM_DIR, 'memfs.wasm'),
  path.join(WASM_DIR, 'sysroot.tar.gz'),
  path.join(WASM_DIR, 'libraylib.a'),
  path.join(RAYLIB_INC_DIR, 'raylib.h'),
  path.join(RAYLIB_INC_DIR, 'raymath.h'),
  path.join(RAYLIB_INC_DIR, 'rlgl.h'),
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
  const binaries = ['clang.wasm', 'lld.wasm', 'memfs.wasm', 'sysroot.tar.gz'];
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

async function main() {
  if (!force && allAssetsPresent()) {
    console.log('[sysroot] All toolchain & sysroot assets are present. Skipping download.');
    return;
  }

  fs.mkdirSync(WASM_DIR, { recursive: true });
  fs.mkdirSync(RAYLIB_INC_DIR, { recursive: true });

  console.log('[sysroot] Ensuring toolchain and sysroot assets...');
  await downloadClangWasiAssets();
  await downloadRaylibAssets();
  console.log('[sysroot] All assets successfully downloaded and ready.');
}

main().catch((err) => {
  console.error('[sysroot] Error downloading sysroot assets:', err);
  process.exit(1);
});
