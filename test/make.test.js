// Unit tests for Makefile parsing and incremental logic
import assert from 'node:assert';
import { parseMakefile } from '../src/toolchain/make.js';

console.log('--- Running Makefile Parser Unit Tests ---');

const sampleMakefile = `CC = gcc
CFLAGS = -Iinclude -Wall
TARGET = a.out

all: $(TARGET)

build:
\tmkdir -p build

build/calc.o: src/calc.c | build
\t$(CC) $(CFLAGS) -c src/calc.c -o build/calc.o

build/main.o: src/main.c | build
\t$(CC) $(CFLAGS) -c src/main.c -o build/main.o

$(TARGET): build/calc.o build/main.o
\t$(CC) build/calc.o build/main.o -o $(TARGET)

clean:
\trm -rf build $(TARGET)
`;

const { vars, targets } = parseMakefile(sampleMakefile);

assert.strictEqual(vars.get('CC'), 'gcc');
assert.strictEqual(vars.get('CFLAGS'), '-Iinclude -Wall');
assert.strictEqual(vars.get('TARGET'), 'a.out');
console.log('✓ Makefile variables parsed');

assert.strictEqual(targets.has('all'), true);
assert.deepStrictEqual(targets.get('all').prereqs, ['a.out']);

assert.strictEqual(targets.has('build/calc.o'), true);
assert.deepStrictEqual(targets.get('build/calc.o').prereqs, ['src/calc.c']);
assert.deepStrictEqual(targets.get('build/calc.o').recipes, [
  'gcc -Iinclude -Wall -c src/calc.c -o build/calc.o',
]);

assert.strictEqual(targets.has('a.out'), true);
assert.deepStrictEqual(targets.get('a.out').prereqs, ['build/calc.o', 'build/main.o']);
assert.deepStrictEqual(targets.get('a.out').recipes, [
  'gcc build/calc.o build/main.o -o a.out',
]);

assert.strictEqual(targets.has('clean'), true);
assert.deepStrictEqual(targets.get('clean').recipes, ['rm -rf build a.out']);
console.log('✓ Makefile rules, prerequisites, and recipe variable substitutions parsed');

// Test: SettingsModal separate Save and Generate Build Script buttons
import { SettingsModal, DEFAULT_RUN_COMMAND } from '../src/components/settings.js';
import { VFS } from '../src/vfs/vfs.js';
import fs from 'node:fs';

const vfs = new VFS();
vfs.writeFile('/workspace/src/game.c', 'int main() { return 0; }');
vfs.writeFile('/workspace/src/utils.c', 'void foo() {}');

const elements = new Map();
function createMockElement(tag, id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: '',
    style: {},
    value: '',
    checked: false,
    _listeners: {},
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    click() {
      if (this._listeners['click']) {
        for (const fn of this._listeners['click']) fn({ target: this });
      }
    },
    querySelector(sel) {
      if (sel.startsWith('#')) {
        const targetId = sel.slice(1);
        if (!elements.has(targetId)) {
          elements.set(targetId, createMockElement('div', targetId));
        }
        return elements.get(targetId);
      }
      return createMockElement('div');
    }
  };
  if (id) elements.set(id, el);
  return el;
}

function getElement(id) {
  if (!elements.has(id)) {
    elements.set(id, createMockElement('div', id));
  }
  return elements.get(id);
}

globalThis.document = {
  getElementById(id) {
    return getElement(id);
  },
  createElement(tag) {
    return createMockElement(tag);
  },
  body: createMockElement('body')
};

let saveCalled = false;
let generateCalled = false;
let savedConfig = null;

const modal = new SettingsModal(
  vfs,
  { mode: 'c', buildSystem: 'sh', targetName: 'game.out' },
  (cfg) => {
    saveCalled = true;
    savedConfig = cfg;
  },
  (cfg) => {
    generateCalled = true;
  }
);

modal.show();

const saveBtn = getElement('modal-save-btn');
const generateBtn = getElement('modal-generate-btn');
assert.strictEqual(Boolean(saveBtn), true, 'modal-save-btn must exist');
assert.strictEqual(Boolean(generateBtn), true, 'modal-generate-btn must exist');

// Verify default runCommand
assert.strictEqual(DEFAULT_RUN_COMMAND, 'pushd . && cd /workspace && ./a.out; popd', 'DEFAULT_RUN_COMMAND must match expected value');
assert.strictEqual(modal.config.runCommand, DEFAULT_RUN_COMMAND, 'modal.config.runCommand must default to DEFAULT_RUN_COMMAND');

// Set form values
getElement('setting-mode').value = 'cpp';
getElement('setting-build-sys').value = 'make';
getElement('setting-includes').value = 'include, src';
getElement('setting-flags').value = '-Wall -O2';
getElement('setting-linker-flags').value = '-o mygame.out -lraylib';
getElement('setting-run-cmd').value = 'pushd . && cd /workspace && ./mygame.out; popd';

// 1. Click Save button: saves config, does NOT generate build files
saveBtn.click();
assert.strictEqual(saveCalled, true, 'onSave callback must be invoked on Save click');
assert.strictEqual(savedConfig.mode, 'cpp');
assert.strictEqual(savedConfig.buildSystem, 'make');
assert.deepStrictEqual(savedConfig.includePaths, ['include', 'src']);
assert.deepStrictEqual(savedConfig.compilerFlags, ['-Wall', '-O2']);
assert.strictEqual(savedConfig.linkerFlags, '-o mygame.out -lraylib');
assert.strictEqual(savedConfig.targetName, 'mygame.out');
assert.strictEqual(savedConfig.runCommand, 'pushd . && cd /workspace && ./mygame.out; popd');
assert.strictEqual(vfs.exists('/workspace/build.sh'), false, 'Save must NOT generate build.sh');
assert.strictEqual(vfs.exists('/workspace/Makefile'), false, 'Save must NOT generate Makefile');

// 2. Click Generate Build Script button: generates build files from workspace files
generateBtn.click();
assert.strictEqual(generateCalled, true, 'onGenerateBuildFiles callback must be invoked on Generate click');
assert.strictEqual(vfs.exists('/workspace/build.sh'), true, 'Generate must create /workspace/build.sh');
assert.strictEqual(vfs.exists('/workspace/Makefile'), true, 'Generate must create /workspace/Makefile');

const genBuildSh = vfs.readFile('/workspace/build.sh', true);
assert.strictEqual(genBuildSh.includes('src/game.c'), true, 'build.sh must compile src/game.c');
assert.strictEqual(genBuildSh.includes('src/utils.c'), true, 'build.sh must compile src/utils.c');
assert.strictEqual(genBuildSh.includes('-lraylib'), true, 'build.sh must link raylib when specified in linkerFlags');
assert.strictEqual(genBuildSh.includes('-o mygame.out -lraylib\necho "Build complete: mygame.out"'), true, 'build.sh must have clean newline before echo');

const genMakefile = vfs.readFile('/workspace/Makefile', true);
assert.strictEqual(genMakefile.includes('src/game.c'), true, 'Makefile must include src/game.c');
assert.strictEqual(genMakefile.includes('src/utils.c'), true, 'Makefile must include src/utils.c');
assert.strictEqual(genMakefile.includes('TARGET = mygame.out'), true, 'Makefile must set TARGET = mygame.out');
assert.strictEqual(genMakefile.includes('LDFLAGS = -o mygame.out -lraylib'), true, 'Makefile must set LDFLAGS = -o mygame.out -lraylib');

// 3. Verify main.js run command integration
const mainCode = fs.readFileSync('src/main.js', 'utf8');
assert.ok(mainCode.includes('DEFAULT_RUN_COMMAND'), 'main.js must import DEFAULT_RUN_COMMAND');
assert.ok(mainCode.includes('this.runCommand = savedRunCmd || DEFAULT_RUN_COMMAND'), 'main.js must initialize this.runCommand with fallback');
assert.ok(mainCode.includes('wasm_c_ide_run_command'), 'main.js must persist runCommand to localStorage wasm_c_ide_run_command');
assert.ok(mainCode.includes('this.runCommand || DEFAULT_RUN_COMMAND'), 'btnRun click must use this.runCommand with fallback');

console.log('✓ SettingsModal separate Save and Generate Build Script buttons verified');
console.log('✓ SettingsModal Run Command field and main.js btnRun integration verified');

// =====================================================================
// GNU Make WASI Integration Unit Tests (runMake & make-wasi)
// =====================================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMake, loadMakeBinary } from '../src/toolchain/make.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';
import { mountSysroot } from '../src/vfs/sysroot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, ...args) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    return nativeFetch(url, ...args);
  }
  let clean = String(url).replace(/^.*\/sysroot\//, 'public/sysroot/').replace(/^\//, '');
  if (clean.startsWith('sysroot/')) clean = 'public/' + clean;
  const resolved = path.resolve(projectRoot, clean);
  const data = fs.readFileSync(resolved);
  return {
    ok: true,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    text: async () => data.toString('utf-8')
  };
};

console.log('\n--- Running Real GNU Make WASI Unit Tests ---');

async function testGnuMakeWasi() {
  const makeVfs = new VFS();
  mountSysroot(makeVfs);

  // Test 1: Automatic variables, pattern rules, and order-only prerequisites
  console.log('Test 1: GNU Make automatic variables ($@, $<, $^), pattern rules, and order-only prereqs...');
  const makefile1 = `
CC = gcc
CFLAGS = -Wall
TARGET = a.out
OBJS = build/calc.o build/main.o

all: $(TARGET)

build:
\tmkdir -p build

build/%.o: src/%.c | build
\techo "COMPILE $< -> $@"

$(TARGET): $(OBJS)
\techo "LINK $^ -> $@"

clean:
\trm -rf build $(TARGET)
`;

  makeVfs.writeFile('/workspace/src/calc.c', 'int add(int a, int b) { return a + b; }\n', 1000);
  makeVfs.writeFile('/workspace/src/main.c', 'int main(void) { return 0; }\n', 1000);
  makeVfs.writeFile('/workspace/Makefile', makefile1, 1000);

  let output1 = '';
  const executedRecipes1 = [];
  const exitCode1 = await runMake({
    args: ['all'],
    cwd: '/workspace',
    vfs: makeVfs,
    write: (str) => { output1 += str; },
    executeCommand: (cmd) => {
      executedRecipes1.push(cmd);
      if (cmd.startsWith('mkdir -p ')) {
        makeVfs.mkdir('/workspace/build', true, true);
        const n = makeVfs._resolve('/workspace/build');
        if (n) n.mtime = 500;
        return 0;
      }
      if (cmd.includes('COMPILE src/calc.c -> build/calc.o')) {
        makeVfs.writeFile('/workspace/build/calc.o', 'CALC_OBJ', 2000);
        return 0;
      }
      if (cmd.includes('COMPILE src/main.c -> build/main.o')) {
        makeVfs.writeFile('/workspace/build/main.o', 'MAIN_OBJ', 2000);
        return 0;
      }
      if (cmd.includes('LINK build/calc.o build/main.o -> a.out')) {
        makeVfs.writeFile('/workspace/a.out', 'APP_BIN', 2000);
        return 0;
      }
      return 0;
    }
  });

  assert.strictEqual(exitCode1, 0, 'GNU Make must exit with 0 on valid Makefile');
  assert.ok(executedRecipes1.some(r => r.includes('mkdir -p build')), 'Order-only build dir creation recipe must execute');
  assert.ok(executedRecipes1.some(r => r.includes('COMPILE src/calc.c -> build/calc.o')), 'Pattern rule with $< and $@ for calc.c must execute');
  assert.ok(executedRecipes1.some(r => r.includes('COMPILE src/main.c -> build/main.o')), 'Pattern rule with $< and $@ for main.c must execute');
  assert.ok(executedRecipes1.some(r => r.includes('LINK build/calc.o build/main.o -> a.out')), 'Target rule with $^ and $@ must execute');
  console.log('✓ Automatic variables, pattern rules, and order-only prereqs verified');

  // Test 2: Incremental build & mtime staleness evaluation
  console.log('Test 2: Incremental build and mtime staleness evaluation...');
  let executedRecipes2 = [];
  const exitCode2 = await runMake({
    args: ['all'],
    cwd: '/workspace',
    vfs: makeVfs,
    executeCommand: (cmd) => { executedRecipes2.push(cmd); return 0; }
  });

  assert.strictEqual(exitCode2, 0, 'Incremental make must exit with code 0');
  assert.strictEqual(executedRecipes2.length, 0, 'No recipes must run when all targets are up to date');
  console.log('✓ Target up-to-date detection verified (0 recipes executed)');

  // Touch src/calc.c (mtime 3000)
  makeVfs.writeFile('/workspace/src/calc.c', 'int add(int a, int b) { return a + b + 1; }\n', 3000);
  let executedRecipes3 = [];
  const exitCode3 = await runMake({
    args: ['all'],
    cwd: '/workspace',
    vfs: makeVfs,
    executeCommand: (cmd) => {
      executedRecipes3.push(cmd);
      if (cmd.includes('COMPILE src/calc.c -> build/calc.o')) {
        makeVfs.writeFile('/workspace/build/calc.o', 'CALC_OBJ_NEW', 3500);
      } else if (cmd.includes('LINK build/calc.o build/main.o -> a.out')) {
        makeVfs.writeFile('/workspace/a.out', 'APP_BIN_NEW', 3500);
      }
      return 0;
    }
  });

  assert.strictEqual(exitCode3, 0, 'Rebuild must exit with code 0');
  assert.ok(executedRecipes3.some(r => r.includes('src/calc.c')), 'calc.o must be recompiled');
  assert.ok(executedRecipes3.some(r => r.includes('LINK')), 'a.out must be relinked');
  assert.strictEqual(executedRecipes3.some(r => r.includes('src/main.c')), false, 'Unchanged main.c must NOT be recompiled');
  console.log('✓ Selective incremental recompilation verified');

  // Test 3: Recipe failure exit code propagation
  console.log('Test 3: Recipe failure exit code propagation...');
  const makefileFail = `
all: step1 step2
step1:
\tfalse
step2:
\techo "Should not run"
`;
  makeVfs.writeFile('/workspace/Makefile', makefileFail, 1000);
  let failOutput = '';
  const exitCodeFail = await runMake({
    args: ['all'],
    cwd: '/workspace',
    vfs: makeVfs,
    write: (s) => { failOutput += s; }
  });
  assert.strictEqual(exitCodeFail, 2, 'make must exit with code 2 on recipe failure');
  assert.strictEqual(failOutput.includes('Should not run'), false, 'Subsequent target must not run after failure');
  console.log('✓ Recipe failure aborts build with exit code 2');

  // Test 4: -k (keep-going) flag
  console.log('Test 4: -k (--keep-going) flag continues independent targets...');
  const makefileKeepGoing = `
all: fail_target ok_target
fail_target:
\tfalse
ok_target:
\techo "Independent target executed"
`;
  makeVfs.writeFile('/workspace/Makefile', makefileKeepGoing, 1000);
  let kgOutput = '';
  const exitCodeKg = await runMake({
    args: ['-k', 'all'],
    cwd: '/workspace',
    vfs: makeVfs,
    write: (s) => { kgOutput += s; }
  });
  assert.strictEqual(exitCodeKg, 2, 'make -k must return error code if any recipe failed');
  assert.ok(kgOutput.includes('Independent target executed'), 'Independent target must execute when -k is given');
  console.log('✓ -k flag executes independent branches despite failure');

  // Test 5: -n (dry-run) flag
  console.log('Test 5: -n (--dry-run) prints recipes without execution...');
  const makefileDry = `
target:
\techo "Side effect"
`;
  makeVfs.writeFile('/workspace/Makefile', makefileDry, 1000);
  let dryRunRecipeExecuted = false;
  let dryRunOutput = '';
  const exitCodeDry = await runMake({
    args: ['-n', 'target'],
    cwd: '/workspace',
    vfs: makeVfs,
    write: (s) => { dryRunOutput += s; },
    executeCommand: () => { dryRunRecipeExecuted = true; return 0; }
  });
  assert.strictEqual(exitCodeDry, 0, 'make -n must exit with code 0');
  assert.strictEqual(dryRunRecipeExecuted, false, 'No recipe must execute under -n dry-run');
  assert.ok(dryRunOutput.includes('echo "Side effect"'), 'Recipe command line must be printed under -n');
  console.log('✓ -n dry-run flag verified');

  // Test 6: include directive
  console.log('Test 6: include directive...');
  makeVfs.writeFile('/workspace/config.mk', 'GREETING = "Hello from included config"\n', 1000);
  const makefileInclude = `
include config.mk
greet:
\techo $(GREETING)
`;
  makeVfs.writeFile('/workspace/Makefile', makefileInclude, 1000);
  let incOutput = '';
  const exitCodeInc = await runMake({
    args: ['greet'],
    cwd: '/workspace',
    vfs: makeVfs,
    write: (s) => { incOutput += s; }
  });
  assert.strictEqual(exitCodeInc, 0, 'make with include must exit with code 0');
  assert.ok(incOutput.includes('Hello from included config'), 'Variable from included Makefile must expand');
  console.log('✓ include directive verified');

  // Test 7: Real WasmToolchain compilation via make recipes
  console.log('Test 7: Real WasmToolchain C compilation and linking through GNU Make recipes...');
  const realTc = new WasmToolchain({ vfs: makeVfs, basePath: '/sysroot/wasm' });
  await realTc.init();

  const realMakefile = `
CC = gcc
CFLAGS = -O2
TARGET = math.wasm
OBJS = build/math.o

all: $(TARGET)

build:
\tmkdir -p build

build/%.o: src/%.c | build
\t$(CC) $(CFLAGS) -c $< -o $@

$(TARGET): $(OBJS)
\t$(CC) $^ -o $@

clean:
\trm -rf build $(TARGET)
`;

  makeVfs.writeFile('/workspace/src/math.c', 'int add(int a, int b) { return a + b; }\nint main(void) { return add(20, 22); }\n', 1000);
  makeVfs.writeFile('/workspace/Makefile', realMakefile, 1000);

  let realOutput = '';
  const exitCodeReal = await runMake({
    args: ['all'],
    cwd: '/workspace',
    vfs: makeVfs,
    toolchain: realTc,
    write: (s) => { realOutput += s; }
  });

  assert.strictEqual(exitCodeReal, 0, 'Real C compilation via make must exit with code 0');
  assert.strictEqual(makeVfs.exists('/workspace/build/math.o'), true, 'build/math.o object file must be created by gcc -c');
  assert.strictEqual(makeVfs.exists('/workspace/math.wasm'), true, 'math.wasm target must be generated by gcc linker');
  const wasmHeader = makeVfs.readFile('/workspace/math.wasm', false);
  assert.strictEqual(wasmHeader[0], 0x00, 'Magic byte 0 must be 0x00');
  assert.strictEqual(wasmHeader[1], 0x61, 'Magic byte 1 must be 0x61 (a)');
  assert.strictEqual(wasmHeader[2], 0x73, 'Magic byte 2 must be 0x73 (s)');
  assert.strictEqual(wasmHeader[3], 0x6d, 'Magic byte 3 must be 0x6d (m)');
  console.log('✓ End-to-end GNU Make compiling and linking real C code into valid WebAssembly binary verified');

  // Verify second run reports up to date:
  let secondOutput = '';
  const exitCodeSecond = await runMake({
    args: ['all'],
    cwd: '/workspace',
    vfs: makeVfs,
    toolchain: realTc,
    write: (s) => { secondOutput += s; }
  });
  assert.strictEqual(exitCodeSecond, 0);
  assert.ok(secondOutput.includes('Nothing to be done') || secondOutput.includes('is up to date') || secondOutput.trim() === '', `Second run must report up to date: ${secondOutput}`);

  // Now touch src/math.c and verify make rebuilds:
  const wasmMtime = makeVfs.stat('/workspace/math.wasm').mtime;
  makeVfs.setTimes('/workspace/src/math.c', 0, wasmMtime + 2000);
  const mathMtimeAfter = makeVfs.stat('/workspace/src/math.c').mtime;
  assert.ok(mathMtimeAfter > wasmMtime, 'setTimes must make math.c newer than target');

  let thirdOutput = '';
  const exitCodeThird = await runMake({
    args: ['all'],
    cwd: '/workspace',
    vfs: makeVfs,
    toolchain: realTc,
    write: (s) => { thirdOutput += s; }
  });
  assert.strictEqual(exitCodeThird, 0);
  assert.ok(thirdOutput.includes('math.c'), `make must recompile touched src/math.c: ${thirdOutput}`);
  console.log('✓ Incremental rebuild after touching source file verified');

  // Test 7.1: Verify make clean removes build directory and target
  console.log('Test 7.1: Verify make clean removes build directory and target...');
  const cleanMakefile = realMakefile + '\nclean:\n\trm -rf build $(TARGET)\n';
  makeVfs.writeFile('/workspace/Makefile', cleanMakefile, Date.now());
  assert.strictEqual(makeVfs.exists('/workspace/build'), true, 'build directory exists before clean');
  assert.strictEqual(makeVfs.exists('/workspace/math.wasm'), true, 'math.wasm exists before clean');

  const exitCodeClean = await runMake({
    args: ['clean'],
    cwd: '/workspace',
    vfs: makeVfs,
    toolchain: realTc,
  });
  assert.strictEqual(exitCodeClean, 0);
  assert.strictEqual(makeVfs.exists('/workspace/build'), false, 'build directory must be removed by make clean');
  assert.strictEqual(makeVfs.exists('/workspace/math.wasm'), false, 'math.wasm target must be removed by make clean');
  console.log('✓ make clean removes build directory and target verified');

  // Test 8: loadMakeBinary cache hit resilience (simulates reload)
  console.log('Test 8: Verify loadMakeBinary caching and reload resilience...');
  const mod1 = await loadMakeBinary('/sysroot/wasm', makeVfs);
  assert.ok(mod1 instanceof WebAssembly.Module, 'First load must return WebAssembly.Module');
  const mod2 = await loadMakeBinary('/sysroot/wasm', makeVfs);
  assert.ok(mod2 instanceof WebAssembly.Module, 'Subsequent load must return WebAssembly.Module without BufferSource error');
  console.log('✓ loadMakeBinary cache resilience verified');

  // Test 9: loadMakeBinary subpath basePath resolution (GitHub Pages / server subfolder)
  console.log('Test 9: Verify subpath basePath resolution for GitHub Pages / sub-path hosting...');
  const subpathMod = await loadMakeBinary('/wasm-c-ide/sysroot/wasm', makeVfs);
  assert.ok(subpathMod instanceof WebAssembly.Module, 'Must load make.wasm from subpath basePath');
  console.log('✓ Subpath basePath resolution verified');
}

await testGnuMakeWasi();

console.log('--- ALL MAKE TESTS PASSED ---');
