// Unit tests for Toolchain argument parsing and driver flags
import assert from 'node:assert';

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

console.log('--- ALL TOOLCHAIN DRIVER TESTS PASSED ---');
