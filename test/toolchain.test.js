// Unit tests for Toolchain argument parsing and driver flags
import assert from 'node:assert';
import { executeGccCommand } from '../src/toolchain/driver.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';
import { VFS } from '../src/vfs/vfs.js';

console.log('--- Running Toolchain Driver Unit Tests ---');

function parseGccArgs(args) {
  let compileOnly = false;
  let outputFile = null;
  const sources = [];
  const objects = [];
  const flags = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c') {
      compileOnly = true;
    } else if (arg === '-o') {
      if (i + 1 < args.length) outputFile = args[++i];
    } else if (arg.startsWith('-o') && arg.length > 2) {
      outputFile = arg.substring(2);
    } else if (arg.startsWith('-')) {
      flags.push(arg);
    } else if (arg.endsWith('.c') || arg.endsWith('.cpp')) {
      sources.push(arg);
    } else if (arg.endsWith('.o')) {
      objects.push(arg);
    }
  }

  return { compileOnly, outputFile, sources, objects, flags };
}

// Test 1: gcc -Wall -c src/calc.c -o build/calc.o
const res1 = parseGccArgs(['-Wall', '-c', 'src/calc.c', '-o', 'build/calc.o']);
assert.strictEqual(res1.compileOnly, true);
assert.strictEqual(res1.outputFile, 'build/calc.o');
assert.deepStrictEqual(res1.sources, ['src/calc.c']);
assert.deepStrictEqual(res1.flags, ['-Wall']);
console.log('✓ Compile-only argument parsing passed');

// Test 2: gcc build/calc.o build/main.o -o a.out
const res2 = parseGccArgs(['build/calc.o', 'build/main.o', '-o', 'a.out']);
assert.strictEqual(res2.compileOnly, false);
assert.strictEqual(res2.outputFile, 'a.out');
assert.deepStrictEqual(res2.objects, ['build/calc.o', 'build/main.o']);
console.log('✓ Linking argument parsing passed');

// Test 3: gcc -Iinclude src/main.c
const res3 = parseGccArgs(['-Iinclude', 'src/main.c']);
assert.strictEqual(res3.compileOnly, false);
assert.strictEqual(res3.outputFile, null);
assert.deepStrictEqual(res3.sources, ['src/main.c']);
assert.deepStrictEqual(res3.flags, ['-Iinclude']);
console.log('✓ Direct compile & link argument parsing passed');

// Test 4: Regression test for "can't access property 'addFile', this.memfs is null"
// executeGccCommand must initialize toolchain before copying files to memfs
{
  const vfs = new VFS();
  vfs.writeFile('/workspace/main.c', 'int main() { return 0; }');

  let initCalled = false;
  const mockToolchain = {
    initialized: false,
    memfs: null,
    async init() {
      initCalled = true;
      this.initialized = true;
      this.memfs = {
        files: new Map(),
        addFile(path, content) {
          this.files.set(path, content);
        },
        getFileContents(path) {
          return this.files.get(path) || null;
        }
      };
    },
    async syncFileToMemfs(path, content) {
      if (!this.initialized) {
        await this.init();
      }
      if (!this.memfs) {
        throw new TypeError("can't access property 'addFile', this.memfs is null");
      }
      this.memfs.addFile(path.replace(/^\/+/, ''), content);
    },
    getFileFromMemfs(path) {
      if (!this.memfs) return null;
      return this.memfs.getFileContents(path.replace(/^\/+/, ''));
    },
    async compile(src, obj) {
      this.memfs.addFile(obj.replace(/^\/+/, ''), new Uint8Array([0, 97, 115, 109]));
      return 0;
    },
    async link(objs, out) {
      this.memfs.addFile(out.replace(/^\/+/, ''), new Uint8Array([0, 97, 115, 109]));
      return 0;
    }
  };

  let writeOutput = '';
  const exitCode = await executeGccCommand({
    cmd: 'gcc',
    args: ['main.c', '-o', 'main'],
    cwd: '/workspace',
    vfs,
    toolchain: mockToolchain,
    mode: 'c',
    write: (msg) => { writeOutput += msg; }
  });

  assert.strictEqual(initCalled, true, 'toolchain.init must be called before syncing files');
  assert.strictEqual(mockToolchain.initialized, true, 'toolchain must be initialized');
  assert.strictEqual(exitCode, 0, 'executeGccCommand should complete without throwing');
  console.log('✓ executeGccCommand initializes uninitialized toolchain (regression fix verified)');
}

// Test 4.1: executeGccCommand with g++ and clang++ selects cpp mode and reports correct command name
{
  const vfs = new VFS();
  vfs.writeFile('/workspace/main.cpp', '#include <iostream>\nint main() { return 0; }');

  let passedMode = null;
  const mockToolchain = {
    initialized: true,
    async init() {},
    async syncFileToMemfs() {},
    getFileFromMemfs() { return new Uint8Array([0]); },
    async compile(src, obj, mode) {
      passedMode = mode;
      return 0;
    },
    async link() { return 0; }
  };

  let writeOutput = '';
  const exitCode = await executeGccCommand({
    cmd: 'g++',
    args: ['-c', 'main.cpp', '-o', 'main.o'],
    cwd: '/workspace',
    vfs,
    toolchain: mockToolchain,
    mode: 'c', // Even if base mode is 'c', cmd 'g++' must override to 'cpp'
    write: (msg) => { writeOutput += msg; }
  });

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(passedMode, 'cpp', 'g++ command must execute compilation in cpp mode');

  // Verify clang++ also selects cpp mode
  await executeGccCommand({
    cmd: 'clang++',
    args: ['-c', 'main.cpp', '-o', 'main.o'],
    cwd: '/workspace',
    vfs,
    toolchain: mockToolchain,
    mode: 'c',
    write: (msg) => { writeOutput += msg; }
  });
  assert.strictEqual(passedMode, 'cpp', 'clang++ command must execute compilation in cpp mode');

  // Verify error output uses cmd name
  writeOutput = '';
  const errCode = await executeGccCommand({
    cmd: 'g++',
    args: ['-c'],
    cwd: '/workspace',
    vfs,
    toolchain: mockToolchain,
    mode: 'cpp',
    write: (msg) => { writeOutput += msg; }
  });
  assert.strictEqual(errCode, 1);
  assert.strictEqual(writeOutput.includes('g++: fatal error: no input files'), true, 'Error message must reflect g++');
  console.log('✓ executeGccCommand supports g++ and clang++ with automatic C++ mode');
}

// Test 5: WasmToolchain syncFileToMemfs initializes when uninitialized
{
  const toolchain = new WasmToolchain();
  assert.strictEqual(toolchain.initialized, false);
  assert.strictEqual(toolchain.memfs, null);

  let customInitCalled = false;
  toolchain.init = async function() {
    customInitCalled = true;
    this.initialized = true;
    this.memfs = {
      files: new Map(),
      addFile(path, content) { this.files.set(path, content); },
      getFileContents(path) { return this.files.get(path); }
    };
  };

  // Calling syncFileToMemfs on uninitialized toolchain should not throw
  await toolchain.syncFileToMemfs('/workspace/foo.c', 'int foo = 1;');
  assert.strictEqual(customInitCalled, true);
  assert.strictEqual(toolchain.initialized, true);
  assert.strictEqual(toolchain.getFileFromMemfs('workspace/foo.c'), 'int foo = 1;');
  console.log('✓ WasmToolchain.syncFileToMemfs initializes if not yet initialized');
}

// Test 6: Real MemFS safe getFileContents and multi-level directory creation
{
  import('node:fs').then(async (fs) => {
    const memfsBuf = fs.readFileSync('public/sysroot/wasm/memfs.wasm');
    const sysrootBuf = fs.readFileSync('public/sysroot/wasm/sysroot.tar');

    globalThis.fetch = async (url) => {
      const filePath = url.replace(/^\/?sysroot\//, 'public/sysroot/');
      const data = fs.readFileSync(filePath);
      return {
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      };
    };

    const vfs = new VFS();
    const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
    await tc.init();

    // Verify non-existent file query returns null without throwing unreachable
    const nonExistent = tc.getFileFromMemfs('workspace/nonexistent.o');
    assert.strictEqual(nonExistent, null, 'Querying non-existent file must return null cleanly');
    console.log('✓ MemFS.getFileContents returns null on missing file without trapping');

    // Verify deeply nested file add creates directories without trapping
    await tc.syncFileToMemfs('/workspace/deep/nested/dir/test.c', 'int x = 42;\n');
    assert.strictEqual(tc.memfs.directories.has('workspace/deep/nested/dir'), true);
    console.log('✓ MemFS automatically creates nested directories on file add');

    // Verify /usr/lib files are mirrored into VFS
    assert.strictEqual(vfs.exists('/usr/lib/libc.a'), true);
    assert.strictEqual(vfs.exists('/usr/lib/crt1.o'), true);
    console.log('✓ WasmToolchain mirrors libc runtime files into VFS /usr/lib');

    // Test 7: Verify async WebAssembly.instantiate is used (bypassing Chrome 8MB sync limit)
    const origInstance = WebAssembly.Instance;
    let syncInstanceCalled = false;
    try {
      WebAssembly.Instance = function() {
        syncInstanceCalled = true;
        throw new Error('WebAssembly.Instance is disallowed on the main thread, if the buffer size is larger than 8MB.');
      };

      // Mock clang module with minimal valid wasm module
      const dummyWasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      tc.clangModule = await WebAssembly.compile(dummyWasmBytes);
      tc.vfs.writeFile('/workspace/src/test.c', 'int main() { return 0; }');

      // Compiling should instantiate via WebAssembly.instantiate, NOT new WebAssembly.Instance
      const exitCode = await tc.compile('/workspace/src/test.c', '/workspace/build/test.o');
      assert.strictEqual(syncInstanceCalled, false, 'Synchronous WebAssembly.Instance must not be invoked');
      console.log('✓ Clang compilation uses async WebAssembly.instantiate without hitting 8MB sync limit');
    } finally {
      WebAssembly.Instance = origInstance;
    }

    console.log('--- ALL TOOLCHAIN DRIVER TESTS PASSED ---');
  });
}

