import assert from 'node:assert';
import {
  buildSharedSysroot,
  SharedSysrootReader,
  SSYS_MAGIC,
  SSYS_VERSION,
  fnv1a
} from '../src/vfs/shared-sysroot.js';

console.log('--- Running SharedSysroot Unit Tests ---');

// 1. Hash function verification
const hash1 = fnv1a('/usr/include/stdio.h');
const hash2 = fnv1a('/usr/include/stdio.h');
const hash3 = fnv1a('/usr/include/stdlib.h');
assert.strictEqual(hash1, hash2, 'Hash should be deterministic');
assert.notStrictEqual(hash1, hash3, 'Different paths should yield different hashes');
console.log('✓ fnv1a hash deterministic check passed');

// 2. Build and Read SharedSysroot
const mockEntries = [
  { path: '/usr/include/stdio.h', content: '#pragma once\nint printf(const char*, ...);' },
  { path: '/usr/include/math.h', content: '#pragma once\ndouble sin(double);' },
  { path: '/include/wasm32-wasip1/__struct_timespec.h', content: 'struct timespec { long tv_sec; };' },
  { path: '/usr/lib/libc.a', content: new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a]) }, // !<arch>\n
];

const buffer = buildSharedSysroot(mockEntries);
assert.ok(buffer instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer), 'Buffer is ArrayBuffer or SharedArrayBuffer');

const reader = new SharedSysrootReader(buffer);
assert.strictEqual(reader.version, SSYS_VERSION, 'Version matches');
assert.ok(reader.count >= 4, 'Entry count includes parent directories');
console.log('✓ Header and index parsing passed');

// 3. Existence & isDir checks
assert.strictEqual(reader.exists('/usr/include/stdio.h'), true, 'stdio.h exists');
assert.strictEqual(reader.exists('/usr/include/./stdio.h'), true, 'normalized stdio.h exists');
assert.strictEqual(reader.exists('/usr/include'), true, 'Parent dir exists');
assert.strictEqual(reader.exists('/nonexistent.h'), false, 'Non-existent file returns false');

assert.strictEqual(reader.isDir('/usr/include'), true, '/usr/include is dir');
assert.strictEqual(reader.isDir('/usr/include/stdio.h'), false, 'stdio.h is not dir');
console.log('✓ exists() and isDir() passed');

// 4. File reading (text & binary) & zero-copy verification
const stdioContent = reader.readFile('/usr/include/stdio.h', true);
assert.ok(stdioContent.includes('int printf'), 'stdio.h text decoded accurately');

const libcU8 = reader.readFile('/usr/lib/libc.a', false);
assert.ok(libcU8 instanceof Uint8Array, 'Returns Uint8Array');
assert.strictEqual(libcU8.byteLength, 8, 'libc.a length matches');
assert.strictEqual(libcU8[0], 0x21, 'Magic byte matches');

// Zero-copy check: Uint8Array buffer must strictly equal the reader's underlying buffer
assert.strictEqual(libcU8.buffer, buffer, 'Zero-copy: view shares the underlying buffer');
console.log('✓ readFile() and zero-copy view passed');

// 5. Stat checks
const st = reader.stat('/include/wasm32-wasip1/__struct_timespec.h');
assert.ok(st !== null, 'stat returned');
assert.strictEqual(st.name, '__struct_timespec.h');
assert.strictEqual(st.isDir, false);
assert.ok(st.size > 0, 'size > 0');
console.log('✓ stat() passed');

// 6. Directory listing
const includeChildren = reader.readDir('/usr/include');
assert.ok(includeChildren.length >= 2, 'readDir includes stdio.h and math.h');
const names = includeChildren.map(c => c.name);
assert.ok(names.includes('stdio.h'), 'includes stdio.h');
assert.ok(names.includes('math.h'), 'includes math.h');
console.log('✓ readDir() passed');

// 7. Invalid magic check
const badBuffer = new ArrayBuffer(64);
assert.throws(() => new SharedSysrootReader(badBuffer), /Invalid magic/, 'Throws on invalid magic');
console.log('✓ Invalid magic error throwing passed');

// 8. WasiHost integration & EROFS permission enforcement
import { WasiHost, EROFS } from '../src/vfs/wasi-host.js';
import { VFS } from '../src/vfs/vfs.js';

const testVfs = new VFS();
testVfs.setSharedSysroot(buffer);

const wasiHost = new WasiHost({
  vfs: testVfs,
  cwd: '/workspace',
  preopens: [
    { fd: 3, path: '/workspace', name: '.' },
    { fd: 4, path: '/', name: '/' },
  ],
});

const imports = wasiHost.getImports();
// Mock memory for WasiHost
const testMem = new WebAssembly.Memory({ initial: 1 });
wasiHost.setMemory(testMem);

function writeStringToMem(str, offset) {
  const bytes = new TextEncoder().encode(str);
  new Uint8Array(testMem.buffer).set(bytes, offset);
  return bytes.length;
}

// Write path to memory: "/usr/include/math.h"
const pathOffset = 1024;
const pathLen = writeStringToMem('/usr/include/math.h', pathOffset);
const openedFdPtr = 2048;

// Attempt 1: Read-only open on /usr/include/math.h should succeed
const resRead = imports.path_open(4, 0, pathOffset, pathLen, 0, 1n << 1n /* RIGHTS_FD_READ */, 0n, 0, openedFdPtr);
assert.strictEqual(resRead, 0, 'Read-only open on sysroot succeeds (ESUCCESS = 0)');
const openFd = new DataView(testMem.buffer).getUint32(openedFdPtr, true);
assert.ok(openFd > 2, 'Valid fd allocated');
imports.fd_close(openFd);

// Attempt 2: Write open (O_CREAT | O_TRUNC) on sysroot should be rejected with EROFS (65)
const WASI_O_CREAT = 1;
const WASI_O_TRUNC = 8;
const resWrite = imports.path_open(4, 0, pathOffset, pathLen, WASI_O_CREAT | WASI_O_TRUNC, 1n << 6n /* RIGHTS_FD_WRITE */, 0n, 0, openedFdPtr);
assert.strictEqual(resWrite, EROFS, `Writing to sysroot returns EROFS (${EROFS})`);

// Attempt 3: path_unlink_file on sysroot should return EROFS
const resUnlink = imports.path_unlink_file(4, pathOffset, pathLen);
assert.strictEqual(resUnlink, EROFS, `Unlinking sysroot file returns EROFS (${EROFS})`);

// Attempt 4: path_create_directory in sysroot should return EROFS
const dirOffset = 3072;
const dirLen = writeStringToMem('/usr/include/newdir', dirOffset);
const resMkdir = imports.path_create_directory(4, dirOffset, dirLen);
assert.strictEqual(resMkdir, EROFS, `Creating directory in sysroot returns EROFS (${EROFS})`);

console.log('✓ WasiHost EROFS permission enforcement passed');

// 9. Runtime worker runWasm with SharedSysroot
import { runWasm } from '../src/workers/runtime.worker.js';

const minWasmBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x08, 0x01, 0x04, 0x6d, 0x61, 0x69, 0x6e, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x00, 0x0b
]);

const initialFiles = {
  '/workspace/test.txt': new TextEncoder().encode('hello from workspace')
};

const runRes = await runWasm(
  minWasmBytes,
  ['./a.out'],
  { USER: 'student' },
  null,
  null,
  initialFiles,
  buffer
);

assert.ok(runRes !== null);
console.log('✓ runWasm with SharedSysroot executes cleanly');

// 10. Verify browser TextDecoder SharedArrayBuffer guard
{
  const origTextDecoder = globalThis.TextDecoder;
  try {
    globalThis.TextDecoder = class MockBrowserTextDecoder {
      decode(view) {
        if (typeof SharedArrayBuffer !== 'undefined' && view && view.buffer instanceof SharedArrayBuffer) {
          throw new TypeError("Failed to execute 'decode' on 'TextDecoder': The provided ArrayBufferView value must not be shared.");
        }
        return new origTextDecoder().decode(view);
      }
    };

    // Reader initialization with strict browser TextDecoder should parse index cleanly without throwing
    const strictReader = new SharedSysrootReader(buffer);
    assert.strictEqual(strictReader.exists('/usr/include/stdio.h'), true);

    // Reading file as text should also succeed cleanly without throwing
    const text = strictReader.readFile('/usr/include/stdio.h', true);
    assert.ok(text.includes('int printf'));
    console.log('✓ Browser TextDecoder SharedArrayBuffer restriction guard verified');
  } finally {
    globalThis.TextDecoder = origTextDecoder;
  }
}

console.log('--- ALL SHARED SYSROOT TESTS PASSED ---');
