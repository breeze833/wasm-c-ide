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
import { SettingsModal } from '../src/components/settings.js';
import { VFS } from '../src/vfs/vfs.js';

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
  { mode: 'c', buildSystem: 'sh', enableRaylib: false, targetName: 'game.out' },
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

// Set form values
getElement('setting-mode').value = 'cpp';
getElement('setting-build-sys').value = 'make';
getElement('setting-raylib').checked = true;
getElement('setting-includes').value = 'include, src';
getElement('setting-flags').value = '-Wall -O2';
getElement('setting-target').value = 'mygame.out';

// 1. Click Save button: saves config, does NOT generate build files
saveBtn.click();
assert.strictEqual(saveCalled, true, 'onSave callback must be invoked on Save click');
assert.strictEqual(savedConfig.mode, 'cpp');
assert.strictEqual(savedConfig.buildSystem, 'make');
assert.strictEqual(savedConfig.enableRaylib, true);
assert.deepStrictEqual(savedConfig.includePaths, ['include', 'src']);
assert.deepStrictEqual(savedConfig.compilerFlags, ['-Wall', '-O2']);
assert.strictEqual(savedConfig.targetName, 'mygame.out');
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
assert.strictEqual(genBuildSh.includes('-lraylib'), true, 'build.sh must link raylib when enabled');
assert.strictEqual(genBuildSh.includes('-o mygame.out\necho "Build complete: mygame.out"'), true, 'build.sh must have clean newline before echo');

const genMakefile = vfs.readFile('/workspace/Makefile', true);
assert.strictEqual(genMakefile.includes('src/game.c'), true, 'Makefile must include src/game.c');
assert.strictEqual(genMakefile.includes('src/utils.c'), true, 'Makefile must include src/utils.c');
assert.strictEqual(genMakefile.includes('TARGET = mygame.out'), true, 'Makefile must set TARGET = mygame.out');
assert.strictEqual(genMakefile.includes('LDFLAGS = -lraylib'), true, 'Makefile must set LDFLAGS = -lraylib');

console.log('✓ SettingsModal separate Save and Generate Build Script buttons verified');

console.log('--- ALL MAKE TESTS PASSED ---');
