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

// Test 8: parseCommandChain
function parseCommandChain(line) {
  const commands = [];
  let current = '';
  let inQuotes = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === inQuotes) inQuotes = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuotes = ch;
      current += ch;
    } else if (ch === '&' && line[i + 1] === '&') {
      commands.push({ cmd: current.trim(), op: '&&' });
      current = '';
      i++;
    } else if (ch === '|' && line[i + 1] === '|') {
      commands.push({ cmd: current.trim(), op: '||' });
      current = '';
      i++;
    } else if (ch === ';') {
      commands.push({ cmd: current.trim(), op: ';' });
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    commands.push({ cmd: current.trim(), op: null });
  }

  return commands;
}

const chain1 = parseCommandChain('pushd . && cd /workspace && gcc -c src/main.c -o build/main.o; popd');
assert.deepStrictEqual(chain1, [
  { cmd: 'pushd .', op: '&&' },
  { cmd: 'cd /workspace', op: '&&' },
  { cmd: 'gcc -c src/main.c -o build/main.o', op: ';' },
  { cmd: 'popd', op: null },
]);

const chain2 = parseCommandChain('echo "hello && world"; echo done');
assert.deepStrictEqual(chain2, [
  { cmd: 'echo "hello && world"', op: ';' },
  { cmd: 'echo done', op: null },
]);
console.log('✓ parseCommandChain passed');

// Test 9: Directory stack operations (pushd, popd, dirs, cd -)
{
  const vfs = new VFS();
  mountSysroot(vfs);
  vfs.mkdir('/workspace/src');
  vfs.mkdir('/workspace/build');

  let cwd = '/workspace/src';
  let oldPwd = '/workspace';
  const dirStack = [];

  function formatStackPath(p) {
    return p === '/workspace' ? '~' : p.replace(/^\/workspace/, '~');
  }

  function getDirs() {
    return [cwd, ...dirStack.slice().reverse()].map(formatStackPath).join(' ');
  }

  function pushd(target) {
    if (!target) {
      if (dirStack.length === 0) return 1;
      const top = dirStack.pop();
      dirStack.push(cwd);
      oldPwd = cwd;
      cwd = top;
      return 0;
    }
    if (target === '.') {
      dirStack.push(cwd);
      return 0;
    }
    const resolved = target.startsWith('/') ? target : `${cwd}/${target}`;
    if (!vfs.exists(resolved)) return 1;
    dirStack.push(cwd);
    oldPwd = cwd;
    cwd = resolved;
    return 0;
  }

  function popd() {
    if (dirStack.length === 0) return 1;
    const popped = dirStack.pop();
    oldPwd = cwd;
    cwd = popped;
    return 0;
  }

  // Initial state in /workspace/src
  assert.strictEqual(cwd, '/workspace/src');
  assert.strictEqual(getDirs(), '~/src');

  // pushd .
  assert.strictEqual(pushd('.'), 0);
  assert.strictEqual(cwd, '/workspace/src');
  assert.strictEqual(dirStack.length, 1);
  assert.strictEqual(dirStack[0], '/workspace/src');
  assert.strictEqual(getDirs(), '~/src ~/src');

  // cd /workspace
  cwd = '/workspace';
  assert.strictEqual(getDirs(), '~ ~/src');

  // popd
  assert.strictEqual(popd(), 0);
  assert.strictEqual(cwd, '/workspace/src');
  assert.strictEqual(dirStack.length, 0);
  assert.strictEqual(getDirs(), '~/src');

  // pushd build
  assert.strictEqual(pushd('/workspace/build'), 0);
  assert.strictEqual(cwd, '/workspace/build');
  assert.strictEqual(dirStack.length, 1);
  assert.strictEqual(getDirs(), '~/build ~/src');

  // popd
  assert.strictEqual(popd(), 0);
  assert.strictEqual(cwd, '/workspace/src');
  assert.strictEqual(getDirs(), '~/src');

  console.log('✓ Directory stack operations passed');
}

// Test 10: Chained command execution simulation with exit codes
{
  async function simulatePipeline(chainStr, cmdHandlers) {
    const commands = parseCommandChain(chainStr);
    let lastExitCode = 0;
    let prevOp = null;
    const executed = [];

    for (let i = 0; i < commands.length; i++) {
      const { cmd: rawCmd, op } = commands[i];
      if (!rawCmd) continue;

      if (prevOp === '&&' && lastExitCode !== 0) {
        prevOp = op;
        continue;
      }
      if (prevOp === '||' && lastExitCode === 0) {
        prevOp = op;
        continue;
      }

      executed.push(rawCmd);
      const handler = cmdHandlers[rawCmd] || (() => 0);
      lastExitCode = handler();
      prevOp = op;
    }
    return { executed, lastExitCode };
  }

  // Case A: GCC succeeds -> pushd, cd, gcc, popd all run
  let stack = [];
  let currentDir = '/workspace/src';
  const handlersA = {
    'pushd .': () => { stack.push(currentDir); return 0; },
    'cd /workspace': () => { currentDir = '/workspace'; return 0; },
    'gcc -c main.c -o build/main.o': () => 0,
    'popd': () => { currentDir = stack.pop(); return 0; },
  };

  const resA = await simulatePipeline('pushd . && cd /workspace && gcc -c main.c -o build/main.o; popd', handlersA);
  assert.deepStrictEqual(resA.executed, [
    'pushd .',
    'cd /workspace',
    'gcc -c main.c -o build/main.o',
    'popd',
  ]);
  assert.strictEqual(currentDir, '/workspace/src');
  assert.strictEqual(stack.length, 0);

  // Case B: GCC FAILS (exit code 1) -> pushd, cd, gcc run; popd still runs because of ';' delimiter!
  currentDir = '/workspace/src';
  stack = [];
  const handlersB = {
    'pushd .': () => { stack.push(currentDir); return 0; },
    'cd /workspace': () => { currentDir = '/workspace'; return 0; },
    'gcc -c bad.c -o build/bad.o': () => 1, // fails!
    'popd': () => { currentDir = stack.pop(); return 0; },
  };

  const resB = await simulatePipeline('pushd . && cd /workspace && gcc -c bad.c -o build/bad.o; popd', handlersB);
  assert.deepStrictEqual(resB.executed, [
    'pushd .',
    'cd /workspace',
    'gcc -c bad.c -o build/bad.o',
    'popd',
  ]);
  assert.strictEqual(currentDir, '/workspace/src', 'Working directory must be restored even when gcc fails');
  assert.strictEqual(stack.length, 0);

  console.log('✓ Command chaining execution with error recovery passed');
}

console.log('--- ALL SHELL TESTS PASSED ---');
