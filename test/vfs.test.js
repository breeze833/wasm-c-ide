// Unit tests for VFS and Zip archive
import { VFS, normalizePath } from '../src/vfs/vfs.js';
import { STANDARD_C_HEADERS, mountSysroot } from '../src/vfs/sysroot.js';
import JSZip from 'jszip';
import assert from 'node:assert';

console.log('--- Running VFS Unit Tests ---');

// Test 1: normalizePath
assert.strictEqual(normalizePath('/workspace/src/../include/calc.h'), '/workspace/include/calc.h');
assert.strictEqual(normalizePath('///workspace//src//main.c'), '/workspace/src/main.c');
assert.strictEqual(normalizePath('/'), '/');
console.log('✓ normalizePath passed');

// Test 2: VFS basic operations
const vfs = new VFS();
assert.strictEqual(vfs.exists('/workspace'), true);
assert.strictEqual(vfs.exists('/usr/include'), true);
assert.strictEqual(vfs.exists('/usr/lib'), true);
assert.strictEqual(vfs.exists('/usr/bin'), true);
assert.strictEqual(vfs.exists('/bin'), true);

vfs.mkdir('/workspace/src');
vfs.writeFile('/workspace/src/hello.c', '#include <stdio.h>\nint main() { return 0; }');

assert.strictEqual(vfs.exists('/workspace/src/hello.c'), true);
assert.strictEqual(vfs.readFile('/workspace/src/hello.c').includes('hello.c'), false);
assert.strictEqual(vfs.readFile('/workspace/src/hello.c').includes('main'), true);

const stat = vfs.stat('/workspace/src/hello.c');
assert.strictEqual(stat.isDir, false);
assert.strictEqual(stat.size > 0, true);

const dirList = vfs.readDir('/workspace/src');
assert.strictEqual(dirList.length, 1);
assert.strictEqual(dirList[0].name, 'hello.c');
console.log('✓ VFS basic operations passed');

// Test 3: Read-only protection on /usr and /bin, and sysroot mounting
mountSysroot(vfs);
assert.strictEqual(vfs.exists('/usr/include/stdio.h'), true);
assert.strictEqual(vfs.exists('/usr/lib/libc.a'), true);
assert.strictEqual(vfs.exists('/usr/lib/crt1.o'), true);
assert.strictEqual(vfs.exists('/bin/ls'), true);
assert.strictEqual(vfs.exists('/bin/sh'), true);
assert.strictEqual(vfs.exists('/usr/bin/gcc'), true);
assert.strictEqual(vfs.exists('/usr/bin/make'), true);

assert.throws(() => {
  vfs.writeFile('/usr/include/test.h', 'fail');
}, /Permission denied/);

assert.throws(() => {
  vfs.writeFile('/usr/lib/fail.a', 'fail');
}, /Permission denied/);

assert.throws(() => {
  vfs.writeFile('/bin/hack', 'fail');
}, /Permission denied/);

assert.throws(() => {
  vfs.remove('/usr/include/stdio.h');
}, /Permission denied/);
console.log('✓ VFS read-only protection on /usr and /bin passed');

// Test 4: Rename and Remove
vfs.rename('/workspace/src/hello.c', '/workspace/src/main.c');
assert.strictEqual(vfs.exists('/workspace/src/hello.c'), false);
assert.strictEqual(vfs.exists('/workspace/src/main.c'), true);

// Test 4b: Rename file into directory targets (e.g. mv a.out src and mv a.out src/)
vfs.writeFile('/workspace/a.out', 'binary-data-1');
vfs.rename('/workspace/a.out', '/workspace/src');
assert.strictEqual(vfs.exists('/workspace/a.out'), false);
assert.strictEqual(vfs.exists('/workspace/src/a.out'), true);
assert.strictEqual(vfs.readFile('/workspace/src/a.out', true), 'binary-data-1');

// Test 4c: Rename with trailing slash and overwrite existing destination
vfs.writeFile('/workspace/a.out', 'binary-data-2');
vfs.rename('/workspace/a.out', '/workspace/src/');
assert.strictEqual(vfs.exists('/workspace/a.out'), false);
assert.strictEqual(vfs.readFile('/workspace/src/a.out', true), 'binary-data-2');

vfs.remove('/workspace/src/main.c');
vfs.remove('/workspace/src/a.out');
assert.strictEqual(vfs.exists('/workspace/src/main.c'), false);
console.log('✓ VFS rename and remove passed');

// Test 5: JSZip Roundtrip simulation
const vfs1 = new VFS();
vfs1.mkdir('/workspace/src');
vfs1.mkdir('/workspace/include');
vfs1.writeFile('/workspace/src/a.c', 'int a = 1;');
vfs1.writeFile('/workspace/include/a.h', 'extern int a;');

const zip = new JSZip();
const files = vfs1.getAllFiles('/workspace');
for (const file of files) {
  const relPath = file.path.replace(/^\/workspace\/?/, '');
  if (file.isDir) zip.folder(relPath);
  else zip.file(relPath, file.content);
}

const buffer = await zip.generateAsync({ type: 'uint8array' });
const loadedZip = await JSZip.loadAsync(buffer);

const vfs2 = new VFS();
for (const entryName of Object.keys(loadedZip.files)) {
  const entry = loadedZip.files[entryName];
  const cleanPath = `/workspace/${entryName.replace(/^(\/|\\)+/, '')}`.replace(/\/+$/, '');
  if (entry.dir) {
    vfs2.mkdir(cleanPath, true);
  } else {
    const parts = cleanPath.split('/');
    parts.pop();
    vfs2.mkdir(parts.join('/'), true);
    vfs2.writeFile(cleanPath, await entry.async('uint8array'));
  }
}

assert.strictEqual(vfs2.exists('/workspace/src/a.c'), true);
assert.strictEqual(vfs2.exists('/workspace/include/a.h'), true);
assert.strictEqual(vfs2.readFile('/workspace/src/a.c'), 'int a = 1;');
assert.strictEqual(vfs2.readFile('/workspace/include/a.h'), 'extern int a;');
console.log('✓ Zip round-trip passed');

console.log('--- ALL VFS TESTS PASSED ---');
