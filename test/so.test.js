// Unit and Integration tests for WebAssembly Shared Object (.so) support in LLVM 19 toolchain
import assert from 'node:assert';
import fs from 'node:fs';
import { executeGccCommand, parseCompilerArgs } from '../src/toolchain/driver.js';
import { WasmToolchain, AppInstance } from '../src/toolchain/wasm-clang.js';
import { VFS } from '../src/vfs/vfs.js';

console.log('--- Running WebAssembly Shared Object (.so) Unit & Integration Tests ---');

// Mock fetch for Node test environment
globalThis.fetch = async (url) => {
  const filePath = url.replace(/^\/?sysroot\//, 'public/sysroot/');
  const data = fs.readFileSync(filePath);
  return {
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
};

// Helper to inspect custom sections in WebAssembly binary
function parseWasmSections(bytes) {
  assert.strictEqual(bytes[0], 0x00, 'Must have wasm magic byte 0');
  assert.strictEqual(bytes[1], 0x61, 'Must have wasm magic byte 1 (a)');
  assert.strictEqual(bytes[2], 0x73, 'Must have wasm magic byte 2 (s)');
  assert.strictEqual(bytes[3], 0x6d, 'Must have wasm magic byte 3 (m)');

  const sections = [];
  let offset = 8;
  while (offset < bytes.length) {
    const sectionId = bytes[offset++];
    let len = 0;
    let shift = 0;
    while (true) {
      const b = bytes[offset++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    const sectionStart = offset;
    let customName = null;
    if (sectionId === 0) {
      let nameLen = 0;
      let nshift = 0;
      let p = offset;
      while (true) {
        const b = bytes[p++];
        nameLen |= (b & 0x7f) << nshift;
        if ((b & 0x80) === 0) break;
        nshift += 7;
      }
      customName = new TextDecoder().decode(bytes.slice(p, p + nameLen));
    }
    sections.push({ id: sectionId, len, customName });
    offset = sectionStart + len;
  }
  return sections;
}

// Test 1: parseCompilerArgs with -shared, -fPIC, and .so files
{
  const res1 = parseCompilerArgs(['-shared', '-fPIC', 'src/math.c', '-o', 'lib/libmath.so']);
  assert.strictEqual(res1.outputFile, 'lib/libmath.so');
  assert.deepStrictEqual(res1.sources, ['src/math.c']);
  assert.ok(res1.compilerFlags.includes('-fPIC'), 'compilerFlags must contain -fPIC');
  assert.ok(res1.linkerFlags.includes('-shared'), 'linkerFlags must contain -shared');

  const res2 = parseCompilerArgs(['src/main.c', 'build/libmath.so', '-o', 'a.out']);
  assert.strictEqual(res2.outputFile, 'a.out');
  assert.deepStrictEqual(res2.sources, ['src/main.c']);
  assert.deepStrictEqual(res2.objects, ['build/libmath.so'], '.so file must be categorized as object dependency');

  console.log('✓ parseCompilerArgs -shared, -fPIC, and .so dependency resolution passed');
}

// Test 2: Compile C position-independent code (-fPIC) and link into .so directly
{
  const vfs = new VFS();
  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  const mathSrc = 'int add(int a, int b) { return a + b; }\nint multiply(int a, int b) { return a * b; }\n';
  vfs.writeFile('/workspace/src/math.c', mathSrc);

  let outLog = '';
  const write = (s) => { outLog += s; };

  const code = await executeGccCommand({
    cmd: 'gcc',
    args: ['-shared', '-fPIC', 'src/math.c', '-o', 'build/libmath.so'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'c',
    write
  });

  assert.strictEqual(code, 0, `Direct .so compilation failed: ${outLog}`);
  assert.strictEqual(vfs.exists('/workspace/build/libmath.so'), true, 'build/libmath.so must exist in VFS');

  const soBytes = vfs.readFile('/workspace/build/libmath.so', false);
  assert.ok(soBytes.length > 0, 'libmath.so must have non-zero size');

  const sections = parseWasmSections(soBytes);
  const dylinkSection = sections.find(s => s.id === 0 && s.customName === 'dylink.0');
  assert.ok(dylinkSection, 'libmath.so must contain dylink.0 WebAssembly dynamic linking section');

  const soModule = await WebAssembly.compile(soBytes);
  const exports = WebAssembly.Module.exports(soModule);
  assert.ok(exports.some(e => e.name === 'add'), 'libmath.so must export add');
  assert.ok(exports.some(e => e.name === 'multiply'), 'libmath.so must export multiply');
  assert.ok(exports.some(e => e.name === '__wasm_call_ctors'), 'libmath.so must export __wasm_call_ctors');

  console.log('✓ Direct compilation and linkage to libmath.so with dylink.0 verified');
}

// Test 3: Multi-step separate compilation with -fPIC and linking with -shared
{
  const vfs = new VFS();
  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  vfs.writeFile('/workspace/src/calc.c', 'int square(int x) { return x * x; }\n');

  let outLog = '';
  const write = (s) => { outLog += s; };

  // Step 3a: gcc -fPIC -c src/calc.c -o build/calc.o
  const codeCompile = await executeGccCommand({
    cmd: 'gcc',
    args: ['-fPIC', '-c', 'src/calc.c', '-o', 'build/calc.o'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'c',
    write
  });
  assert.strictEqual(codeCompile, 0, 'Compiling with -fPIC must succeed');
  assert.strictEqual(vfs.exists('/workspace/build/calc.o'), true);

  // Step 3b: gcc -shared build/calc.o -o build/libcalc.so
  const codeLink = await executeGccCommand({
    cmd: 'gcc',
    args: ['-shared', 'build/calc.o', '-o', 'build/libcalc.so'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'c',
    write
  });
  assert.strictEqual(codeLink, 0, 'Linking object to .so must succeed');
  assert.strictEqual(vfs.exists('/workspace/build/libcalc.so'), true);

  const soBytes = vfs.readFile('/workspace/build/libcalc.so', false);
  const sections = parseWasmSections(soBytes);
  assert.ok(sections.some(s => s.id === 0 && s.customName === 'dylink.0'));

  console.log('✓ Multi-step compilation (-fPIC -c) and separate .so linking verified');
}

// Test 4: Link application executable against .so and verify dynamic imports & dylink.0
{
  const vfs = new VFS();
  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  vfs.writeFile('/workspace/src/math.c', 'int add(int a, int b) { return a + b; }\n');
  vfs.writeFile('/workspace/src/main.c', 'int add(int a, int b);\nint main(void) { return add(20, 22); }\n');

  let outLog = '';
  const write = (s) => { outLog += s; };

  // Build libmath.so
  await executeGccCommand({
    cmd: 'gcc',
    args: ['-shared', '-fPIC', 'src/math.c', '-o', 'build/libmath.so'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'c',
    write
  });

  // Link executable with libmath.so
  const codeExe = await executeGccCommand({
    cmd: 'gcc',
    args: ['src/main.c', 'build/libmath.so', '-o', 'a.out'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'c',
    write
  });

  assert.strictEqual(codeExe, 0, `Linking executable with .so failed: ${outLog}`);
  assert.strictEqual(vfs.exists('/workspace/a.out'), true, 'a.out must exist in VFS');

  const exeBytes = vfs.readFile('/workspace/a.out', false);
  const exeSections = parseWasmSections(exeBytes);
  assert.ok(exeSections.some(s => s.id === 0 && s.customName === 'dylink.0'), 'a.out must have dylink.0 custom section');

  const exeModule = await WebAssembly.compile(exeBytes);
  const exeImports = WebAssembly.Module.imports(exeModule);
  assert.ok(
    exeImports.some(imp => imp.module === 'env' && imp.name === 'add'),
    'a.out must import add from env (delegated to libmath.so)'
  );

  console.log('✓ Linking application executable against .so with dylink.0 dependencies verified');
}

// Test 5: End-to-end execution of dynamically linked module with Shared Object
{
  const vfs = new VFS();
  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  vfs.writeFile('/workspace/src/math.c', 'int add(int a, int b) { return a + b; }\n');
  vfs.writeFile('/workspace/src/main.c', 'int add(int a, int b);\nint main(void) { return add(15, 27); }\n');

  let outLog = '';
  const write = (s) => { outLog += s; };

  await executeGccCommand({
    cmd: 'gcc',
    args: ['-shared', '-fPIC', 'src/math.c', '-o', 'build/libmath.so'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'c',
    write
  });

  await executeGccCommand({
    cmd: 'gcc',
    args: ['src/main.c', 'build/libmath.so', '-o', 'a.out'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'c',
    write
  });

  const soBytes = vfs.readFile('/workspace/build/libmath.so', false);
  const exeBytes = vfs.readFile('/workspace/a.out', false);

  const soModule = await WebAssembly.compile(soBytes);
  const exeModule = await WebAssembly.compile(exeBytes);

  // Dynamic runtime instantiation
  const memory = new WebAssembly.Memory({ initial: 2, maximum: 10 });
  const table = new WebAssembly.Table({ element: 'anyfunc', initial: 10, maximum: 20 });
  const memoryBase = new WebAssembly.Global({ value: 'i32', mutable: false }, 0);
  const tableBase = new WebAssembly.Global({ value: 'i32', mutable: false }, 0);

  const soInstance = await WebAssembly.instantiate(soModule, {
    env: {
      memory,
      __memory_base: memoryBase,
      __table_base: tableBase
    }
  });

  if (typeof soInstance.exports.__wasm_call_ctors === 'function') {
    soInstance.exports.__wasm_call_ctors();
  }

  let capturedExitCode = null;
  const exeInstance = await WebAssembly.instantiate(exeModule, {
    env: {
      ...soInstance.exports
    },
    wasi_snapshot_preview1: {
      proc_exit: (code) => {
        capturedExitCode = code;
        throw new Error(`EXIT_${code}`);
      }
    }
  });

  try {
    exeInstance.exports._start();
  } catch (err) {
    if (!err.message.startsWith('EXIT_')) throw err;
  }

  assert.strictEqual(capturedExitCode, 42, `Execution of main dynamically calling add(15, 27) must yield exitCode 42, got ${capturedExitCode}`);
  console.log('✓ Dynamic runtime loading and execution of .so returning correct result (42) verified');
}

// Test 6: C++ Shared Object compilation with g++ -shared -fPIC
{
  const vfs = new VFS();
  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  const cppSrc = [
    'class MathOps {',
    'public:',
    '  static int compute(int a, int b) { return (a * 2) + b; }',
    '};',
    'extern "C" int run_calc(int a, int b) { return MathOps::compute(a, b); }',
    ''
  ].join('\n');

  vfs.writeFile('/workspace/src/calc.cpp', cppSrc);

  let outLog = '';
  const write = (s) => { outLog += s; };

  const code = await executeGccCommand({
    cmd: 'g++',
    args: ['-shared', '-fPIC', 'src/calc.cpp', '-o', 'build/libcalc.so'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: 'cpp',
    write
  });

  assert.strictEqual(code, 0, `C++ .so compilation failed: ${outLog}`);
  assert.strictEqual(vfs.exists('/workspace/build/libcalc.so'), true);

  const soBytes = vfs.readFile('/workspace/build/libcalc.so', false);
  const soModule = await WebAssembly.compile(soBytes);
  const exports = WebAssembly.Module.exports(soModule);
  assert.ok(exports.some(e => e.name === 'run_calc'), 'libcalc.so must export extern "C" run_calc');

  console.log('✓ C++ Shared Object (.so) compilation and extern "C" export verified');
}

console.log('--- ALL SHARED OBJECT (.so) TESTS PASSED ---');
