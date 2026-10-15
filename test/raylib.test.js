// Unit and integration tests for Raylib 5.5 graphics support
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { VFS } from '../src/vfs/vfs.js';
import { mountRaylibSysroot, unmountRaylibSysroot } from '../src/vfs/sysroot.js';
import { SettingsModal } from '../src/components/settings.js';
import { InputCoordinator } from '../src/toolchain/raylib-host.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';

console.log('--- Running Raylib 5.5 Graphics Unit Tests ---');

// Test 1: Verify static distribution files exist
const libraylibPath = 'public/sysroot/wasm/libraylib.a';
assert.strictEqual(fs.existsSync(libraylibPath), true, 'public/sysroot/wasm/libraylib.a must exist');
const libraylibBytes = fs.readFileSync(libraylibPath);
assert.strictEqual(libraylibBytes.subarray(0, 8).toString(), '!<arch>\n', 'libraylib.a must be an ar archive');
assert.strictEqual(fs.existsSync('public/sysroot/include/raylib/raylib.h'), true);
assert.strictEqual(fs.existsSync('public/sysroot/include/raylib/raymath.h'), true);
assert.strictEqual(fs.existsSync('public/sysroot/include/raylib/rlgl.h'), true);
console.log('✓ Precompiled libraylib.a archive and headers verified');

// Test 2: VFS mounting and unmounting of Raylib sysroot
const vfs = new VFS();
const dummyHeaders = {
  'raylib.h': '/* raylib.h */',
  'raymath.h': '/* raymath.h */',
  'rlgl.h': '/* rlgl.h */',
};
const dummyLib = new Uint8Array([1, 2, 3, 4]);

mountRaylibSysroot(vfs, dummyHeaders, dummyLib);
assert.strictEqual(vfs.exists('/usr/include/raylib.h'), true);
assert.strictEqual(vfs.exists('/usr/include/raymath.h'), true);
assert.strictEqual(vfs.exists('/usr/include/rlgl.h'), true);
assert.strictEqual(vfs.exists('/usr/lib/libraylib.a'), true);
assert.strictEqual(vfs.readFile('/usr/include/raylib.h', true), '/* raylib.h */');
assert.deepStrictEqual(vfs.readFile('/usr/lib/libraylib.a', false), dummyLib);

unmountRaylibSysroot(vfs);
assert.strictEqual(vfs.exists('/usr/include/raylib.h'), false);
assert.strictEqual(vfs.exists('/usr/include/raymath.h'), false);
assert.strictEqual(vfs.exists('/usr/include/rlgl.h'), false);
assert.strictEqual(vfs.exists('/usr/lib/libraylib.a'), false);
console.log('✓ VFS mountRaylibSysroot and unmountRaylibSysroot verified');

// Test 3: Project Settings modal generates build.sh & Makefile with -lraylib when enableRaylib: true
const settingsVfs = new VFS();
const settings = new SettingsModal(settingsVfs, {
  mode: 'c',
  buildSystem: 'sh',
  enableRaylib: true,
  targetName: 'game.out',
});
settings.regenerateBuildFiles();

assert.strictEqual(settingsVfs.exists('/workspace/build.sh'), true);
const buildSh = settingsVfs.readFile('/workspace/build.sh', true);
assert.strictEqual(buildSh.includes('-lraylib'), true, 'build.sh must include -lraylib when enableRaylib is true');

assert.strictEqual(settingsVfs.exists('/workspace/Makefile'), true);
const makefile = settingsVfs.readFile('/workspace/Makefile', true);
assert.strictEqual(makefile.includes('LDFLAGS = -lraylib'), true, 'Makefile must include LDFLAGS = -lraylib when enableRaylib is true');
console.log('✓ Project Settings build.sh & Makefile generation with -lraylib verified');

// Test 4: InputCoordinator state synchronization across SharedArrayBuffer
const sharedBuffer = new SharedArrayBuffer(512);
const coord = new InputCoordinator({
  sharedBuffer,
  width: 640,
  height: 480,
  dpiScale: 1.0,
});

coord.windowWidth = 640;
coord.windowHeight = 480;
coord.mouseX = 120;
coord.mouseY = 240;
coord.keysDown[0] |= (1 << 5); // key 5 down
coord.keyPressedQueue.push(65); // Key 'A' pressed
coord.charPressedQueue.push(65); // Char 'A' pressed
coord.updateSharedState();

// Verify SharedArrayBuffer byte layout matching rcore_wasi.c WasiInputState struct
const view = new DataView(sharedBuffer);
assert.strictEqual(view.getInt32(0, true), 640, 'windowWidth matches');
assert.strictEqual(view.getInt32(4, true), 480, 'windowHeight matches');
assert.strictEqual(view.getFloat32(24, true), 120, 'mouseX matches');
assert.strictEqual(view.getFloat32(28, true), 240, 'mouseY matches');
assert.strictEqual(view.getUint32(44, true), 1 << 5, 'keysDown bitset matches');
assert.strictEqual(view.getInt32(108, true), 1, 'keyPressedQueue count matches');
assert.strictEqual(view.getInt32(112, true), 65, 'keyPressedQueue[0] matches');
assert.strictEqual(view.getInt32(240, true), 1, 'charPressedQueue count matches');
assert.strictEqual(view.getInt32(244, true), 65, 'charPressedQueue[0] matches');

// Test polling to simulated Wasm linear memory
const wasmMem = new WebAssembly.Memory({ initial: 1, maximum: 1 });
coord.pollToWasm(1024, wasmMem);
const wasmView = new DataView(wasmMem.buffer, 1024, 372);
assert.strictEqual(wasmView.getInt32(0, true), 640);
assert.strictEqual(wasmView.getFloat32(24, true), 120);
assert.strictEqual(wasmView.getUint32(44, true), 1 << 5);

// Verify shouldClose setting and reset() cleanup
coord.shouldClose = true;
coord.updateSharedState();
assert.strictEqual(view.getInt32(20, true), 1, 'shouldClose should be 1');
coord.pollToWasm(1024, wasmMem);
assert.strictEqual(wasmView.getInt32(20, true), 1, 'wasm shouldClose should be 1');

coord.reset();
assert.strictEqual(coord.shouldClose, false, 'shouldClose should reset to false');
assert.strictEqual(view.getInt32(20, true), 0, 'sharedBuffer shouldClose should reset to 0');
coord.pollToWasm(1024, wasmMem);
assert.strictEqual(wasmView.getInt32(20, true), 0, 'wasm shouldClose should reset to 0');

console.log('✓ InputCoordinator SharedArrayBuffer state sync and pollToWasm verified');

// Test 5: End-to-end WasmToolchain compilation and linking with -lraylib
globalThis.fetch = async (url) => {
  const filePath = url.replace(/^\/?sysroot\//, 'public/sysroot/');
  const resolved = path.resolve(filePath);
  const data = fs.readFileSync(resolved);
  return {
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
};

const compileVfs = new VFS();
const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs: compileVfs });
await tc.init();

// Sync raylib headers and library to toolchain MemFS
tc.memfs.addFile('include/raylib.h', fs.readFileSync('public/sysroot/include/raylib/raylib.h'));
tc.memfs.addFile('include/raymath.h', fs.readFileSync('public/sysroot/include/raylib/raymath.h'));
tc.memfs.addFile('include/rlgl.h', fs.readFileSync('public/sysroot/include/raylib/rlgl.h'));
tc.memfs.addFile('lib/wasm32-wasi/libraylib.a', fs.readFileSync('public/sysroot/wasm/libraylib.a'));
tc.memfs.addFile('usr/lib/libraylib.a', fs.readFileSync('public/sysroot/wasm/libraylib.a'));

const gameSource = `
#include "raylib.h"
#include <stdio.h>

int main(void) {
    printf("Initializing Raylib window\\n");
    InitWindow(800, 450, "Raylib Wasi Test");
    SetTargetFPS(60);
    int frameCount = 0;
    while (!WindowShouldClose() && frameCount < 2) {
        BeginDrawing();
        ClearBackground(RAYWHITE);
        DrawText("Hello Raylib!", 190, 200, 20, LIGHTGRAY);
        EndDrawing();
        frameCount++;
    }
    CloseWindow();
    printf("Window closed successfully\\n");
    return 0;
}
`;

tc.memfs.addFile('workspace/main.c', gameSource);
const compCode = await tc.compile('workspace/main.c', 'workspace/main.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(compCode, 0, 'Compilation of Raylib source file must succeed');

const linkCode = await tc.link(['workspace/main.o'], 'workspace/game.wasm', ['-lraylib']);
assert.strictEqual(linkCode, 0, 'Linking with -lraylib must succeed');

const gameWasmBytes = tc.getFileFromMemfs('workspace/game.wasm');
assert.notStrictEqual(gameWasmBytes, null);
assert.strictEqual(gameWasmBytes[0], 0x00);
assert.strictEqual(gameWasmBytes[1], 0x61);
assert.strictEqual(gameWasmBytes[2], 0x73);
assert.strictEqual(gameWasmBytes[3], 0x6d);

const gameModule = new WebAssembly.Module(gameWasmBytes);
const imports = WebAssembly.Module.imports(gameModule);
const moduleNames = new Set(imports.map(i => i.module));

assert.strictEqual(moduleNames.has('wasi_unstable') || moduleNames.has('wasi_snapshot_preview1'), true, 'Must import WASI');
assert.strictEqual(moduleNames.has('gl'), true, 'Must import gl namespace');
assert.strictEqual(moduleNames.has('raylib'), true, 'Must import raylib namespace');
console.log('✓ End-to-end WasmToolchain compilation & linking with -lraylib verified');

// Test 5b: Unmounting Raylib sysroot purges files from toolchain MemFS
unmountRaylibSysroot(compileVfs, tc);
assert.strictEqual(compileVfs.exists('/usr/include/raylib.h'), false);
assert.strictEqual(compileVfs.exists('/usr/lib/libraylib.a'), false);
assert.strictEqual(tc.getFileFromMemfs('include/raylib.h'), null, 'Raylib header must be removed from toolchain MemFS');
assert.strictEqual(tc.getFileFromMemfs('include/raymath.h'), null);
assert.strictEqual(tc.getFileFromMemfs('include/rlgl.h'), null);
assert.strictEqual(tc.getFileFromMemfs('usr/lib/libraylib.a'), null, 'Raylib library must be removed from toolchain MemFS');
assert.strictEqual(tc.getFileFromMemfs('lib/wasm32-wasi/libraylib.a'), null);

// Verify subsequent compilation of raylib code now fails because raylib.h is gone
const failCompCode = await tc.compile('workspace/main.c', 'workspace/main2.o', 'c', ['-I/include', '-I/workspace']);
assert.notStrictEqual(failCompCode, 0, 'Compilation must fail when raylib is unmounted');
console.log('✓ unmountRaylibSysroot MemFS clearance and compilation failure verified');

// Test 6: Verification of WASI runtime imports including path_open and env.getcwd
let stdoutOutput = '';
let memoryInst = null;
const wasiTest = {
  proc_exit() {},
  fd_write(fd, iovs, iovs_len, nwritten_out) {
    const memU8 = new Uint8Array(memoryInst.buffer);
    const memU32 = new Uint32Array(memoryInst.buffer);
    let total = 0;
    for (let i = 0; i < iovs_len; i++) {
      const ptr = memU32[(iovs >> 2) + i * 2];
      const len = memU32[(iovs >> 2) + i * 2 + 1];
      for (let j = 0; j < len; j++) stdoutOutput += String.fromCharCode(memU8[ptr + j]);
      total += len;
    }
    memU32[nwritten_out >> 2] = total;
    return 0;
  },
  fd_read() { return 8; },
  fd_close() { return 0; },
  fd_seek() { return 0; },
  fd_fdstat_get(fd, stat_out) {
    new Uint8Array(memoryInst.buffer).fill(0, stat_out, stat_out + 24);
    return 0;
  },
  fd_fdstat_set_flags() { return 0; },
  fd_fdstat_set_rights() { return 0; },
  fd_filestat_get() { return 0; },
  fd_filestat_set_size() { return 0; },
  fd_pread() { return 8; },
  fd_pwrite() { return 8; },
  fd_tell() { return 0; },
  fd_sync() { return 0; },
  fd_prestat_get() { return 8; },
  fd_prestat_dir_name() { return 8; },
  path_open() { return 44; },
  path_filestat_get() { return 44; },
  environ_sizes_get(c, s) {
    new Uint32Array(memoryInst.buffer)[c >> 2] = 0;
    new Uint32Array(memoryInst.buffer)[s >> 2] = 0;
    return 0;
  },
  environ_get() { return 0; },
  args_sizes_get(c, s) {
    new Uint32Array(memoryInst.buffer)[c >> 2] = 0;
    new Uint32Array(memoryInst.buffer)[s >> 2] = 0;
    return 0;
  },
  args_get() { return 0; },
  clock_time_get(id, prec, out) {
    const now = BigInt(Date.now()) * 1000000n;
    new BigInt64Array(memoryInst.buffer)[out >> 3] = now;
    return 0;
  },
  clock_res_get() { return 0; },
  random_get() { return 0; },
  poll_oneoff() { return 0; },
  sched_yield() { return 0; }
};
const wasiTestProxy = new Proxy(wasiTest, {
  get(t, p) { return p in t ? t[p] : () => 0; }
});
const envTest = {
  getcwd(buf, size) {
    const cwd = '/workspace';
    if (!buf || size <= 0) return 0;
    const len = Math.min(size - 1, cwd.length);
    const u8 = new Uint8Array(memoryInst.buffer);
    for (let i = 0; i < len; i++) u8[buf + i] = cwd.charCodeAt(i);
    u8[buf + len] = 0;
    return buf;
  }
};
const envTestProxy = new Proxy(envTest, {
  get(t, p) { return p in t ? t[p] : () => 0; }
});

const gameInstance = await WebAssembly.instantiate(gameModule, {
  wasi_unstable: wasiTestProxy,
  wasi_snapshot_preview1: wasiTestProxy,
  env: envTestProxy,
  gl: new Proxy({}, { get: () => () => 0 }),
  raylib: new Proxy({
    raylib_host_init_window: () => 1,
    raylib_host_poll_input: () => 0,
  }, { get: (t, p) => p in t ? t[p] : () => 0 })
});
memoryInst = gameInstance.exports.memory;
gameInstance.exports._start();
assert.strictEqual(stdoutOutput.includes('Initializing Raylib window'), true);
assert.strictEqual(stdoutOutput.includes('Window closed successfully'), true);
console.log('✓ Runtime execution with WASI Preview 1 (path_open, getcwd, etc.) verified');

// Test 7: GraphicsWindowUI lifecycle, open(), isOpen(), renderFrame(), updateFPS(), close()
const elements = new Map();
function createMockElement(tag, id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: '',
    style: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    },
    children: [],
    innerHTML: '',
    textContent: '',
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel) {
      if (sel.startsWith('#')) {
        const targetId = sel.slice(1);
        if (!elements.has(targetId)) {
          elements.set(targetId, createMockElement('div', targetId));
        }
        return elements.get(targetId);
      }
      return createMockElement('div');
    },
    getContext(type) {
      return {
        transferFromImageBitmap() {},
        drawImage() {}
      };
    },
    focus() {}
  };
  if (id) elements.set(id, el);
  return el;
}

const mockDoc = {
  getElementById(id) {
    if (!elements.has(id)) {
      elements.set(id, createMockElement('div', id));
    }
    return elements.get(id);
  },
  createElement(tag) {
    return createMockElement(tag);
  },
  body: createMockElement('body')
};

globalThis.document = mockDoc;
const { GraphicsWindowUI } = await import('../src/components/graphics-window.js');
const gw = new GraphicsWindowUI();
assert.strictEqual(gw.isOpen(), false, 'Window should initially be closed');

gw.open(640, 480, 'Test Game');
assert.strictEqual(gw.isOpen(), true, 'Window should be open after open()');
assert.strictEqual(gw.width, 640);
assert.strictEqual(gw.height, 480);
assert.strictEqual(gw.canvas.width, 640);
assert.strictEqual(gw.canvas.height, 480);
assert.strictEqual(gw.canvas.style.width, '640px');
assert.strictEqual(gw.canvas.style.height, '480px');
assert.strictEqual(gw.resBadge.textContent, '640x480');
assert.strictEqual(gw.title, 'Test Game');

// Test dynamic resizing on subsequent InitWindow call with different dimensions
gw.open(400, 300, 'Small Window');
assert.strictEqual(gw.width, 400);
assert.strictEqual(gw.height, 300);
assert.strictEqual(gw.canvas.width, 400);
assert.strictEqual(gw.canvas.height, 300);
assert.strictEqual(gw.canvas.style.width, '400px');
assert.strictEqual(gw.canvas.style.height, '300px');
assert.strictEqual(gw.resBadge.textContent, '400x300');
assert.strictEqual(gw.title, 'Small Window');

gw.updateFPS(59.8);
assert.strictEqual(gw.fpsBadge.textContent, '60 FPS');

gw.renderFrame({ close() {} });

gw.close();
assert.strictEqual(gw.isOpen(), false, 'Window should be closed after close()');

// Test toggle preserves custom canvas dimensions without resetting to default 800x450
gw.open(450, 450, 'Square Window');
assert.strictEqual(gw.width, 450);
assert.strictEqual(gw.height, 450);
assert.strictEqual(gw.canvas.style.width, '450px');
assert.strictEqual(gw.canvas.style.height, '450px');

// First toggle: should hide window
gw.toggle();
assert.strictEqual(gw.isOpen(), false, 'Window should be hidden after toggle()');

// Second toggle: should show window without resetting dimensions to 800x450
gw.toggle();
assert.strictEqual(gw.isOpen(), true, 'Window should be open after toggle()');
assert.strictEqual(gw.width, 450, 'Width must remain 450 after toggle()');
assert.strictEqual(gw.height, 450, 'Height must remain 450 after toggle()');
assert.strictEqual(gw.canvas.width, 450);
assert.strictEqual(gw.canvas.height, 450);
assert.strictEqual(gw.canvas.style.width, '450px');
assert.strictEqual(gw.canvas.style.height, '450px');
assert.strictEqual(gw.resBadge.textContent, '450x450');

gw.close();
console.log('✓ GraphicsWindowUI open, isOpen, dynamic resizing, toggle dimension preservation, renderFrame, updateFPS, and close verified');

console.log('--- ALL RAYLIB TESTS PASSED ---');
