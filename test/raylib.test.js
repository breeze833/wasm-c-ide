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

console.log('--- ALL RAYLIB TESTS PASSED ---');
