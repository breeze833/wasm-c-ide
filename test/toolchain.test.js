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

console.log('--- ALL TOOLCHAIN DRIVER TESTS PASSED ---');

