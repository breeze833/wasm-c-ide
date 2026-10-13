// Unit tests for Shell argument parsing and commands
import assert from 'node:assert';

function parseArgs(line) {
  const args = [];
  let current = '';
  let inQuotes = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === inQuotes) {
        inQuotes = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuotes = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

console.log('--- Running Shell Parser Unit Tests ---');

// Test 1: Simple arguments
const args1 = parseArgs('gcc -Wall -c src/main.c -o build/main.o');
assert.deepStrictEqual(args1, ['gcc', '-Wall', '-c', 'src/main.c', '-o', 'build/main.o']);
console.log('✓ parseArgs simple passed');

// Test 2: Quoted arguments
const args2 = parseArgs('echo "Hello World" \'Single quote test\'');
assert.deepStrictEqual(args2, ['echo', 'Hello World', 'Single quote test']);
console.log('✓ parseArgs quotes passed');

// Test 3: Redirection args
const args3 = parseArgs('echo "int a = 10;" > test.c');
assert.deepStrictEqual(args3, ['echo', 'int a = 10;', '>', 'test.c']);
console.log('✓ parseArgs redirection passed');

// Test 4: Command path normalization (/bin/ls -> ls, /usr/bin/gcc -> gcc)
function normalizeCommand(cmd) {
  if (cmd.startsWith('/bin/') || cmd.startsWith('/usr/bin/')) {
    return cmd.split('/').pop();
  }
  return cmd;
}
assert.strictEqual(normalizeCommand('/bin/ls'), 'ls');
assert.strictEqual(normalizeCommand('/usr/bin/gcc'), 'gcc');
assert.strictEqual(normalizeCommand('make'), 'make');
console.log('✓ Command path normalization passed');

// Test 5: which resolution
function resolveWhich(name) {
  if (['sh', 'ls', 'cat', 'rm', 'mkdir', 'cp', 'mv', 'pwd', 'clear', 'echo'].includes(name)) {
    return `/bin/${name}`;
  } else if (['gcc', 'clang', 'make', 'wasm-ld'].includes(name)) {
    return `/usr/bin/${name}`;
  }
  return null;
}
assert.strictEqual(resolveWhich('ls'), '/bin/ls');
assert.strictEqual(resolveWhich('gcc'), '/usr/bin/gcc');
assert.strictEqual(resolveWhich('make'), '/usr/bin/make');
assert.strictEqual(resolveWhich('sh'), '/bin/sh');
console.log('✓ which path resolution passed');

console.log('--- ALL SHELL TESTS PASSED ---');
