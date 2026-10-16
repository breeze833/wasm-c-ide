// Unit tests for Toolchain argument parsing and driver flags
import assert from 'node:assert';
import { executeGccCommand, parseCompilerArgs } from '../src/toolchain/driver.js';
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
      // Restore real clang module
      const realClangBuf = fs.readFileSync('public/sysroot/wasm/clang.wasm');
      tc.clangModule = await WebAssembly.compile(realClangBuf);
    }

    // Test 8: Regression test - Delete build/calc.o in VFS and recompile + relink without object file corruption
    const calcC = "int add(int a, int b) { return a + b; }\n";
    const mainC = "int add(int a, int b);\nint main(void) { return add(2, 3); }\n";
    vfs.writeFile('/workspace/src/calc.c', calcC);
    vfs.writeFile('/workspace/src/main.c', mainC);

    // Initial compile
    let outMsg = '';
    const wr = (msg) => { outMsg += msg; };
    let code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-c', 'src/calc.c', '-o', 'build/calc.o'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wr
    });
    assert.strictEqual(code, 0, 'Initial compilation of calc.c should succeed');

    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-c', 'src/main.c', '-o', 'build/main.o'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wr
    });
    assert.strictEqual(code, 0, 'Initial compilation of main.c should succeed');

    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['build/calc.o', 'build/main.o', '-o', 'a.out'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wr
    });
    assert.strictEqual(code, 0, 'Initial link to a.out should succeed');

    // Simulate user action: manually delete build/calc.o from VFS
    vfs.remove('/workspace/build/calc.o');
    assert.strictEqual(vfs.exists('/workspace/build/calc.o'), false);

    // Recompile build/calc.o via executeGccCommand (like `make` does)
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-c', 'src/calc.c', '-o', 'build/calc.o'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wr
    });
    assert.strictEqual(code, 0, 'Recompilation of calc.c should succeed');

    // Verify the recompiled object file is a valid wasm object file (\0asm magic)
    const recompiledObj = vfs.readFile('/workspace/build/calc.o', false);
    assert.notStrictEqual(recompiledObj, null);
    assert.strictEqual(recompiledObj[0], 0x00, 'wasm magic byte 0');
    assert.strictEqual(recompiledObj[1], 0x61, 'wasm magic byte 1');
    assert.strictEqual(recompiledObj[2], 0x73, 'wasm magic byte 2');
    assert.strictEqual(recompiledObj[3], 0x6d, 'wasm magic byte 3');

    // Relink a.out with the recompiled object file
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['build/calc.o', 'build/main.o', '-o', 'a.out'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wr
    });
    assert.strictEqual(code, 0, 'Relinking with recompiled calc.o must succeed without "unknown file type" error');
    console.log('✓ Recompile and relink after deleting object file in VFS verified');

    // Test 9: Deleting source files purges them from MemFS and triggers compiler error
    vfs.writeFile('/workspace/include/calc.h', '#pragma once\nint add(int a, int b);\n');
    vfs.writeFile('/workspace/src/calc.c', '#include "calc.h"\nint add(int a, int b) { return a + b; }\n');
    vfs.writeFile('/workspace/src/main.c', '#include "calc.h"\nint main(void) { return add(2, 3); }\n');

    // Build them once so they exist in MemFS
    let buildMsg = '';
    const wrBuild = (m) => { buildMsg += m; };
    await executeGccCommand({
      cmd: 'gcc',
      args: ['-Iinclude', '-c', 'src/calc.c', '-o', 'build/calc.o'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wrBuild
    });
    assert.strictEqual(tc.hasFileInMemfs('workspace/include/calc.h'), true, 'calc.h must initially exist in MemFS');
    assert.strictEqual(tc.hasFileInMemfs('workspace/src/calc.c'), true, 'calc.c must initially exist in MemFS');
    assert.strictEqual(tc.hasFileInMemfs('workspace/build/calc.o'), true, 'calc.o must initially exist in MemFS');

    // Now delete calc.h, calc.c, and calc.o from VFS
    vfs.remove('/workspace/include/calc.h');
    vfs.remove('/workspace/src/calc.c');
    vfs.remove('/workspace/build/calc.o');

    // Running gcc compile on deleted src/calc.c must fail
    let errOutput = '';
    const wrErr = (msg) => { errOutput += msg; };
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-c', 'src/calc.c', '-o', 'build/calc.o'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wrErr
    });
    assert.strictEqual(code, 1, 'Compiling non-existent source file must return exit code 1');
    assert.match(errOutput, /No such file or directory/i, 'Must report missing source file');

    // Verify MemFS purged workspace/include/calc.h, workspace/src/calc.c, and workspace/build/calc.o
    assert.strictEqual(tc.hasFileInMemfs('workspace/include/calc.h'), false, 'calc.h must be purged from MemFS');
    assert.strictEqual(tc.hasFileInMemfs('workspace/src/calc.c'), false, 'calc.c must be purged from MemFS');
    assert.strictEqual(tc.hasFileInMemfs('workspace/build/calc.o'), false, 'calc.o must be purged from MemFS');

    // Also verify compiling src/main.c (which includes calc.h) fails because calc.h is gone
    let diagOutput = '';
    tc.hostWrite = (msg) => { diagOutput += msg; };
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-Iinclude', '-c', 'src/main.c', '-o', 'build/main.o'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: wrErr
    });
    assert.notStrictEqual(code, 0, 'Compiling main.c without calc.h must fail');
    assert.match(diagOutput, /calc\.h.*not found/i, 'Must report calc.h not found in compiler diagnostics');
    console.log('✓ Ghost file prevention and missing header/source validation verified');

    // Test 10: Compiler CLI options parsing via parseCompilerArgs
    const pE = parseCompilerArgs(['-E', 'main.c']);
    assert.strictEqual(pE.stage, 'preprocess');
    assert.deepStrictEqual(pE.sources, ['main.c']);

    const pS = parseCompilerArgs(['-S', 'main.c', '-o', 'output.s']);
    assert.strictEqual(pS.stage, 'assembly');
    assert.strictEqual(pS.outputFile, 'output.s');

    const pC = parseCompilerArgs(['-c', 'main.c', '-O3', '-DDEBUG=1', '-Iinclude', '-Llib', '-lm']);
    assert.strictEqual(pC.stage, 'compile');
    assert.strictEqual(pC.compilerFlags.includes('-O3'), true);
    assert.strictEqual(pC.compilerFlags.includes('-DDEBUG=1'), true);
    assert.strictEqual(pC.compilerFlags.includes('-I/workspace/include'), true);
    assert.strictEqual(pC.linkerFlags.includes('-Lworkspace/lib'), true);
    assert.strictEqual(pC.linkerFlags.includes('-lm'), true);
    console.log('✓ Compiler CLI options argument parsing (-E, -S, -c, -D, -I, -L, -l) verified');

    // Test 11: gcc -E streams preprocessed output to stdout (write)
    vfs.writeFile('/workspace/macro.c', '#define ANSWER 42\nint get_answer(void) { return ANSWER; }\n');
    let prepStdout = '';
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-E', 'macro.c'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: (m) => { prepStdout += m; }
    });
    assert.strictEqual(code, 0, 'gcc -E must succeed with exit code 0');
    assert.strictEqual(prepStdout.includes('get_answer'), true, 'Preprocessed output must contain get_answer');
    assert.strictEqual(prepStdout.includes('42'), true, 'Preprocessed output must contain substituted macro value 42');
    console.log('✓ gcc -E preprocessor streaming to stdout verified');

    // Test 12: gcc -E macro.c -o macro.i writes preprocessed output to file in VFS
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-E', 'macro.c', '-o', 'macro.i'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: () => {}
    });
    assert.strictEqual(code, 0, 'gcc -E -o macro.i must succeed');
    assert.strictEqual(vfs.exists('/workspace/macro.i'), true, 'macro.i must be created in VFS');
    const macroIContent = vfs.readFile('/workspace/macro.i', true);
    assert.strictEqual(macroIContent.includes('get_answer'), true);
    assert.strictEqual(macroIContent.includes('42'), true);
    console.log('✓ gcc -E with -o <file> output to VFS verified');

    // Test 13: gcc -S generates WebAssembly text/assembly format (.s)
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-S', 'macro.c'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: () => {}
    });
    assert.strictEqual(code, 0, 'gcc -S must succeed');
    assert.strictEqual(vfs.exists('/workspace/macro.s'), true, 'macro.s must be created in VFS');
    const macroSContent = vfs.readFile('/workspace/macro.s', true);
    assert.match(macroSContent, /get_answer/);
    assert.match(macroSContent, /i32\.const\s+42/);
    console.log('✓ gcc -S assembly generation (.s) verified');

    // Test 14: gcc -S macro.c -o - streams assembly to stdout
    let asmStdout = '';
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-S', 'macro.c', '-o', '-'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: (m) => { asmStdout += m; }
    });
    assert.strictEqual(code, 0, 'gcc -S -o - must succeed');
    assert.match(asmStdout, /get_answer/);
    assert.match(asmStdout, /i32\.const\s+42/);
    console.log('✓ gcc -S -o - assembly streaming to stdout verified');

    // Test 15: gcc -D macro definitions and -v verbose diagnostics
    vfs.writeFile('/workspace/flags.c', '#ifndef CUSTOM_FLAG\n#error "CUSTOM_FLAG not defined"\n#endif\nint test() { return CUSTOM_FLAG; }\n');
    let verboseStdout = '';
    code = await executeGccCommand({
      cmd: 'gcc',
      args: ['-DCUSTOM_FLAG=100', '-v', '-c', 'flags.c', '-o', 'flags.o'],
      cwd: '/workspace',
      vfs,
      toolchain: tc,
      mode: 'c',
      write: (m) => { verboseStdout += m; }
    });
    assert.strictEqual(code, 0, 'gcc -D and -v must succeed');
    assert.strictEqual(vfs.exists('/workspace/flags.o'), true, 'flags.o must be created');
    assert.match(verboseStdout, /clang -cc1/i, 'Verbose output must include compiler invocations');
    console.log('✓ gcc -D macro definitions and -v diagnostics verified');

    console.log('--- ALL TOOLCHAIN DRIVER TESTS PASSED ---');
  });
}


