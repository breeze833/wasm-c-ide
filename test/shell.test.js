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

// Test 4: Command path normalization (/bin/ls -> ls, /usr/bin/gcc -> gcc, /usr/bin/g++ -> g++)
function normalizeCommand(cmd) {
  if (cmd.startsWith('/bin/') || cmd.startsWith('/usr/bin/')) {
    return cmd.split('/').pop();
  }
  return cmd;
}
assert.strictEqual(normalizeCommand('/bin/ls'), 'ls');
assert.strictEqual(normalizeCommand('/usr/bin/gcc'), 'gcc');
assert.strictEqual(normalizeCommand('/usr/bin/g++'), 'g++');
assert.strictEqual(normalizeCommand('/usr/bin/clang++'), 'clang++');
assert.strictEqual(normalizeCommand('make'), 'make');
console.log('✓ Command path normalization passed');

// Test 5: which resolution
function resolveWhich(name) {
  if (['sh', 'ls', 'cat', 'rm', 'mkdir', 'cp', 'mv', 'pwd', 'clear', 'echo'].includes(name)) {
    return `/bin/${name}`;
  } else if (['gcc', 'clang', 'g++', 'clang++', 'make', 'wasm-ld'].includes(name)) {
    return `/usr/bin/${name}`;
  }
  return null;
}
assert.strictEqual(resolveWhich('ls'), '/bin/ls');
assert.strictEqual(resolveWhich('gcc'), '/usr/bin/gcc');
assert.strictEqual(resolveWhich('g++'), '/usr/bin/g++');
assert.strictEqual(resolveWhich('clang++'), '/usr/bin/clang++');
assert.strictEqual(resolveWhich('make'), '/usr/bin/make');
assert.strictEqual(resolveWhich('sh'), '/bin/sh');
console.log('✓ which path resolution passed');

import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot } from '../src/vfs/sysroot.js';

// Test 5.1: Sysroot mounts g++ and clang++
{
  const vfs = new VFS();
  mountSysroot(vfs);
  assert.strictEqual(vfs.exists('/usr/bin/gcc'), true);
  assert.strictEqual(vfs.exists('/usr/bin/g++'), true);
  assert.strictEqual(vfs.exists('/usr/bin/clang++'), true);
  console.log('✓ sysroot mounts g++ and clang++ under /usr/bin');
}

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

// Test 11: mv and cp directory destination variants (mv a.out src, mv a.out src/, etc.)
{
  const vfs = new VFS();
  mountSysroot(vfs);
  vfs.mkdir('/workspace/src');
  vfs.mkdir('/workspace/build');

  let output = [];
  function writeln(msg) { output.push(msg); }

  function resolvePath(p, cwd = '/workspace') {
    if (!p) return cwd;
    let target = p.startsWith('/') ? p : `${cwd}/${p}`;
    const parts = target.split('/').filter(Boolean);
    const resolved = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        if (resolved.length > 0) resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return '/' + resolved.join('/');
  }

  async function mockMv(args, cwd = '/workspace') {
    const operands = [];
    for (const arg of args) {
      if (arg.startsWith('-') && arg.length > 1) {}
      else operands.push(arg);
    }
    if (operands.length === 0) {
      writeln('mv: missing file operand');
      return 1;
    }
    if (operands.length === 1) {
      writeln(`mv: missing destination file operand after '${operands[0]}'`);
      return 1;
    }

    const destRaw = operands[operands.length - 1];
    const sourcesRaw = operands.slice(0, operands.length - 1);
    const destNorm = resolvePath(destRaw, cwd);
    const destStat = vfs.stat(destNorm);
    const destIsDir = destStat && destStat.isDir;
    const destEndsWithSlash = destRaw.endsWith('/');

    if (sourcesRaw.length > 1 && !destIsDir) {
      writeln(`mv: target '${destRaw}' is not a directory`);
      return 1;
    }

    if (destEndsWithSlash && !destIsDir && !destStat) {
      writeln(`mv: cannot move to '${destRaw}': Not a directory`);
      return 1;
    }

    let hasError = false;
    for (const srcRaw of sourcesRaw) {
      const srcNorm = resolvePath(srcRaw, cwd);
      const srcStat = vfs.stat(srcNorm);
      if (!srcStat) {
        writeln(`mv: cannot stat '${srcRaw}': No such file or directory`);
        hasError = true;
        continue;
      }
      if (srcNorm === '/' || srcNorm === '/workspace') {
        writeln(`mv: cannot move root or workspace: '${srcRaw}'`);
        hasError = true;
        continue;
      }

      const srcBase = srcNorm.split('/').filter(Boolean).pop();
      let targetPath;
      if (destIsDir) {
        targetPath = destNorm === '/' ? `/${srcBase}` : `${destNorm}/${srcBase}`;
      } else {
        targetPath = destNorm;
      }

      if (srcNorm === targetPath) {
        writeln(`mv: '${srcRaw}' and '${destRaw}' are the same file`);
        hasError = true;
        continue;
      }

      if (srcStat.isDir && (targetPath + '/').startsWith(srcNorm + '/')) {
        writeln(`mv: cannot move '${srcRaw}' to a subdirectory of itself, '${destRaw}'`);
        hasError = true;
        continue;
      }

      try {
        vfs.rename(srcNorm, targetPath);
      } catch (err) {
        writeln(`mv: cannot move '${srcRaw}' to '${destRaw}': ${err.message}`);
        hasError = true;
      }
    }
    return hasError ? 1 : 0;
  }

  async function mockCp(args, cwd = '/workspace') {
    let recursive = false;
    const operands = [];
    for (const arg of args) {
      if (arg === '-r' || arg === '-R' || arg === '-rf' || arg === '-fr') recursive = true;
      else if (!arg.startsWith('-')) operands.push(arg);
    }
    if (operands.length < 2) return 1;

    const destRaw = operands[operands.length - 1];
    const sourcesRaw = operands.slice(0, operands.length - 1);
    const destNorm = resolvePath(destRaw, cwd);
    const destStat = vfs.stat(destNorm);
    const destIsDir = destStat && destStat.isDir;
    const destEndsWithSlash = destRaw.endsWith('/');

    if (sourcesRaw.length > 1 && !destIsDir) return 1;
    if (destEndsWithSlash && !destIsDir && !destStat) return 1;

    function copyEntry(srcPath, dstPath) {
      const stat = vfs.stat(srcPath);
      if (stat.isDir) {
        if (!recursive) throw new Error('-r not specified');
        vfs.mkdir(dstPath);
        for (const entry of vfs.readDir(srcPath)) {
          copyEntry(`${srcPath}/${entry.name}`, `${dstPath}/${entry.name}`);
        }
      } else {
        vfs.writeFile(dstPath, vfs.readFile(srcPath, false));
      }
    }

    for (const srcRaw of sourcesRaw) {
      const srcNorm = resolvePath(srcRaw, cwd);
      const srcBase = srcNorm.split('/').filter(Boolean).pop();
      const targetPath = destIsDir ? `${destNorm}/${srcBase}` : destNorm;
      copyEntry(srcNorm, targetPath);
    }
    return 0;
  }

  // Case 1: mv a.out src (target directory without trailing slash)
  vfs.writeFile('/workspace/a.out', 'bin-mv-1');
  const code1 = await mockMv(['a.out', 'src']);
  assert.strictEqual(code1, 0);
  assert.strictEqual(vfs.exists('/workspace/a.out'), false);
  assert.strictEqual(vfs.exists('/workspace/src/a.out'), true);
  assert.strictEqual(vfs.readFile('/workspace/src/a.out', true), 'bin-mv-1');

  // Case 2: mv a.out src/ (target directory with trailing slash)
  vfs.writeFile('/workspace/a.out', 'bin-mv-2');
  const code2 = await mockMv(['a.out', 'src/']);
  assert.strictEqual(code2, 0);
  assert.strictEqual(vfs.exists('/workspace/a.out'), false);
  assert.strictEqual(vfs.readFile('/workspace/src/a.out', true), 'bin-mv-2');

  // Case 3: mv a.out src/a.out (explicit target file path)
  vfs.writeFile('/workspace/a.out', 'bin-mv-3');
  const code3 = await mockMv(['a.out', 'src/a.out']);
  assert.strictEqual(code3, 0);
  assert.strictEqual(vfs.exists('/workspace/a.out'), false);
  assert.strictEqual(vfs.readFile('/workspace/src/a.out', true), 'bin-mv-3');

  // Case 4: mv multiple files into directory: mv f1 f2 src/
  vfs.writeFile('/workspace/f1', 'c1');
  vfs.writeFile('/workspace/f2', 'c2');
  const code4 = await mockMv(['f1', 'f2', 'src/']);
  assert.strictEqual(code4, 0);
  assert.strictEqual(vfs.exists('/workspace/src/f1'), true);
  assert.strictEqual(vfs.exists('/workspace/src/f2'), true);

  // Case 5: mv a.out nonexistent/ (fails because trailing slash requires directory)
  vfs.writeFile('/workspace/a.out', 'bin-mv-5');
  const code5 = await mockMv(['a.out', 'nonexistent/']);
  assert.strictEqual(code5, 1);
  assert.strictEqual(vfs.exists('/workspace/a.out'), true);

  // Case 6: cp a.out src/ and cp a.out src
  const cpCode1 = await mockCp(['a.out', 'src/']);
  assert.strictEqual(cpCode1, 0);
  assert.strictEqual(vfs.exists('/workspace/a.out'), true);
  assert.strictEqual(vfs.readFile('/workspace/src/a.out', true), 'bin-mv-5');

  // Case 7: cp -r src backup/
  const cpCode2 = await mockCp(['-r', 'src', 'backup']);
  assert.strictEqual(cpCode2, 0);
  assert.strictEqual(vfs.exists('/workspace/backup/a.out'), true);
  assert.strictEqual(vfs.exists('/workspace/backup/f1'), true);

  console.log('✓ mv and cp directory destination variants passed');
}

// Test 14: Direct script execution (./build.sh, /workspace/test.sh, custom.sh)
{
  const vfs = new VFS();
  let executedCmds = [];

  const mockExecuteCommandLine = async (line) => {
    executedCmds.push(line);
    return 0;
  };

  const resolvePath = (p, currentCwd = '/workspace') => {
    if (!p) return currentCwd;
    let target = p.startsWith('/') ? p : `${currentCwd}/${p}`;
    const parts = target.split('/').filter(Boolean);
    const resolved = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        if (resolved.length > 0) resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return '/' + resolved.join('/');
  };

  const mockSh = async (args) => {
    if (args.length === 0) return 1;
    const scriptPath = resolvePath(args[0]);
    try {
      const scriptContent = vfs.readFile(scriptPath, true);
      const lines = scriptContent.split('\n');
      let code = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        code = await mockExecuteCommandLine(trimmed);
      }
      return code;
    } catch {
      return 1;
    }
  };

  const mockDispatch = async (cmd, args, currentCwd = '/workspace') => {
    let isScript = false;
    let scriptPathToRun = null;
    if (cmd.startsWith('./') || cmd.startsWith('/') || cmd.endsWith('.sh')) {
      const targetPath = resolvePath(cmd, currentCwd);
      const fileExists = vfs.exists(targetPath);
      if (fileExists) {
        try {
          const content = vfs.readFile(targetPath, true);
          if (content.startsWith('#!') || cmd.endsWith('.sh')) {
            isScript = true;
            scriptPathToRun = targetPath;
          }
        } catch {
          // Fall through
        }
      }
    }

    if (isScript && scriptPathToRun) {
      return await mockSh([scriptPathToRun, ...args]);
    }
    return 127; // command not found
  };

  // Case 1: ./build.sh with shebang
  vfs.writeFile('/workspace/build.sh', '#!/bin/sh\ngcc src/main.c -o a.out\necho "Build done"');
  executedCmds = [];
  const exit1 = await mockDispatch('./build.sh', []);
  assert.strictEqual(exit1, 0);
  assert.deepStrictEqual(executedCmds, ['gcc src/main.c -o a.out', 'echo "Build done"']);

  // Case 2: Full path /workspace/build.sh
  executedCmds = [];
  const exit2 = await mockDispatch('/workspace/build.sh', []);
  assert.strictEqual(exit2, 0);
  assert.deepStrictEqual(executedCmds, ['gcc src/main.c -o a.out', 'echo "Build done"']);

  // Case 3: Script without shebang but ending in .sh
  vfs.writeFile('/workspace/clean.sh', 'rm -rf build a.out\necho "Cleaned"');
  executedCmds = [];
  const exit3 = await mockDispatch('./clean.sh', []);
  assert.strictEqual(exit3, 0);
  assert.deepStrictEqual(executedCmds, ['rm -rf build a.out', 'echo "Cleaned"']);

  // Case 4: Custom executable script without .sh extension but starting with #!
  vfs.writeFile('/workspace/run_all', '#!/bin/sh\n./a.out\necho "Ran"');
  executedCmds = [];
  const exit4 = await mockDispatch('./run_all', []);
  assert.strictEqual(exit4, 0);
  assert.deepStrictEqual(executedCmds, ['./a.out', 'echo "Ran"']);

  // Case 5: Wasm binary should NOT be detected as script
  vfs.writeFile('/workspace/a.out', new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
  const exit5 = await mockDispatch('./a.out', []);
  assert.strictEqual(exit5, 127, 'Wasm binary must not be dispatched as shell script');

  console.log('✓ direct shell script execution (./build.sh, /path/to/script, #! shebang) passed');
}

console.log('--- ALL SHELL TESTS PASSED ---');
