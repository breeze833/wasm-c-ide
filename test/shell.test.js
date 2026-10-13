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

import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot } from '../src/vfs/sysroot.js';

// Test 6: parseTokens distinguishing quoted vs unquoted tokens
function parseTokens(line) {
  const tokens = [];
  let current = '';
  let inQuotes = null;
  let isQuoted = false;

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
      isQuoted = true;
    } else if (/\s/.test(ch)) {
      if (current.length > 0 || isQuoted) {
        tokens.push({ text: current, quoted: isQuoted });
        current = '';
        isQuoted = false;
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0 || isQuoted) {
    tokens.push({ text: current, quoted: isQuoted });
  }

  return tokens;
}

const tokens1 = parseTokens('ls build/* "src/*.c"');
assert.deepStrictEqual(tokens1, [
  { text: 'ls', quoted: false },
  { text: 'build/*', quoted: false },
  { text: 'src/*.c', quoted: true }
]);
console.log('✓ parseTokens quoted vs unquoted passed');

// Test 7: Glob expansion against VFS
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$');
}

async function expandGlobToken(token, currentDir, vfs) {
  if (!/[*?]/.test(token)) return [token];

  const isAbsolute = token.startsWith('/');
  const rawParts = token.split('/').filter(Boolean);

  async function expandSegments(currentVfsPath, segmentIndex, currentPrefix) {
    if (segmentIndex >= rawParts.length) {
      return [currentPrefix];
    }

    const segment = rawParts[segmentIndex];
    const isLast = segmentIndex === rawParts.length - 1;

    if (!/[*?]/.test(segment)) {
      const nextVfsPath = currentVfsPath === '/' ? `/${segment}` : `${currentVfsPath}/${segment}`;
      const nextPrefix = currentPrefix
        ? (currentPrefix === '/' ? `/${segment}` : `${currentPrefix}/${segment}`)
        : segment;
      if (!vfs.exists(nextVfsPath)) return [];
      return expandSegments(nextVfsPath, segmentIndex + 1, nextPrefix);
    }

    try {
      const entries = vfs.readDir(currentVfsPath);
      const regex = globToRegex(segment);
      const matches = entries.filter(e => {
        if (!segment.startsWith('.') && e.name.startsWith('.')) return false;
        return regex.test(e.name);
      });

      const results = [];
      for (const match of matches) {
        if (!isLast && !match.isDir) continue;
        const nextVfsPath = currentVfsPath === '/' ? `/${match.name}` : `${currentVfsPath}/${match.name}`;
        const nextPrefix = currentPrefix
          ? (currentPrefix === '/' ? `/${match.name}` : `${currentPrefix}/${match.name}`)
          : match.name;
        const sub = await expandSegments(nextVfsPath, segmentIndex + 1, nextPrefix);
        results.push(...sub);
      }
      return results;
    } catch {
      return [];
    }
  }

  const startVfsPath = isAbsolute ? '/' : currentDir;
  const startPrefix = isAbsolute ? (token.startsWith('//') ? '//' : '/') : '';
  const expanded = await expandSegments(startVfsPath, 0, startPrefix);

  if (expanded.length === 0) return [token];
  return expanded.sort();
}

{
  const vfs = new VFS();
  mountSysroot(vfs);
  vfs.mkdir('/workspace/build');
  vfs.writeFile('/workspace/build/calc.o', 'obj1');
  vfs.writeFile('/workspace/build/main.o', 'obj2');
  vfs.writeFile('/workspace/src/calc.c', 'src1');
  vfs.writeFile('/workspace/src/main.c', 'src2');

  const exp1 = await expandGlobToken('build/*', '/workspace', vfs);
  assert.deepStrictEqual(exp1, ['build/calc.o', 'build/main.o']);

  const exp2 = await expandGlobToken('src/*.c', '/workspace', vfs);
  assert.deepStrictEqual(exp2, ['src/calc.c', 'src/main.c']);

  const exp3 = await expandGlobToken('*.o', '/workspace/build', vfs);
  assert.deepStrictEqual(exp3, ['calc.o', 'main.o']);

  const exp4 = await expandGlobToken('build/*.unknown', '/workspace', vfs);
  assert.deepStrictEqual(exp4, ['build/*.unknown']); // unmatched stays as-is

  const exp5 = await expandGlobToken('/bin/c*', '/workspace', vfs);
  assert.deepStrictEqual(exp5, ['/bin/cat', '/bin/clear', '/bin/cp']);

  console.log('✓ Glob expansion against VFS passed');
}

console.log('--- ALL SHELL TESTS PASSED ---');
