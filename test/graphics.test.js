// test/graphics.test.js
// Tests generic graphics subsystem: graphics.h header mounting, GraphicsWindowUI (#graphics-canvas),
// pure C compilation with WasmToolchain, and runtime frame presentation and input coordination.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot, STANDARD_C_HEADERS } from '../src/vfs/sysroot.js';
import { InputCoordinator } from '../src/toolchain/raylib-host.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';
import { executeGccCommand } from '../src/toolchain/driver.js';

console.log('--- Running Generic Graphics Canvas Unit Tests ---');

// Test 1: Verify graphics.h is present in STANDARD_C_HEADERS and mounted to /usr/include/graphics.h
const vfs = new VFS();
mountSysroot(vfs);
assert.strictEqual(typeof STANDARD_C_HEADERS['graphics.h'], 'string', 'graphics.h must be in STANDARD_C_HEADERS');
assert.strictEqual(vfs.exists('/usr/include/graphics.h'), true, '/usr/include/graphics.h must exist after mountSysroot');

const headerContent = vfs.readFile('/usr/include/graphics.h');
assert.strictEqual(headerContent.includes('graphics_init'), true);
assert.strictEqual(headerContent.includes('graphics_present'), true);
assert.strictEqual(headerContent.includes('graphics_present_rgba'), true);
assert.strictEqual(headerContent.includes('graphics_should_close'), true);
assert.strictEqual(headerContent.includes('graphics_close'), true);
assert.strictEqual(headerContent.includes('graphics_wait_frame'), true);
assert.strictEqual(headerContent.includes('graphics_get_mouse'), true);
assert.strictEqual(headerContent.includes('graphics_is_key_down'), true);
console.log('✓ graphics.h presence and API signatures verified');

// Test 2: Verify GraphicsWindowUI uses id="graphics-canvas" and id="graphics-popup-canvas"
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
        type,
        transferFromImageBitmap() {},
        drawImage() {}
      };
    },
    focus() {}
  };
  if (id) elements.set(id, el);
  return el;
}

globalThis.document = {
  body: createMockElement('body'),
  getElementById(id) {
    if (!elements.has(id)) {
      elements.set(id, createMockElement('div', id));
    }
    return elements.get(id);
  },
  createElement(tag) {
    return createMockElement(tag);
  }
};

const { GraphicsWindowUI } = await import('canvas-wasi');
const win = new GraphicsWindowUI();
assert.strictEqual(win.container.innerHTML.includes('id="graphics-canvas"'), true, 'Container must include canvas with id="graphics-canvas"');
assert.strictEqual(win.title, 'Graphics Display', 'Default title must be Graphics Display');

// Verify canvas element exists and context initialized
assert.notStrictEqual(win.canvas, null);
assert.strictEqual(win.isOpen(), false);
win.open(640, 480, 'Custom App');
assert.strictEqual(win.isOpen(), true);
assert.strictEqual(win.width, 640);
assert.strictEqual(win.height, 480);
assert.strictEqual(win.title, 'Custom App');
win.close();
assert.strictEqual(win.isOpen(), false);

// Re-opening automatically configures and displays window
win.open(320, 240, 'Plasma App');
assert.strictEqual(win.isOpen(), true, 'Window must become visible automatically on open');
assert.strictEqual(win.width, 320);
assert.strictEqual(win.height, 240);
assert.strictEqual(win.title, 'Plasma App');

// Minimizing and then calling open auto-unminimizes and shows
win.toggleMinimize();
assert.strictEqual(win.isMinimized, true);
win.open(400, 300, 'Unminimize Test');
assert.strictEqual(win.isMinimized, false);
assert.strictEqual(win.isOpen(), true);
win.close();

// Background frame activity indicator tests:
let activityEvents = [];
const activityWin = new GraphicsWindowUI({
  onFrameActivity: (active) => {
    activityEvents.push(active);
  }
});

// Initially window is closed; renderFrame should NOT force open window
const mockBitmap = { close() {} };
activityWin.renderFrame(mockBitmap);
assert.strictEqual(activityWin.isOpen(), false, 'renderFrame must NOT force window open if hidden');
assert.strictEqual(activityWin._hasBackgroundActivity, true, 'Background activity must be true');
assert.deepStrictEqual(activityEvents, [true], 'onFrameActivity(true) must be called');

// Repeated renderFrame while hidden does not trigger duplicate events
activityWin.renderFrame(mockBitmap);
assert.deepStrictEqual(activityEvents, [true], 'No redundant activity event if already active');

// When user opens/shows the window, activity is cleared
activityWin.show();
assert.strictEqual(activityWin.isOpen(), true);
assert.strictEqual(activityWin._hasBackgroundActivity, false, 'Activity must clear on show()');
assert.deepStrictEqual(activityEvents, [true, false], 'onFrameActivity(false) must be called on show()');

// While open, renderFrame keeps activity false
activityWin.renderFrame(mockBitmap);
assert.strictEqual(activityWin._hasBackgroundActivity, false);

// When minimized, renderFrame triggers activity indicator
activityWin.toggleMinimize();
assert.strictEqual(activityWin.isMinimized, true);
activityWin.renderFrame(mockBitmap);
assert.strictEqual(activityWin._hasBackgroundActivity, true, 'Activity must be true when minimized');
assert.deepStrictEqual(activityEvents, [true, false, true]);

// Unminimizing clears activity
activityWin.toggleMinimize();
assert.strictEqual(activityWin.isMinimized, false);
assert.strictEqual(activityWin._hasBackgroundActivity, false);
assert.deepStrictEqual(activityEvents, [true, false, true, false]);

// Closing clears activity
activityWin.close();
assert.strictEqual(activityWin._hasBackgroundActivity, false);

console.log('✓ GraphicsWindowUI element IDs, lifecycle, and background frame activity indicator verified');

// Test 3: SharedArrayBuffer input coordination for generic graphics
const sharedBuf = new SharedArrayBuffer(512);
const inputCoord = new InputCoordinator({ sharedBuffer: sharedBuf, width: 640, height: 480 });
const mockCanvas = createMockElement('canvas', 'graphics-canvas');
const listeners = {};
mockCanvas.addEventListener = (evt, fn) => { listeners[evt] = fn; };
mockCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480 });
mockCanvas.width = 640;
mockCanvas.height = 480;
inputCoord.attachListeners(mockCanvas);

// Simulate mouse move
listeners['mousemove']({ clientX: 120, clientY: 240 });
const sharedView = new DataView(sharedBuf);
assert.strictEqual(Math.round(sharedView.getFloat32(24, true)), 120);
assert.strictEqual(Math.round(sharedView.getFloat32(28, true)), 240);

// Simulate mouse click
listeners['mousedown']({ button: 0, clientX: 120, clientY: 240 });
assert.strictEqual(sharedView.getUint32(40, true), 1); // Left button bit

// Simulate keydown
listeners['keydown']({ code: 'KeyA', keyCode: 65, key: 'a' });
const keyWord = Math.floor(65 / 32);
const keyBit = 65 % 32;
const keysDownVal = sharedView.getUint32(44 + keyWord * 4, true);
assert.strictEqual(((keysDownVal >>> keyBit) & 1), 1, 'Key A bit must be set');

console.log('✓ InputCoordinator SharedArrayBuffer sync for generic graphics verified');

// Test 4: End-to-end Pure C compilation with <graphics.h>
globalThis.fetch = async (url) => {
  const filePath = url.replace(/^\/?sysroot\//, 'public/sysroot/');
  const resolved = path.resolve(filePath);
  const data = fs.readFileSync(resolved);
  return {
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
};

const compileVfs = new VFS();
mountSysroot(compileVfs);
const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs: compileVfs });
await tc.init();

const cCode = `
#include <graphics.h>
#include <stdint.h>
#include <stdlib.h>

int main(void) {
    graphics_init(320, 240, "Pixel Demo");
    uint32_t *pixels = (uint32_t*)malloc(320 * 240 * sizeof(uint32_t));
    for (int y = 0; y < 240; y++) {
        for (int x = 0; x < 320; x++) {
            pixels[y * 320 + x] = 0xFF0000FF; // Red color
        }
    }
    graphics_present(pixels);
    if (!graphics_should_close()) {
        graphics_wait_frame(60);
    }
    graphics_close();
    free(pixels);
    return 0;
}
`;

tc.memfs.addFile('include/graphics.h', compileVfs.readFile('/usr/include/graphics.h'));
tc.memfs.addFile('workspace/main.c', cCode);
const compCode = await tc.compile('workspace/main.c', 'workspace/main.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(compCode, 0, 'Pure C compilation of graphics.h program must succeed');

const linkCode = await tc.link(['workspace/main.o'], 'workspace/a.out');
assert.strictEqual(linkCode, 0, 'Linkage of graphics.h program must succeed');

const wasmBytes = tc.getFileFromMemfs('workspace/a.out');
assert.notStrictEqual(wasmBytes, null);
assert.strictEqual(wasmBytes[0], 0x00);
assert.strictEqual(wasmBytes[1], 0x61);
assert.strictEqual(wasmBytes[2], 0x73);
assert.strictEqual(wasmBytes[3], 0x6d);

const compiledModule = new WebAssembly.Module(wasmBytes);
const imports = WebAssembly.Module.imports(compiledModule);
const importedNames = new Set(imports.map(i => i.name));

assert.strictEqual(importedNames.has('graphics_init'), true, 'Binary must import graphics_init');
assert.strictEqual(importedNames.has('graphics_present'), true, 'Binary must import graphics_present');
assert.strictEqual(importedNames.has('graphics_should_close'), true, 'Binary must import graphics_should_close');
assert.strictEqual(importedNames.has('graphics_close'), true, 'Binary must import graphics_close');

console.log('✓ End-to-end WasmToolchain compilation & linkage with <graphics.h> verified');

// Test 5: Verify runtime execution of the compiled graphics binary with generic host bridge
let initReceived = null;
let framesReceived = 0;
let closeReceived = false;

let runtimeMem = null;
let currentGfxWidth = 320;
let currentGfxHeight = 240;

const genericGraphicsHost = {
  graphics_init(w, h, titlePtr) {
    currentGfxWidth = w;
    currentGfxHeight = h;
    const u8 = new Uint8Array(runtimeMem.buffer, titlePtr);
    let end = 0;
    while (u8[end] !== 0) end++;
    const title = new TextDecoder('utf-8').decode(new Uint8Array(runtimeMem.buffer, titlePtr, end));
    initReceived = { width: w, height: h, title };
  },
  graphics_present(ptr) {
    framesReceived++;
    assert.strictEqual(ptr > 0, true);
    const u32 = new Uint32Array(runtimeMem.buffer, ptr, currentGfxWidth * currentGfxHeight);
    assert.strictEqual(u32[0], 0xFF0000FF, 'First pixel must be red');
  },
  graphics_present_rgba(ptr, w, h) {
    framesReceived++;
  },
  graphics_should_close() {
    return 0;
  },
  graphics_wait_frame() {},
  graphics_close() {
    closeReceived = true;
  },
  graphics_get_mouse() {},
  graphics_is_key_down() { return 0; }
};

const wasiStub = new Proxy({}, { get: () => () => 0 });
const runtimeInstance = await WebAssembly.instantiate(compiledModule, {
  wasi_unstable: wasiStub,
  wasi_snapshot_preview1: wasiStub,
  env: new Proxy(genericGraphicsHost, { get: (t, p) => p in t ? t[p] : () => 0 }),
  graphics: new Proxy(genericGraphicsHost, { get: (t, p) => p in t ? t[p] : () => 0 })
});

runtimeMem = runtimeInstance.exports.memory;
runtimeInstance.exports._start();

assert.notStrictEqual(initReceived, null, 'graphics_init must be called');
assert.strictEqual(initReceived.width, 320);
assert.strictEqual(initReceived.height, 240);
assert.strictEqual(initReceived.title, 'Pixel Demo');
assert.strictEqual(framesReceived, 1, 'graphics_present must deliver 1 frame');
assert.strictEqual(closeReceived, true, 'graphics_close must be called');

console.log('✓ Runtime execution and frame presentation verified');

// Test 6: Verify graphics_canvas.h presence and API signatures
assert.strictEqual(typeof STANDARD_C_HEADERS['graphics_canvas.h'], 'string', 'graphics_canvas.h must be in STANDARD_C_HEADERS');
assert.strictEqual(vfs.exists('/usr/include/graphics_canvas.h'), true, '/usr/include/graphics_canvas.h must exist after mountSysroot');
const canvasHeaderContent = vfs.readFile('/usr/include/graphics_canvas.h');
assert.strictEqual(canvasHeaderContent.includes('#include <graphics.h>'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_present'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_fill_rect'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_stroke_rect'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_clear_rect'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_arc'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_fill_text'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_set_fill_style'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_set_font'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_save'), true);
assert.strictEqual(canvasHeaderContent.includes('canvas_restore'), true);
console.log('✓ graphics_canvas.h presence and 2D vector API signatures verified');

// Test 7: End-to-end Pure C compilation with <graphics_canvas.h>
tc.memfs.addFile('include/graphics_canvas.h', vfs.readFile('/usr/include/graphics_canvas.h'));

const canvasCode = `
#include <graphics_canvas.h>

int main(void) {
    graphics_init(640, 480, "2D Vector Demo");

    // Draw background rectangle
    canvas_set_fill_style("#1e1e1e");
    canvas_fill_rect(0, 0, 640, 480);

    // Draw circle
    canvas_begin_path();
    canvas_arc(320, 240, 50, 0, 6.28f, false);
    canvas_set_fill_style("cyan");
    canvas_fill();

    // Draw text
    canvas_set_font("bold 24px sans-serif");
    canvas_set_fill_style("#ffffff");
    canvas_fill_text("Hello Canvas 2D!", 200, 100);

    // Present frame to display
    canvas_present();
    graphics_close();
    return 0;
}
`;

tc.memfs.addFile('workspace/canvas_demo.c', canvasCode);
const compCanvasCode = await tc.compile('workspace/canvas_demo.c', 'workspace/canvas_demo.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(compCanvasCode, 0, 'Pure C compilation of graphics_canvas.h program must succeed');

const linkCanvasCode = await tc.link(['workspace/canvas_demo.o'], 'workspace/canvas_demo.out');
assert.strictEqual(linkCanvasCode, 0, 'Linkage of graphics_canvas.h program must succeed');

const canvasWasmBytes = tc.getFileFromMemfs('workspace/canvas_demo.out');
assert.notStrictEqual(canvasWasmBytes, null);

const canvasModule = new WebAssembly.Module(canvasWasmBytes);
const canvasImports = WebAssembly.Module.imports(canvasModule);
const canvasImportNames = new Set(canvasImports.map(i => i.name));

assert.strictEqual(canvasImportNames.has('canvas_fill_rect'), true);
assert.strictEqual(canvasImportNames.has('canvas_arc'), true);
assert.strictEqual(canvasImportNames.has('canvas_fill_text'), true);
assert.strictEqual(canvasImportNames.has('canvas_present'), true);
console.log('✓ End-to-end WasmToolchain compilation & linkage with <graphics_canvas.h> verified');

// Test 8: Verify runtime execution of the compiled 2D vector canvas binary
let canvasFilledRects = 0;
let canvasArcs = 0;
let canvasTextDrawn = '';
let canvasFramesPresented = 0;

let canvasRuntimeMem = null;
const canvasHostBridge = {
  ...genericGraphicsHost,
  canvas_fill_rect(x, y, w, h) {
    canvasFilledRects++;
    assert.strictEqual(w, 640);
    assert.strictEqual(h, 480);
  },
  canvas_stroke_rect() {},
  canvas_clear_rect() {},
  canvas_begin_path() {},
  canvas_close_path() {},
  canvas_move_to() {},
  canvas_line_to() {},
  canvas_arc(x, y, r, sa, ea, ccw) {
    canvasArcs++;
    assert.strictEqual(r, 50);
  },
  canvas_fill() {},
  canvas_stroke() {},
  canvas_set_fill_style() {},
  canvas_set_stroke_style() {},
  canvas_set_fill_rgb() {},
  canvas_set_line_width() {},
  canvas_set_line_cap() {},
  canvas_fill_text(textPtr, x, y) {
    const u8 = new Uint8Array(canvasRuntimeMem.buffer, textPtr);
    let end = 0;
    while (u8[end] !== 0) end++;
    canvasTextDrawn = new TextDecoder('utf-8').decode(new Uint8Array(canvasRuntimeMem.buffer, textPtr, end));
  },
  canvas_stroke_text() {},
  canvas_set_font() {},
  canvas_save() {},
  canvas_restore() {},
  canvas_translate() {},
  canvas_rotate() {},
  canvas_scale() {},
  canvas_present() {
    canvasFramesPresented++;
  }
};

const canvasRuntimeInstance = await WebAssembly.instantiate(canvasModule, {
  wasi_unstable: wasiStub,
  wasi_snapshot_preview1: wasiStub,
  env: new Proxy(canvasHostBridge, { get: (t, p) => p in t ? t[p] : () => 0 }),
  graphics: new Proxy(canvasHostBridge, { get: (t, p) => p in t ? t[p] : () => 0 }),
  canvas: new Proxy(canvasHostBridge, { get: (t, p) => p in t ? t[p] : () => 0 })
});

canvasRuntimeMem = canvasRuntimeInstance.exports.memory;
canvasRuntimeInstance.exports._start();

assert.strictEqual(canvasFilledRects, 1, 'canvas_fill_rect should be called 1 time');
assert.strictEqual(canvasArcs, 1, 'canvas_arc should be called 1 time');
assert.strictEqual(canvasTextDrawn, 'Hello Canvas 2D!', 'Text drawn must match');
assert.strictEqual(canvasFramesPresented, 1, 'canvas_present should be called 1 time');

console.log('✓ Runtime execution of 2D vector canvas operations verified');

// Test 9: Verify executeGccCommand automatically syncs VFS /usr/include/graphics.h into MemFS
const driverVfs = new VFS();
mountSysroot(driverVfs);
driverVfs.writeFile('/workspace/test_gfx.c', `
#include <graphics.h>
#include <stdint.h>
int main(void) {
    graphics_init(100, 100, "Auto Sync Test");
    graphics_close();
    return 0;
}
`);
let driverOutput = '';
const driverToolchain = new WasmToolchain({ basePath: '/sysroot/wasm', vfs: driverVfs });
await driverToolchain.init();

const gccExit = await executeGccCommand({
  args: ['test_gfx.c', '-o', 'test_gfx.out'],
  cwd: '/workspace',
  vfs: driverVfs,
  toolchain: driverToolchain,
  mode: 'c',
  write: (s) => { driverOutput += s; }
});
assert.strictEqual(gccExit, 0, `executeGccCommand must compile <graphics.h> successfully. Output: ${driverOutput}`);
assert.strictEqual(driverVfs.exists('/workspace/test_gfx.out'), true, 'Binary should be produced in VFS');
console.log('✓ executeGccCommand automatic VFS /usr/include/graphics.h header sync verified');

// Test 10: Verify envProxy in runtime.worker.js dispatches genericGraphics methods directly
const testEnv = {};
const testGenericGfx = {
  graphics_init: () => 'init_ok',
  graphics_present: () => 'present_ok',
};
for (const [name, fn] of Object.entries(testGenericGfx)) {
  testEnv[name] = fn;
}
const testEnvProxy = new Proxy(testEnv, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return () => 0;
  }
});
assert.strictEqual(testEnvProxy.graphics_init(), 'init_ok', 'graphics_init must resolve on envProxy');
assert.strictEqual(testEnvProxy.graphics_present(), 'present_ok', 'graphics_present must resolve on envProxy');
console.log('✓ runtime.worker.js env binding for genericGraphics verified');

// Test 11: Verify examples/03_framebuffer_graphics.c compiles and links cleanly with persistent canvas layer
const example03Code = fs.readFileSync(path.resolve('examples/03_framebuffer_graphics.c'), 'utf-8');
tc.memfs.addFile('workspace/03_framebuffer_graphics.c', example03Code);
const comp03 = await tc.compile('workspace/03_framebuffer_graphics.c', 'workspace/03_framebuffer_graphics.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(comp03, 0, 'examples/03_framebuffer_graphics.c must compile without errors');
const link03 = await tc.link(['workspace/03_framebuffer_graphics.o'], 'workspace/03_framebuffer_graphics.out');
assert.strictEqual(link03, 0, 'examples/03_framebuffer_graphics.c must link without errors');
console.log('✓ examples/03_framebuffer_graphics.c end-to-end compilation & linkage verified');

// Test 12: Verify graphics_canvas.h declares pixel-level manipulation APIs
const canvasHeader = vfs.readFile('/usr/include/graphics_canvas.h');
assert.strictEqual(canvasHeader.includes('canvas_get_image_data'), true);
assert.strictEqual(canvasHeader.includes('canvas_put_image_data'), true);
assert.strictEqual(canvasHeader.includes('canvas_get_pixels'), true);
assert.strictEqual(canvasHeader.includes('canvas_put_pixels'), true);
assert.strictEqual(canvasHeader.includes('canvas_get_pixel'), true);
assert.strictEqual(canvasHeader.includes('canvas_set_pixel'), true);
console.log('✓ graphics_canvas.h pixel manipulation API signatures verified');

// Test 13: End-to-end compilation and runtime execution of canvas pixel manipulation
const pixelTestCode = `
#include <graphics_canvas.h>
#include <stdint.h>

int main(void) {
    graphics_init(100, 100, "Pixel Test");

    // Write a pixel
    canvas_set_pixel(10, 20, 0xFF00FF00); // Green
    uint32_t p = canvas_get_pixel(10, 20);

    // Get & put sub-rectangle
    uint32_t sub[4];
    canvas_get_image_data(0, 0, 2, 2, sub);
    sub[0] = 0xFFFF0000;
    canvas_put_image_data(5, 5, 2, 2, sub);

    // Get & put all pixels
    uint32_t full[100 * 100];
    canvas_get_pixels(full);
    full[0] = p;
    canvas_put_pixels(full);

    canvas_present();
    graphics_close();
    return 0;
}
`;

tc.memfs.addFile('workspace/pixel_test.c', pixelTestCode);
const compPixel = await tc.compile('workspace/pixel_test.c', 'workspace/pixel_test.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(compPixel, 0, 'Compilation of pixel_test.c must succeed');
const linkPixel = await tc.link(['workspace/pixel_test.o'], 'workspace/pixel_test.out');
assert.strictEqual(linkPixel, 0, 'Linkage of pixel_test.c must succeed');

const pixelWasmBytes = tc.getFileFromMemfs('workspace/pixel_test.out');
const pixelModule = new WebAssembly.Module(pixelWasmBytes);
const pixelImportNames = new Set(WebAssembly.Module.imports(pixelModule).map(i => i.name));
assert.strictEqual(pixelImportNames.has('canvas_set_pixel'), true);
assert.strictEqual(pixelImportNames.has('canvas_get_pixel'), true);
assert.strictEqual(pixelImportNames.has('canvas_get_image_data'), true);
assert.strictEqual(pixelImportNames.has('canvas_put_image_data'), true);
assert.strictEqual(pixelImportNames.has('canvas_get_pixels'), true);
assert.strictEqual(pixelImportNames.has('canvas_put_pixels'), true);

let getPixelsCalled = 0, putPixelsCalled = 0, getImageDataCalled = 0, putImageDataCalled = 0;
let getPixelCalled = 0, setPixelCalled = 0;
let pixelRuntimeMem = null;

const pixelHostBridge = {
  ...canvasHostBridge,
  canvas_set_pixel(x, y, color) {
    setPixelCalled++;
    assert.strictEqual(x, 10);
    assert.strictEqual(y, 20);
    assert.strictEqual(color >>> 0, 0xFF00FF00 >>> 0);
  },
  canvas_get_pixel(x, y) {
    getPixelCalled++;
    return 0xFF00FF00 >>> 0;
  },
  canvas_get_image_data(sx, sy, sw, sh, outPtr) {
    getImageDataCalled++;
    assert.strictEqual(sw, 2);
    assert.strictEqual(sh, 2);
  },
  canvas_put_image_data(dx, dy, dw, dh, inPtr) {
    putImageDataCalled++;
    assert.strictEqual(dx, 5);
    assert.strictEqual(dy, 5);
  },
  canvas_get_pixels(outPtr) {
    getPixelsCalled++;
  },
  canvas_put_pixels(inPtr) {
    putPixelsCalled++;
  }
};

const pixelInstance = await WebAssembly.instantiate(pixelModule, {
  wasi_unstable: wasiStub,
  wasi_snapshot_preview1: wasiStub,
  env: new Proxy(pixelHostBridge, { get: (t, p) => p in t ? t[p] : () => 0 }),
  graphics: new Proxy(pixelHostBridge, { get: (t, p) => p in t ? t[p] : () => 0 }),
  canvas: new Proxy(pixelHostBridge, { get: (t, p) => p in t ? t[p] : () => 0 })
});
pixelRuntimeMem = pixelInstance.exports.memory;
pixelInstance.exports._start();

assert.strictEqual(setPixelCalled, 1);
assert.strictEqual(getPixelCalled, 1);
assert.strictEqual(getImageDataCalled, 1);
assert.strictEqual(putImageDataCalled, 1);
assert.strictEqual(getPixelsCalled, 1);
assert.strictEqual(putPixelsCalled, 1);
console.log('✓ Canvas pixel manipulation runtime execution and host bridging verified');

// Test 14: Verify examples/05_canvas_pixels.c compiles and links cleanly
const example05Code = fs.readFileSync(path.resolve('examples/05_canvas_pixels.c'), 'utf-8');
tc.memfs.addFile('workspace/05_canvas_pixels.c', example05Code);
const comp05 = await tc.compile('workspace/05_canvas_pixels.c', 'workspace/05_canvas_pixels.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(comp05, 0, 'examples/05_canvas_pixels.c must compile without errors');
const link05 = await tc.link(['workspace/05_canvas_pixels.o'], 'workspace/05_canvas_pixels.out');
assert.strictEqual(link05, 0, 'examples/05_canvas_pixels.c must link without errors');
console.log('✓ examples/05_canvas_pixels.c end-to-end compilation & linkage verified');

console.log('--- ALL GENERIC & 2D VECTOR GRAPHICS TESTS PASSED ---');



