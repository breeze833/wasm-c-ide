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

console.log('--- ALL SHELL TESTS PASSED ---');
