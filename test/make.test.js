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

console.log('--- ALL MAKE TESTS PASSED ---');
