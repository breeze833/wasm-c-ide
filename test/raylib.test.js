// Unit and integration tests for Raylib 5.5 graphics support
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot, RAYLIB_HEADERS } from '../src/vfs/sysroot.js';
import { SettingsModal } from '../src/components/settings.js';
import { createRaylibHost } from 'raylib-wasi';
import { InputCoordinator } from 'canvas-wasi';
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
assert.strictEqual(fs.existsSync('public/sysroot/include/raylib/raygui.h'), true, 'raygui.h must exist');
console.log('✓ Precompiled libraylib.a archive and headers verified');

// Test 2: VFS default mounting of Raylib in sysroot
const defaultVfs = new VFS();
mountSysroot(defaultVfs);
assert.strictEqual(defaultVfs.exists('/usr/include/raylib.h'), true, 'raylib.h must be mounted by default in sysroot');
assert.strictEqual(defaultVfs.exists('/usr/include/raymath.h'), true, 'raymath.h must be mounted by default in sysroot');
assert.strictEqual(defaultVfs.exists('/usr/include/rlgl.h'), true, 'rlgl.h must be mounted by default in sysroot');
assert.strictEqual(defaultVfs.exists('/usr/include/raygui.h'), true, 'raygui.h must be mounted by default in sysroot');
assert.strictEqual(defaultVfs.exists('/usr/lib/libraylib.a'), true, 'libraylib.a must be mounted by default in sysroot');
assert.strictEqual(typeof RAYLIB_HEADERS['raylib.h'], 'string');
assert.strictEqual(typeof RAYLIB_HEADERS['raygui.h'], 'string');
assert.strictEqual(defaultVfs.readFile('/usr/include/raylib.h', true), RAYLIB_HEADERS['raylib.h']);
assert.strictEqual(defaultVfs.readFile('/usr/include/raygui.h', true), RAYLIB_HEADERS['raygui.h']);
console.log('✓ VFS default sysroot mounting and raygui.h inclusion verified');

// Test 3: Project Settings modal generates build.sh & Makefile with manual linkerFlags and does not auto-add flags
const settingsVfs = new VFS();
const settings = new SettingsModal(settingsVfs, {
  mode: 'c',
  buildSystem: 'sh',
  linkerFlags: '-o game.out -lraylib',
});
settings.regenerateBuildFiles();

assert.strictEqual(settingsVfs.exists('/workspace/build.sh'), true);
const buildSh = settingsVfs.readFile('/workspace/build.sh', true);
assert.strictEqual(buildSh.includes('-lraylib'), true, 'build.sh must include -lraylib when specified in linkerFlags');

assert.strictEqual(settingsVfs.exists('/workspace/Makefile'), true);
const makefile = settingsVfs.readFile('/workspace/Makefile', true);
assert.strictEqual(makefile.includes('LDFLAGS = -o game.out -lraylib'), true, 'Makefile must include specified LDFLAGS');

// Verify that flags are NOT automatically added if omitted from linkerFlags
const settingsNoAuto = new SettingsModal(settingsVfs, {
  mode: 'c',
  buildSystem: 'sh',
  linkerFlags: '-o game.out',
});
settingsNoAuto.regenerateBuildFiles();
const buildShNoAuto = settingsVfs.readFile('/workspace/build.sh', true);
assert.strictEqual(buildShNoAuto.includes('-lraylib'), false, 'build.sh must NOT automatically add -lraylib when omitted from linkerFlags');
console.log('✓ Project Settings build.sh & Makefile generation with manual linkerFlags verified');

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

// Sync raylib headers and library to VFS
compileVfs.writeFile('/usr/include/raylib.h', fs.readFileSync('public/sysroot/include/raylib/raylib.h'), Date.now(), true);
compileVfs.writeFile('/usr/include/raymath.h', fs.readFileSync('public/sysroot/include/raylib/raymath.h'), Date.now(), true);
compileVfs.writeFile('/usr/include/rlgl.h', fs.readFileSync('public/sysroot/include/raylib/rlgl.h'), Date.now(), true);
compileVfs.writeFile('/usr/include/raygui.h', fs.readFileSync('public/sysroot/include/raylib/raygui.h'), Date.now(), true);
compileVfs.writeFile('/lib/wasm32-wasi/libraylib.a', fs.readFileSync('public/sysroot/wasm/libraylib.a'), Date.now(), true);
compileVfs.writeFile('/usr/lib/libraylib.a', fs.readFileSync('public/sysroot/wasm/libraylib.a'), Date.now(), true);

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

compileVfs.writeFile('/workspace/main.c', gameSource);
const compCode = await tc.compile('workspace/main.c', 'workspace/main.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(compCode, 0, 'Compilation of Raylib source file must succeed');

const linkCode = await tc.link(['workspace/main.o'], 'workspace/game.wasm', ['-lraylib']);
assert.strictEqual(linkCode, 0, 'Linking with -lraylib must succeed');

const gameWasmBytes = compileVfs.readFile('/workspace/game.wasm', false);
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

// Test 5b: End-to-end WasmToolchain compilation & linking with raygui.h
const guiSource = `
#define RAYGUI_IMPLEMENTATION
#include "raylib.h"
#include "raygui.h"

int main(void) {
    InitWindow(400, 200, "Raygui Test");
    (void)GuiButton((Rectangle){ 20, 20, 100, 30 }, "Test Button");
    CloseWindow();
    return 0;
}
`;
compileVfs.writeFile('/workspace/gui.c', guiSource);
const guiCompCode = await tc.compile('workspace/gui.c', 'workspace/gui.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(guiCompCode, 0, 'Compilation of raygui source file must succeed');

const guiLinkCode = await tc.link(['workspace/gui.o'], 'workspace/gui.wasm', ['-lraylib']);
assert.strictEqual(guiLinkCode, 0, 'Linking raygui app with -lraylib must succeed');
console.log('✓ End-to-end WasmToolchain compilation & linking with raygui.h verified');

// Test 5c: End-to-end compilation & linking with Raylib Audio API
const audioSource = `
#include "raylib.h"
#include <stdio.h>

int main(void) {
    InitAudioDevice();
    bool ready = IsAudioDeviceReady();
    SetMasterVolume(0.8f);
    float vol = GetMasterVolume();
    CloseAudioDevice();
    printf("Audio ready: %d, vol: %.2f\\n", ready, vol);
    return 0;
}
`;
compileVfs.writeFile('/workspace/audio.c', audioSource);
const audioCompCode = await tc.compile('workspace/audio.c', 'workspace/audio.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(audioCompCode, 0, 'Compilation of Raylib Audio source file must succeed');

const audioLinkCode = await tc.link(['workspace/audio.o'], 'workspace/audio.wasm', ['-lraylib']);
assert.strictEqual(audioLinkCode, 0, 'Linking Raylib Audio app with -lraylib must succeed');

const audioWasmBytes = compileVfs.readFile('/workspace/audio.wasm', false);
assert.notStrictEqual(audioWasmBytes, null);
const audioModule = new WebAssembly.Module(audioWasmBytes);
const audioImports = new Set(WebAssembly.Module.imports(audioModule).map(i => i.module));
assert.strictEqual(audioImports.has('raylib'), true, 'Audio functions must import from raylib namespace');
console.log('✓ End-to-end WasmToolchain compilation & linking with Raylib Audio verified');

// Test 5d: Verify createAudioReceiver and RuntimeManager audio receiver handling
const { createAudioReceiver } = await import('raylib-wasi');
assert.strictEqual(typeof createAudioReceiver, 'function');
const receiver = createAudioReceiver();
assert.ok(receiver);
assert.strictEqual(typeof receiver.handleMessage, 'function');
assert.strictEqual(typeof receiver.resume, 'function');

receiver.handleMessage({ type: 'audio_init' });
receiver.handleMessage({ type: 'audio_master_volume', volume: 0.8 });
receiver.handleMessage({ type: 'audio_close' });
console.log('✓ createAudioReceiver lifecycle and message dispatching verified');

// Test 5e: End-to-end compilation & linking of examples/10_raylib_gui_audio.c
const example10Code = fs.readFileSync('examples/10_raylib_gui_audio.c', 'utf-8');
compileVfs.writeFile('/workspace/10_raylib_gui_audio.c', example10Code);
const ex10CompCode = await tc.compile('workspace/10_raylib_gui_audio.c', 'workspace/10_raylib_gui_audio.o', 'c', ['-I/usr/include', '-I/include/wasm32-wasip1']);
assert.strictEqual(ex10CompCode, 0, 'Compilation of 10_raylib_gui_audio.c must succeed');

const ex10LinkCode = await tc.link(['workspace/10_raylib_gui_audio.o'], 'workspace/10_raylib_gui_audio.wasm', ['-lraylib']);
assert.strictEqual(ex10LinkCode, 0, 'Linking 10_raylib_gui_audio.c with -lraylib must succeed');

const ex10WasmBytes = compileVfs.readFile('/workspace/10_raylib_gui_audio.wasm', false);
assert.notStrictEqual(ex10WasmBytes, null);
const ex10Module = new WebAssembly.Module(ex10WasmBytes);
const ex10Imports = new Set(WebAssembly.Module.imports(ex10Module).map(i => i.module));
assert.strictEqual(ex10Imports.has('gl'), true, 'Must import gl namespace');
assert.strictEqual(ex10Imports.has('raylib'), true, 'Must import raylib namespace');
console.log('✓ End-to-end WasmToolchain compilation & linking of examples/10_raylib_gui_audio.c verified');

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
const { GraphicsWindowUI } = await import('canvas-wasi');
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

// Test 9: Verify onCloseRequested sets shouldClose in InputCoordinator
const mockCoord = new InputCoordinator({ sharedBuffer: new SharedArrayBuffer(512) });
let closeReqCalled = false;
const gwCloseTest = new GraphicsWindowUI({
  onCloseRequested: () => {
    mockCoord.shouldClose = true;
    mockCoord.updateSharedState();
    closeReqCalled = true;
  }
});
gwCloseTest.close();
assert.strictEqual(closeReqCalled, true, 'onCloseRequested should be invoked when window is closed');
assert.strictEqual(mockCoord.shouldClose, true);
assert.strictEqual(new DataView(mockCoord.sharedBuffer).getInt32(20, true), 1);
console.log('✓ GraphicsWindowUI onCloseRequested and shouldClose update verified');

// Test 10: Verify RuntimeManager.kill closes graphics window and resolves promise cleanly
const { RuntimeManager } = await import('../src/terminal/runtime.js');
let rmGwClosed = false;
const rmGwMock = { close() { rmGwClosed = true; } };
const rm = new RuntimeManager({ write() {}, writeln() {} });
rm.setGraphicsWindow(rmGwMock);
rm.isRunning = true;
let settledRes = null;
rm.currentResolve = (val) => { settledRes = val; };
rm.kill();
assert.strictEqual(rm.isRunning, false, 'RuntimeManager should not be running after kill()');
assert.strictEqual(rmGwClosed, true, 'Graphics window must be closed when kill() is called');
assert.strictEqual(settledRes, 130, 'Promise must resolve with SIGINT exitCode 130 on kill()');
console.log('✓ RuntimeManager.kill terminates process, hides graphics window, and resolves with exitCode 130 verified');

// Test 11: Pop-out window keyboard events, blur reset, and dock back re-attach
const popSharedBuffer = new SharedArrayBuffer(512);
const popCoord = new InputCoordinator({ sharedBuffer: popSharedBuffer });
const mockInPageCanvas = {
  width: 800,
  height: 450,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
  addEventListener(evt, fn) { this.listeners[evt] = fn; },
  removeEventListener(evt, fn) { delete this.listeners[evt]; },
  listeners: {}
};
const mockPopupWindow = {
  addEventListener(evt, fn) { this.listeners[evt] = fn; },
  removeEventListener(evt, fn) { delete this.listeners[evt]; },
  listeners: {}
};

// Initial in-page attach
popCoord.attachListeners(mockInPageCanvas);
assert.ok(mockInPageCanvas.listeners.keydown, 'keydown listener should be attached to in-page canvas');

// Pop out: attach to mockPopupWindow
popCoord.attachListeners(mockInPageCanvas, mockPopupWindow);
assert.strictEqual(mockInPageCanvas.listeners.keydown, undefined, 'keydown listener removed from canvas when windowTarget provided');
assert.ok(mockPopupWindow.listeners.keydown, 'keydown listener attached to popup window');

// Simulate pressing ArrowRight (rayKey 262) on popup window
mockPopupWindow.listeners.keydown({ code: 'ArrowRight', keyCode: 262, preventDefault() {} });
const popView = new DataView(popSharedBuffer);
const arrowWord = Math.floor(262 / 32);
const arrowBit = 262 % 32;
assert.strictEqual((popView.getUint32(44 + arrowWord * 4, true) & (1 << arrowBit)) !== 0, true, 'ArrowRight bit should be set in SharedArrayBuffer');
assert.strictEqual(popView.getInt32(108, true), 1, 'keyPressedQueue should have 1 entry');
assert.strictEqual(popView.getInt32(112, true), 262, 'keyPressedQueue[0] should be 262');

// Simulate blur on popup window
mockPopupWindow.listeners.blur();
assert.strictEqual(popView.getUint32(44 + arrowWord * 4, true), 0, 'keysDown should be cleared on blur');

// Dock back: re-attach to in-page canvas
popCoord.attachListeners(mockInPageCanvas);
assert.strictEqual(mockPopupWindow.listeners.keydown, undefined, 'popup window listeners should be removed on detach');
assert.ok(mockInPageCanvas.listeners.keydown, 'in-page canvas listener restored');
console.log('✓ Pop-out window keyboard events, blur reset, and dock back re-attach verified');

// Test 11: createRaylibHost calculates and emits onFPS in raylib_host_swap_buffers
let reportedFps = null;
let simulatedNow = 1000;
const origPerformanceNow = globalThis.performance ? globalThis.performance.now : null;
if (globalThis.performance) {
  globalThis.performance.now = () => simulatedNow;
}

const hostTest = createRaylibHost({
  width: 320,
  height: 240,
  onFPS: (fps) => {
    reportedFps = fps;
  }
});
const hostImports = hostTest.getImports();
hostImports.raylib.raylib_host_init_window(320, 240, 0);

// Perform 60 swaps over 1000ms
for (let i = 0; i < 59; i++) {
  simulatedNow += 16.666;
  hostImports.raylib.raylib_host_swap_buffers();
}
assert.strictEqual(reportedFps, null, 'Should not emit onFPS before 1 second elapsed');

// 60th frame pushes elapsed time >= 1000ms
simulatedNow += 17;
hostImports.raylib.raylib_host_swap_buffers();

if (origPerformanceNow && globalThis.performance) {
  globalThis.performance.now = origPerformanceNow;
}

assert.strictEqual(reportedFps, 60, 'Should calculate and emit 60 FPS');
console.log('✓ createRaylibHost onFPS tracking and calculation verified');

console.log('--- ALL RAYLIB TESTS PASSED ---');
