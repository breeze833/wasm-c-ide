// test/turtle.test.js
// Unit and integration tests for Turtle Graphics Subsystem (libturtle)
// Tests: static distribution assets, VFS sysroot mounting, Raylib toggle lifecycle,
// build file generation, and end-to-end WasmToolchain compilation & linking for both backends.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot, mountRaylibSysroot, unmountRaylibSysroot, TURTLE_HEADERS } from '../src/vfs/sysroot.js';
import { SettingsModal } from '../src/components/settings.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';
import { executeGccCommand } from '../src/toolchain/driver.js';

console.log('--- Running Turtle Graphics Unit Tests ---');

// Test 1: Verify static distribution files exist
const libTurtlePath = 'public/sysroot/wasm/libturtle.a';
const libCanvasWasiPath = 'public/sysroot/wasm/libturtle_canvas-wasi.a';
const libRaylibTurtlePath = 'public/sysroot/wasm/libturtle_raylib.a';

assert.strictEqual(fs.existsSync(libTurtlePath), true, 'libturtle.a must exist');
assert.strictEqual(fs.existsSync(libCanvasWasiPath), true, 'libturtle_canvas-wasi.a must exist');
assert.strictEqual(fs.existsSync(libRaylibTurtlePath), true, 'libturtle_raylib.a must exist');

const libTurtleBytes = fs.readFileSync(libTurtlePath);
assert.strictEqual(libTurtleBytes.subarray(0, 8).toString(), '!<arch>\n', 'libturtle.a must be an ar archive');
const libRaylibTurtleBytes = fs.readFileSync(libRaylibTurtlePath);
assert.strictEqual(libRaylibTurtleBytes.subarray(0, 8).toString(), '!<arch>\n', 'libturtle_raylib.a must be an ar archive');

assert.strictEqual(fs.existsSync('public/sysroot/include/turtle/turtle.h'), true);
assert.strictEqual(fs.existsSync('public/sysroot/include/turtle/turtle_backend_canvas_wasi.h'), true);
assert.strictEqual(fs.existsSync('public/sysroot/include/turtle/turtle_backend_raylib.h'), true);
assert.strictEqual(fs.existsSync('public/sysroot/include/turtle/turtle_hal.h'), false, 'turtle_hal.h internal header must not be published');
console.log('✓ Precompiled libturtle static archives and headers verified');

// Test 2: VFS default sysroot mounting (canvas-wasi backend enabled by default)
const vfs = new VFS();
mountSysroot(vfs);

assert.strictEqual(vfs.exists('/usr/include/turtle.h'), true, '/usr/include/turtle.h must exist by default');
assert.strictEqual(vfs.exists('/usr/include/turtle_backend_canvas_wasi.h'), true);
assert.strictEqual(vfs.exists('/usr/include/turtle_hal.h'), false, 'turtle_hal.h internal header must not be mounted in /usr/include');
assert.strictEqual(vfs.exists('/usr/lib/libturtle.a'), true);
assert.strictEqual(vfs.exists('/usr/lib/libturtle_canvas-wasi.a'), true);

const turtleHContent = vfs.readFile('/usr/include/turtle.h');
assert.strictEqual(turtleHContent.includes('turtle_begin'), true);
assert.strictEqual(turtleHContent.includes('turtle_forward'), true);
assert.strictEqual(turtleHContent.includes('turtle_turn'), true);
assert.strictEqual(turtleHContent.includes('turtle_delay'), true);
assert.strictEqual(turtleHContent.includes('turtle_end'), true);
console.log('✓ VFS default sysroot mounting with canvas-wasi turtle backend verified');

// Test 3: Raylib turtle backend dynamic mount & unmount lifecycle
const dummyRaylibHeaders = {
  'raylib.h': '/* raylib.h */',
  'raymath.h': '/* raymath.h */',
  'rlgl.h': '/* rlgl.h */',
  'turtle_backend_raylib.h': '/* turtle_backend_raylib.h */',
};
const dummyRaylibLib = new Uint8Array([1, 2, 3, 4]);
const dummyTurtleRaylibLib = new Uint8Array([5, 6, 7, 8]);

mountRaylibSysroot(vfs, dummyRaylibHeaders, dummyRaylibLib, {}, dummyTurtleRaylibLib);
assert.strictEqual(vfs.exists('/usr/include/turtle_backend_raylib.h'), true);
assert.strictEqual(vfs.exists('/usr/lib/libturtle_raylib.a'), true);
assert.deepStrictEqual(vfs.readFile('/usr/lib/libturtle_raylib.a', false), dummyTurtleRaylibLib);

unmountRaylibSysroot(vfs);
assert.strictEqual(vfs.exists('/usr/include/turtle_backend_raylib.h'), false);
assert.strictEqual(vfs.exists('/usr/lib/libturtle_raylib.a'), false);
console.log('✓ Raylib turtle backend dynamic mount and unmount verified');

// Test 4: Project Settings auto-detects turtle library usage in build.sh & Makefile
const settingsVfs = new VFS();

// Rule (1): raylib is not enabled && turtle_backend_canvas_wasi.h is included ==> -lturtle
settingsVfs.writeFile('/workspace/main.c', '#include <turtle.h>\n#include <turtle_backend_canvas_wasi.h>\nint main(void) { return 0; }\n');
const settings = new SettingsModal(settingsVfs, {
  mode: 'c',
  buildSystem: 'sh',
  enableRaylib: false,
  targetName: 'turtle_app.out',
});
settings.regenerateBuildFiles();

assert.strictEqual(settingsVfs.exists('/workspace/build.sh'), true);
let buildSh = settingsVfs.readFile('/workspace/build.sh', true);
assert.strictEqual(buildSh.includes('-lturtle'), true, 'Rule (1): build.sh must link -lturtle');
let makefile = settingsVfs.readFile('/workspace/Makefile', true);
assert.strictEqual(makefile.includes('LDFLAGS = -lturtle'), true, 'Rule (1): Makefile must include LDFLAGS = -lturtle');

// Rule (2): raylib is enabled && turtle_backend_canvas_wasi.h is included ==> -lturtle
settings.config.enableRaylib = true;
settings.regenerateBuildFiles();
buildSh = settingsVfs.readFile('/workspace/build.sh', true);
assert.strictEqual(buildSh.includes('-lturtle'), true, 'Rule (2): build.sh must link -lturtle');
assert.strictEqual(buildSh.includes('-lraylib'), false, 'Rule (2): build.sh must NOT link -lraylib when canvas_wasi is used');
makefile = settingsVfs.readFile('/workspace/Makefile', true);
assert.strictEqual(makefile.includes('LDFLAGS = -lturtle'), true, 'Rule (2): Makefile must include LDFLAGS = -lturtle');

// Rule (3): raylib is enabled && turtle_backend_raylib.h is included ==> -lturtle_raylib -lraylib
settingsVfs.writeFile('/workspace/main.c', '#include <turtle.h>\n#include <turtle_backend_raylib.h>\nint main(void) { return 0; }\n');
settings.config.enableRaylib = true;
settings.regenerateBuildFiles();

const raylibBuildSh = settingsVfs.readFile('/workspace/build.sh', true);
assert.strictEqual(raylibBuildSh.includes('-lturtle_raylib -lraylib'), true, 'Rule (3): build.sh must link -lturtle_raylib -lraylib');
const raylibMakefile = settingsVfs.readFile('/workspace/Makefile', true);
assert.strictEqual(raylibMakefile.includes('LDFLAGS = -lturtle_raylib -lraylib'), true, 'Rule (3): Makefile must include LDFLAGS = -lturtle_raylib -lraylib');
console.log('✓ Settings build.sh & Makefile generation with rules (1), (2), (3) verified');

// Test 5: End-to-end WasmToolchain compilation & linking for canvas-wasi turtle backend
globalThis.fetch = async (url) => {
  const filePath = url.replace(/^\/?sysroot\//, 'public/sysroot/');
  const resolved = path.resolve(filePath);
  const data = fs.readFileSync(resolved);
  return {
    ok: true,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    text: async () => data.toString('utf-8')
  };
};

const compileVfs = new VFS();
mountSysroot(compileVfs);
compileVfs.writeFile('/usr/lib/libturtle.a', fs.readFileSync('public/sysroot/wasm/libturtle.a'), Date.now(), true);
compileVfs.writeFile('/usr/lib/libturtle_canvas-wasi.a', fs.readFileSync('public/sysroot/wasm/libturtle_canvas-wasi.a'), Date.now(), true);

const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs: compileVfs });
await tc.init();

const canvasCode = fs.readFileSync('examples/06_turtle_canvas.c', 'utf-8');
compileVfs.writeFile('/workspace/turtle_canvas.c', canvasCode);

let compCode = await tc.compile('workspace/turtle_canvas.c', 'workspace/turtle_canvas.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(compCode, 0, 'Compilation of 06_turtle_canvas.c must succeed');

let linkCode = await tc.link(['workspace/turtle_canvas.o'], 'workspace/turtle_canvas.wasm', ['-lturtle']);
assert.strictEqual(linkCode, 0, 'Linking 06_turtle_canvas.o with -lturtle must succeed');

const canvasWasmBytes = compileVfs.readFile('/workspace/turtle_canvas.wasm', false);
assert.notStrictEqual(canvasWasmBytes, null);
assert.strictEqual(canvasWasmBytes[0], 0x00);
assert.strictEqual(canvasWasmBytes[1], 0x61);
assert.strictEqual(canvasWasmBytes[2], 0x73);
assert.strictEqual(canvasWasmBytes[3], 0x6d);

const canvasModule = new WebAssembly.Module(canvasWasmBytes);
const canvasImports = WebAssembly.Module.imports(canvasModule);
const canvasImportNames = new Set(canvasImports.map(i => i.name));

assert.strictEqual(canvasImportNames.has('graphics_init'), true, 'Must import graphics_init');
assert.strictEqual(canvasImportNames.has('canvas_present'), true, 'Must import canvas_present');
assert.strictEqual(canvasImportNames.has('canvas_stroke'), true, 'Must import canvas_stroke');
assert.strictEqual(canvasImportNames.has('graphics_wait_frame'), true, 'Must import graphics_wait_frame');
assert.strictEqual(canvasImportNames.has('graphics_close'), true, 'Must import graphics_close');
console.log('✓ End-to-end WasmToolchain compilation & linking with -lturtle (canvas-wasi) verified');

// Test 6: End-to-end WasmToolchain compilation & linking for Raylib turtle backend
compileVfs.writeFile('/usr/include/raylib.h', fs.readFileSync('public/sysroot/include/raylib/raylib.h'), Date.now(), true);
compileVfs.writeFile('/usr/include/raymath.h', fs.readFileSync('public/sysroot/include/raylib/raymath.h'), Date.now(), true);
compileVfs.writeFile('/usr/include/rlgl.h', fs.readFileSync('public/sysroot/include/raylib/rlgl.h'), Date.now(), true);
compileVfs.writeFile('/usr/include/turtle_backend_raylib.h', fs.readFileSync('public/sysroot/include/turtle/turtle_backend_raylib.h'), Date.now(), true);
compileVfs.writeFile('/usr/lib/libraylib.a', fs.readFileSync('public/sysroot/wasm/libraylib.a'), Date.now(), true);
compileVfs.writeFile('/usr/lib/libturtle_raylib.a', fs.readFileSync('public/sysroot/wasm/libturtle_raylib.a'), Date.now(), true);

const raylibCode = fs.readFileSync('examples/07_turtle_raylib.c', 'utf-8');
compileVfs.writeFile('/workspace/turtle_raylib.c', raylibCode);

compCode = await tc.compile('workspace/turtle_raylib.c', 'workspace/turtle_raylib.o', 'c', ['-I/include', '-I/workspace']);
assert.strictEqual(compCode, 0, 'Compilation of 07_turtle_raylib.c must succeed');

linkCode = await tc.link(['workspace/turtle_raylib.o'], 'workspace/turtle_raylib.wasm', ['-lturtle_raylib', '-lraylib']);
assert.strictEqual(linkCode, 0, 'Linking 07_turtle_raylib.o with -lturtle_raylib -lraylib must succeed');

const raylibWasmBytes = compileVfs.readFile('/workspace/turtle_raylib.wasm', false);
assert.notStrictEqual(raylibWasmBytes, null);
assert.strictEqual(raylibWasmBytes[0], 0x00);
assert.strictEqual(raylibWasmBytes[1], 0x61);
assert.strictEqual(raylibWasmBytes[2], 0x73);
assert.strictEqual(raylibWasmBytes[3], 0x6d);

const raylibModule = new WebAssembly.Module(raylibWasmBytes);
const raylibImports = WebAssembly.Module.imports(raylibModule);
const raylibImportModules = new Set(raylibImports.map(i => i.module));

assert.strictEqual(raylibImportModules.has('gl'), true, 'Must import gl namespace');
assert.strictEqual(raylibImportModules.has('raylib'), true, 'Must import raylib namespace');
console.log('✓ End-to-end WasmToolchain compilation & linking with -lturtle_raylib -lraylib verified');

// Test 7: Unmounting Raylib purges turtle_backend_raylib.h and libturtle_raylib.a from VFS
unmountRaylibSysroot(compileVfs, tc);
assert.strictEqual(compileVfs.exists('/usr/include/turtle_backend_raylib.h'), false);
assert.strictEqual(compileVfs.exists('/usr/lib/libturtle_raylib.a'), false);

const failRaylibComp = await tc.compile('workspace/turtle_raylib.c', 'workspace/fail.o', 'c', ['-I/include', '-I/workspace']);
assert.notStrictEqual(failRaylibComp, 0, 'Compilation must fail after unmounting Raylib turtle backend');
console.log('✓ Unmounting Raylib purges turtle raylib assets and blocks compilation verified');

console.log('--- ALL TURTLE GRAPHICS TESTS PASSED ---');
