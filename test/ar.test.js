// Unit tests for ar static library archiver and multicall tools via llvm-box.wasm
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot } from '../src/vfs/sysroot.js';
import { executeToolCommand } from '../src/toolchain/driver.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';

console.log('--- Running ar Archiver Unit Tests ---');

// Polyfill fetch for node environment
globalThis.fetch = async (url) => {
  let clean = url.replace(/^\//, '');
  if (clean.startsWith('sysroot/')) clean = 'public/' + clean;
  const buf = fs.readFileSync(path.resolve(clean));
  return {
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

const vfs = new VFS();
mountSysroot(vfs);

// Test 1: Verify sysroot mounts /usr/bin/ar
assert.strictEqual(vfs.exists('/usr/bin/ar'), true, '/usr/bin/ar must exist in sysroot');
console.log('✓ sysroot mounts /usr/bin/ar verified');

// Test 2: Build sample Wasm relocatable objects (.o)
const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
await tc.init();

vfs.writeFile('/workspace/add.c', 'int add(int a, int b) { return a + b; }\n');
let code = await tc.compile('workspace/add.c', 'workspace/add.o', 'c', []);
assert.strictEqual(code, 0);

vfs.writeFile('/workspace/sub.c', 'int sub(int a, int b) { return a - b; }\n');
code = await tc.compile('workspace/sub.c', 'workspace/sub.o', 'c', []);
assert.strictEqual(code, 0);

// Test 3: ar rcs libmath.a add.o sub.o creates archive with valid symbol table
let arOutput = '';
const wr = (msg) => { arOutput += msg; };

code = await executeToolCommand({
  cmd: 'ar',
  args: ['rcs', 'libmath.a', 'add.o', 'sub.o'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: wr,
});
assert.strictEqual(code, 0, 'ar rcs must succeed with code 0');
assert.strictEqual(vfs.exists('/workspace/libmath.a'), true, 'libmath.a must be created in VFS');

const archiveBytes = vfs.readFile('/workspace/libmath.a', false);
assert.strictEqual(new TextDecoder().decode(archiveBytes.subarray(0, 8)), '!<arch>\n', 'Magic header must match !<arch>\\n');
console.log('✓ ar rcs creates valid archive containing add.o and sub.o');

// Test 4: Table of contents (ar t libmath.a and ar tv libmath.a)
let tableOutput = '';
code = await executeToolCommand({
  cmd: 'ar',
  args: ['t', 'libmath.a'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { tableOutput += m; },
});
assert.strictEqual(tableOutput.trim().replace(/\r\n/g, '\n'), 'add.o\nsub.o');

let tableVerboseOutput = '';
code = await executeToolCommand({
  cmd: 'ar',
  args: ['tv', 'libmath.a'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { tableVerboseOutput += m; },
});
assert.strictEqual(code, 0);
assert.match(tableVerboseOutput, /add\.o/);
assert.match(tableVerboseOutput, /sub\.o/);
console.log('✓ ar t and ar tv list member table of contents');

// Test 5: Linking against generated libmath.a with wasm-ld (-Lworkspace -lmath)
vfs.writeFile(
  '/workspace/main.c',
  'int add(int, int); int sub(int, int); int main(void) { return add(10, 20) + sub(30, 5); }\n'
);
code = await tc.compile('workspace/main.c', 'workspace/main.o', 'c', []);
assert.strictEqual(code, 0);

// Link main.o with -Lworkspace -lmath
const linkCode = await tc.link(['workspace/main.o'], 'workspace/calc.out', ['-Lworkspace', '-lmath']);
assert.strictEqual(linkCode, 0, 'Linking with -lmath against generated libmath.a must succeed');
const calcBinary = vfs.readFile('/workspace/calc.out', false);
assert.notStrictEqual(calcBinary, null);
assert.strictEqual(calcBinary[0], 0x00);
assert.strictEqual(calcBinary[1], 0x61);
assert.strictEqual(calcBinary[2], 0x73);
assert.strictEqual(calcBinary[3], 0x6d);
console.log('✓ wasm-ld links against generated static archive using -Lworkspace -lmath');

// Test 6: Direct path linking against workspace/libmath.a
const directLinkCode = await tc.link(['workspace/main.o', 'workspace/libmath.a'], 'workspace/calc_direct.out', []);
assert.strictEqual(directLinkCode, 0, 'Direct path linking of workspace/libmath.a must succeed');
console.log('✓ wasm-ld links against generated static archive using direct path');

// Test 7: Member extraction (ar x libmath.a)
vfs.remove('/workspace/add.o');
vfs.remove('/workspace/sub.o');
assert.strictEqual(vfs.exists('/workspace/add.o'), false);
assert.strictEqual(vfs.exists('/workspace/sub.o'), false);

code = await executeToolCommand({
  cmd: 'ar',
  args: ['x', 'libmath.a'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: wr,
});
assert.strictEqual(code, 0);
assert.strictEqual(vfs.exists('/workspace/add.o'), true, 'add.o must be extracted');
assert.strictEqual(vfs.exists('/workspace/sub.o'), true, 'sub.o must be extracted');
console.log('✓ ar x extracts member files to working directory');

// Test 8: Member deletion (ar d libmath.a sub.o)
code = await executeToolCommand({
  cmd: 'ar',
  args: ['d', 'libmath.a', 'sub.o'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: wr,
});
assert.strictEqual(code, 0);
let tableAfterDel = '';
await executeToolCommand({
  cmd: 'ar',
  args: ['t', 'libmath.a'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { tableAfterDel += m; },
});
assert.strictEqual(tableAfterDel.trim().replace(/\r\n/g, '\n'), 'add.o');
console.log('✓ ar d deletes member from archive');

// Test 9: GNU long filenames (> 15 chars) in ar archives via llvm-box ar
const longName = 'very_long_component_name_123.o';
vfs.writeFile(`/workspace/${longName}`, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
code = await executeToolCommand({
  cmd: 'ar',
  args: ['rcs', 'long.a', longName],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: wr,
});
assert.strictEqual(code, 0);
let tableLong = '';
await executeToolCommand({
  cmd: 'ar',
  args: ['t', 'long.a'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { tableLong += m; },
});
assert.strictEqual(tableLong.trim().replace(/\r\n/g, '\n'), longName);
console.log('✓ GNU long filename table (//) round-trip verified');

// Test 10: nm symbol table inspector
let nmOutput = '';
code = await executeToolCommand({
  cmd: 'nm',
  args: ['libmath.a'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { nmOutput += m; },
});
assert.strictEqual(code, 0, 'nm libmath.a must succeed');
assert.match(nmOutput, /add/, 'nm output must contain add symbol');
console.log('✓ nm lists symbols from static archive and object files');

// Test 11: size object memory footprint dumper
let sizeOutput = '';
code = await executeToolCommand({
  cmd: 'size',
  args: ['add.o'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { sizeOutput += m; },
});
assert.strictEqual(code, 0, 'size add.o must succeed');
assert.match(sizeOutput, /text\s+data\s+bss/, 'size output must show Berkeley format headers');
console.log('✓ size displays section footprint for object files');

// Test 12: objdump disassembler and header viewer
let objdumpOutput = '';
code = await executeToolCommand({
  cmd: 'objdump',
  args: ['-h', 'add.o'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { objdumpOutput += m; },
});
assert.strictEqual(code, 0, 'objdump -h add.o must succeed');
assert.match(objdumpOutput, /Sections:/, 'objdump -h must display sections header');
console.log('✓ objdump displays section headers');

// Test 13: cxxfilt symbol demangler
let cxxfiltOutput = '';
code = await executeToolCommand({
  cmd: 'cxxfilt',
  args: ['_Z3addii'],
  cwd: '/workspace',
  vfs,
  toolchain: tc,
  write: (m) => { cxxfiltOutput += m; },
});
assert.strictEqual(code, 0, 'cxxfilt _Z3addii must succeed');
assert.match(cxxfiltOutput, /add\(int,\s*int\)/, 'cxxfilt must demangle _Z3addii to add(int, int)');
console.log('✓ cxxfilt demangles C++ symbols');

console.log('--- ALL AR & MULTICALL TOOL TESTS PASSED ---');
