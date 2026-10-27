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
const LIBTURTLE_RAW_BASE = 'https://raw.githubusercontent.com/breeze833/libturtle/main';

const WASM_DIR = path.join(projectRoot, 'public', 'sysroot', 'wasm');
const RAYLIB_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'raylib');
const TURTLE_INC_DIR = path.join(projectRoot, 'public', 'sysroot', 'include', 'turtle');

const REQUIRED_FILES = [
  path.join(WASM_DIR, 'clang.wasm'),
  path.join(WASM_DIR, 'lld.wasm'),
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
  const binaries = ['clang.wasm', 'lld.wasm', 'sysroot.tar.gz'];
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

  const { TURTLE_HEADERS } = await import('../src/vfs/sysroot.js');
  const headerMap = {
    'turtle.h': path.join(TURTLE_INC_DIR, 'turtle.h'),
    'turtle_backend_canvas_wasi.h': path.join(TURTLE_INC_DIR, 'turtle_backend_canvas_wasi.h'),
    'turtle_backend_raylib.h': path.join(TURTLE_INC_DIR, 'turtle_backend_raylib.h'),
  };

  // Write sysroot headers
  for (const [name, targetPath] of Object.entries(headerMap)) {
    if (force || !fs.existsSync(targetPath) || fs.statSync(targetPath).size === 0) {
      try {
        const url = `${LIBTURTLE_RAW_BASE}/include/${name}`;
        const altUrl = name.includes('canvas_wasi')
          ? `${LIBTURTLE_RAW_BASE}/backend/canvas-wasi/include/${name}`
          : (name.includes('raylib') ? `${LIBTURTLE_RAW_BASE}/backend/raylib/include/${name}` : url);
        const res = await fetch(altUrl);
        if (res.ok) {
          const txt = await res.text();
          fs.writeFileSync(targetPath, txt);
          console.log(`[sysroot] Downloaded ${name} from libturtle repo.`);
          continue;
        }
      } catch {}
      // Fallback to embedded header
      if (TURTLE_HEADERS[name]) {
        fs.writeFileSync(targetPath, TURTLE_HEADERS[name]);
        console.log(`[sysroot] Wrote embedded header for ${name}.`);
      }
    }
  }

  const libTurtlePath = path.join(WASM_DIR, 'libturtle.a');
  const libCanvasWasiPath = path.join(WASM_DIR, 'libturtle_canvas-wasi.a');
  const libRaylibTurtlePath = path.join(WASM_DIR, 'libturtle_raylib.a');

  // Ensure turtle_hal.h is never published in the distributed sysroot
  const unpublishedHalPath = path.join(TURTLE_INC_DIR, 'turtle_hal.h');
  if (fs.existsSync(unpublishedHalPath)) {
    fs.rmSync(unpublishedHalPath, { force: true });
  }

  const needsLibBuild = force ||
    !fs.existsSync(libTurtlePath) || fs.statSync(libTurtlePath).size === 0 ||
    !fs.existsSync(libCanvasWasiPath) || fs.statSync(libCanvasWasiPath).size === 0 ||
    !fs.existsSync(libRaylibTurtlePath) || fs.statSync(libRaylibTurtlePath).size === 0;

  if (!needsLibBuild) {
    console.log('[sysroot] Turtle library archives already present, skipping build.');
    return;
  }

  console.log('[sysroot] Building libturtle static archives for WebAssembly...');

  const TURTLE_HAL_H = `/* Hardware Abstraction Layer for Turtle Graphics */
#ifndef TURTLE_HAL_H
#define TURTLE_HAL_H

#include <stdint.h>
#include <stdbool.h>

/**
 * Low-level Hardware Abstraction Layer for Turtle Graphics.
 * Implemented independently by libturtle_raylib and libturtle_canvas-wasi.
 * Coordinates passed to HAL are in physical screen space (origin at top-left).
 */

/* Initialize the graphics context/window.
 * Must set *width and *height so turtle.c can calculate math center (0,0). */
bool hal_turtle_init(void *context, double *out_width, double *out_height);

/* Finalize, flush buffer, or present frame */
void hal_turtle_present(void);

/* Flush canvas and pause execution for specified milliseconds */
void hal_turtle_delay(double ms);

/* Update turtle cursor position (screen coordinates), orientation, and visibility */
void hal_turtle_set_cursor(double screen_x, double screen_y, double heading_deg, bool visible);

/* Release resources / close window */
void hal_turtle_destroy(void);

/* Clear viewport with background color (RGBA8888) */
void hal_turtle_clear(uint32_t bg_color);

/* Draw a line segment between two screen points */
void hal_turtle_draw_line(double x1, double y1, 
                          double x2, double y2, 
                          double stroke_width, 
                          uint32_t color);

#endif /* TURTLE_HAL_H */
`;

  // Helper to fetch source with fallback
  const fetchSource = async (relPath, fallbackContent = null) => {
    try {
      const res = await fetch(`${LIBTURTLE_RAW_BASE}/${relPath}`);
      if (res.ok) return await res.text();
    } catch {}
    if (fallbackContent !== null) {
      return fallbackContent;
    }
    throw new Error(`Unable to fetch ${relPath}`);
  };

  const [turtleSrc, halCanvasSrc, halRaylibSrc, turtleHalSrc] = await Promise.all([
    fetchSource('src/turtle.c'),
    fetchSource('backend/canvas-wasi/hal_canvas_wasi.c'),
    fetchSource('backend/raylib/hal_raylib.c'),
    fetchSource('include/turtle_hal.h', TURTLE_HAL_H),
  ]);

  const { WasmToolchain } = await import('../src/toolchain/wasm-clang.js');
  const { buildArchive } = await import('../src/toolchain/ar.js');
  const { VFS } = await import('../src/vfs/vfs.js');
  const { mountSysroot } = await import('../src/vfs/sysroot.js');

  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const relPath = url.replace(/^\/?sysroot\//, 'public/sysroot/');
    const resolved = path.join(projectRoot, relPath);
    if (fs.existsSync(resolved)) {
      const data = fs.readFileSync(resolved);
      return {
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      };
    }
    return oldFetch(url);
  };

  try {
    const vfs = new VFS();
    mountSysroot(vfs);
    const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
    await tc.init();

    // Mount raylib headers & library for compilation
    if (fs.existsSync(path.join(RAYLIB_INC_DIR, 'raylib.h'))) {
      tc.memfs.addFile('include/raylib.h', fs.readFileSync(path.join(RAYLIB_INC_DIR, 'raylib.h')));
      tc.memfs.addFile('include/raymath.h', fs.readFileSync(path.join(RAYLIB_INC_DIR, 'raymath.h')));
      tc.memfs.addFile('include/rlgl.h', fs.readFileSync(path.join(RAYLIB_INC_DIR, 'rlgl.h')));
    }

    // Add turtle headers to toolchain MemFS
    for (const [name, targetPath] of Object.entries(headerMap)) {
      if (fs.existsSync(targetPath)) {
        tc.memfs.addFile(`include/${name}`, fs.readFileSync(targetPath, 'utf-8'));
      }
    }

    // Add internal HAL header to MemFS for compiling the library (not published to sysroot)
    tc.memfs.addFile('include/turtle_hal.h', turtleHalSrc);
    tc.memfs.addFile('libturtle/src/turtle_hal.h', turtleHalSrc);

    tc.memfs.addFile('libturtle/src/turtle.c', turtleSrc);
    tc.memfs.addFile('libturtle/backend/canvas-wasi/hal_canvas_wasi.c', halCanvasSrc);
    tc.memfs.addFile('libturtle/backend/raylib/hal_raylib.c', halRaylibSrc);

    // Compile core turtle.c
    let code = await tc.compile(
      'libturtle/src/turtle.c',
      'libturtle/turtle.o',
      'c',
      ['-I/include', '-I/libturtle/src', '-O2']
    );
    if (code !== 0) throw new Error('Compilation of turtle.c failed');
    const turtleObj = tc.getFileFromMemfs('libturtle/turtle.o');

    // Compile canvas-wasi hal_canvas_wasi.c
    code = await tc.compile(
      'libturtle/backend/canvas-wasi/hal_canvas_wasi.c',
      'libturtle/hal_canvas_wasi.o',
      'c',
      ['-I/include', '-I/libturtle/backend/canvas-wasi/include', '-O2', '-std=gnu11']
    );
    if (code !== 0) throw new Error('Compilation of hal_canvas_wasi.c failed');
    const canvasHalObj = tc.getFileFromMemfs('libturtle/hal_canvas_wasi.o');

    // Compile raylib hal_raylib.c
    code = await tc.compile(
      'libturtle/backend/raylib/hal_raylib.c',
      'libturtle/hal_raylib.o',
      'c',
      ['-I/include', '-I/libturtle/backend/raylib/include', '-O2']
    );
    if (code !== 0) throw new Error('Compilation of hal_raylib.c failed');
    const raylibHalObj = tc.getFileFromMemfs('libturtle/hal_raylib.o');

    // Build static archives
    const canvasArchive = buildArchive([
      { name: 'turtle.o', data: turtleObj },
      { name: 'hal_canvas_wasi.o', data: canvasHalObj },
    ]);
    const raylibArchive = buildArchive([
      { name: 'turtle.o', data: turtleObj },
      { name: 'hal_raylib.o', data: raylibHalObj },
    ]);

    fs.writeFileSync(libCanvasWasiPath, canvasArchive);
    fs.writeFileSync(libTurtlePath, canvasArchive);
    fs.writeFileSync(libRaylibTurtlePath, raylibArchive);

    console.log(`[sysroot] Built libturtle.a & libturtle_canvas-wasi.a (${canvasArchive.length} bytes)`);
    console.log(`[sysroot] Built libturtle_raylib.a (${raylibArchive.length} bytes)`);
  } finally {
    globalThis.fetch = oldFetch;
  }
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
