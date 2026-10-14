// Unit tests for Shell Pipelines (|) and Redirections (<, >, >>)
import assert from 'node:assert';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot } from '../src/vfs/sysroot.js';

console.log('--- Running Shell Pipeline & Redirection Unit Tests ---');

// 1. Tokenizer with Redirection Operators (<, >, >>)
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
    } else if (ch === '>' && line[i + 1] === '>') {
      if (current.length > 0 || isQuoted) {
        tokens.push({ text: current, quoted: isQuoted });
        current = '';
        isQuoted = false;
      }
      tokens.push({ text: '>>', quoted: false });
      i++;
    } else if (ch === '>' || ch === '<') {
      if (current.length > 0 || isQuoted) {
        tokens.push({ text: current, quoted: isQuoted });
        current = '';
        isQuoted = false;
      }
      tokens.push({ text: ch, quoted: false });
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

// 2. Pipeline splitter by single pipe | (excluding || and quoted pipes)
function splitPipeline(line) {
  const stages = [];
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
    } else if (ch === '|' && line[i + 1] !== '|' && (i === 0 || line[i - 1] !== '|')) {
      stages.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    stages.push(current.trim());
  }

  return stages;
}

// 3. Stage Redirection Parser
function parseStageRedirections(stageTokens) {
  const cleanTokens = [];
  let stdinRedirect = null;
  let stdoutRedirect = null;

  for (let i = 0; i < stageTokens.length; i++) {
    const token = stageTokens[i];
    if (!token.quoted) {
      if (token.text === '<') {
        const next = stageTokens[i + 1];
        if (next) {
          stdinRedirect = next.text;
          i++;
          continue;
        }
      } else if (token.text === '>') {
        const next = stageTokens[i + 1];
        if (next) {
          stdoutRedirect = { path: next.text, append: false };
          i++;
          continue;
        }
      } else if (token.text === '>>') {
        const next = stageTokens[i + 1];
        if (next) {
          stdoutRedirect = { path: next.text, append: true };
          i++;
          continue;
        }
      }
    }
    cleanTokens.push(token);
  }

  return { cleanTokens, stdinRedirect, stdoutRedirect };
}

// Test 1: Redirection tokenization (with and without surrounding spaces)
{
  const t1 = parseTokens('echo "Hello World" > out.txt');
  assert.deepStrictEqual(t1.map(t => t.text), ['echo', 'Hello World', '>', 'out.txt']);

  const t2 = parseTokens('echo "Hello World">>out.txt');
  assert.deepStrictEqual(t2.map(t => t.text), ['echo', 'Hello World', '>>', 'out.txt']);

  const t3 = parseTokens('./a.out<in.txt>out.txt');
  assert.deepStrictEqual(t3.map(t => t.text), ['./a.out', '<', 'in.txt', '>', 'out.txt']);

  const t4 = parseTokens('echo "<hello | world>"');
  assert.deepStrictEqual(t4.map(t => t.text), ['echo', '<hello | world>']);
  assert.strictEqual(t4[1].quoted, true);
  console.log('✓ Redirection tokenization passed');
}

// Test 2: Pipeline stage splitting
{
  const p1 = splitPipeline('echo "1" | cat | cat');
  assert.deepStrictEqual(p1, ['echo "1"', 'cat', 'cat']);

  const p2 = splitPipeline('echo "a | b" | ./a.out');
  assert.deepStrictEqual(p2, ['echo "a | b"', './a.out']);

  const p3 = splitPipeline('cmd1 || cmd2');
  assert.deepStrictEqual(p3, ['cmd1 || cmd2']);
  console.log('✓ Pipeline stage splitting passed');
}

// Test 3: Redirection extraction from stage tokens
{
  const tokens = parseTokens('cat < input.txt >> append.log');
  const res = parseStageRedirections(tokens);
  assert.deepStrictEqual(res.cleanTokens.map(t => t.text), ['cat']);
  assert.strictEqual(res.stdinRedirect, 'input.txt');
  assert.deepStrictEqual(res.stdoutRedirect, { path: 'append.log', append: true });
  console.log('✓ Redirection extraction from stage tokens passed');
}

// Test 4: End-to-end execution of redirections and pipelines against VFS
{
  const vfs = new VFS();
  mountSysroot(vfs);
  let cwd = '/workspace';

  function resolvePath(p) {
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

  let terminalOutput = '';
  let currentStdout = null;
  let currentStdin = null;

  function write(str) {
    if (currentStdout !== null) {
      currentStdout.data += str;
    } else {
      terminalOutput += str;
    }
  }

  function writeln(str = '') {
    if (currentStdout !== null) {
      currentStdout.data += str + '\n';
    } else {
      terminalOutput += str + '\r\n';
    }
  }

  let activeStdinReader = null;

  function readInteractiveStdin(onLine) {
    return new Promise((resolve, reject) => {
      activeStdinReader = {
        currentLine: '',
        allText: '',
        onLine,
        resolve: (val) => {
          activeStdinReader = null;
          resolve(val);
        },
        reject: (err) => {
          activeStdinReader = null;
          reject(err);
        },
      };
    });
  }

  function handleInteractiveStdinKey(key) {
    if (!activeStdinReader) return;

    for (let i = 0; i < key.length; i++) {
      if (!activeStdinReader) return;
      const ch = key[i];

      if (ch === '\x03') {
        terminalOutput += '^C\r\n';
        activeStdinReader.reject(new Error('Interrupted'));
        return;
      }

      if (ch === '\x04') {
        if (activeStdinReader.currentLine.length > 0) {
          const line = activeStdinReader.currentLine;
          activeStdinReader.currentLine = '';
          activeStdinReader.allText += line;
          if (activeStdinReader.onLine) {
            activeStdinReader.onLine(line);
          }
        } else {
          activeStdinReader.resolve(activeStdinReader.allText);
        }
        return;
      }

      if (ch === '\r' || ch === '\n') {
        terminalOutput += '\r\n';
        const lineWithNl = activeStdinReader.currentLine + '\n';
        activeStdinReader.currentLine = '';
        activeStdinReader.allText += lineWithNl;
        if (activeStdinReader.onLine) {
          activeStdinReader.onLine(lineWithNl);
        }
        continue;
      }

      if (ch === '\x7f' || ch === '\x08') {
        if (activeStdinReader.currentLine.length > 0) {
          activeStdinReader.currentLine = activeStdinReader.currentLine.slice(0, -1);
          terminalOutput += '\b \b';
        }
        continue;
      }

      if (ch >= ' ') {
        activeStdinReader.currentLine += ch;
        terminalOutput += ch;
      }
    }
  }

  const builtins = {
    echo: async (args) => {
      writeln(args.join(' '));
      return 0;
    },
    cat: async (args) => {
      if (args.length === 0) {
        if (currentStdin !== null) {
          write(currentStdin);
        } else {
          await readInteractiveStdin((line) => {
            write(line);
          });
        }
        return 0;
      }
      for (const arg of args) {
        if (arg === '-') {
          if (currentStdin !== null) {
            write(currentStdin);
          } else {
            await readInteractiveStdin((line) => {
              write(line);
            });
          }
          continue;
        }
        const target = resolvePath(arg);
        if (!vfs.exists(target)) {
          writeln(`cat: ${arg}: No such file or directory`);
          return 1;
        }
        const content = vfs.readFile(target, true);
        write(content.endsWith('\n') ? content : content + '\n');
      }
      return 0;
    },
    ls: async (args) => {
      const target = resolvePath(args[0] || '.');
      const entries = vfs.readDir(target);
      writeln(entries.map(e => e.name).join('  '));
      return 0;
    },
  };

  async function runCommandLine(line) {
    const stages = splitPipeline(line);
    let stageInput = null;
    let pipelineExitCode = 0;

    for (let s = 0; s < stages.length; s++) {
      const stageStr = stages[s];
      const isLast = (s === stages.length - 1);
      const stageTokens = parseTokens(stageStr);
      if (stageTokens.length === 0) continue;

      const { cleanTokens, stdinRedirect, stdoutRedirect } = parseStageRedirections(stageTokens);
      if (cleanTokens.length === 0) continue;

      const cmdToken = cleanTokens.shift();
      const cmd = cmdToken.text;
      const args = cleanTokens.map(t => t.text);

      let currentStdinData = null;
      if (stdinRedirect) {
        const inPath = resolvePath(stdinRedirect);
        if (!vfs.exists(inPath)) {
          writeln(`${stdinRedirect}: No such file or directory`);
          pipelineExitCode = 1;
          break;
        }
        currentStdinData = vfs.readFile(inPath, true);
      } else if (stageInput !== null) {
        currentStdinData = stageInput;
      }

      const shouldCapture = !isLast || Boolean(stdoutRedirect);
      let captured = '';

      if (shouldCapture) {
        currentStdout = { data: '' };
      }
      currentStdin = currentStdinData;

      try {
        if (builtins[cmd]) {
          const res = await builtins[cmd](args);
          pipelineExitCode = typeof res === 'number' ? res : 0;
          if (shouldCapture) {
            captured = currentStdout.data;
          }
        } else {
          writeln(`${cmd}: command not found`);
          pipelineExitCode = 127;
          break;
        }

        if (stdoutRedirect) {
          const outPath = resolvePath(stdoutRedirect.path);
          let fileContent = captured;
          if (stdoutRedirect.append && vfs.exists(outPath)) {
            const existing = vfs.readFile(outPath, true);
            fileContent = existing + captured;
          }
          vfs.writeFile(outPath, fileContent);
        }

        stageInput = captured;
      } finally {
        currentStdout = null;
        currentStdin = null;
      }

      if (pipelineExitCode !== 0 && !isLast) {
        break;
      }
    }

    return pipelineExitCode;
  }

  // Subtest 4.1: Output Redirection (>)
  await runCommandLine('echo "line 1" > /workspace/test.txt');
  assert.strictEqual(vfs.exists('/workspace/test.txt'), true);
  assert.strictEqual(vfs.readFile('/workspace/test.txt', true), 'line 1\n');
  console.log('✓ Output redirection (>) creates file with content');

  // Subtest 4.2: Output Append Redirection (>>)
  await runCommandLine('echo "line 2" >> /workspace/test.txt');
  assert.strictEqual(vfs.readFile('/workspace/test.txt', true), 'line 1\nline 2\n');
  console.log('✓ Output append redirection (>>) appends to file');

  // Subtest 4.3: Input Redirection (<)
  terminalOutput = '';
  await runCommandLine('cat < /workspace/test.txt');
  assert.strictEqual(terminalOutput, 'line 1\nline 2\n');
  console.log('✓ Input redirection (<) feeds file to stdin');

  // Subtest 4.4: Pipeline (|)
  terminalOutput = '';
  await runCommandLine('echo "piped message" | cat');
  assert.strictEqual(terminalOutput, 'piped message\n');
  console.log('✓ Pipeline (|) connects stdout to stdin');

  // Subtest 4.5: Multi-stage Pipeline (| ... | ...)
  terminalOutput = '';
  await runCommandLine('echo "multi-stage" | cat | cat');
  assert.strictEqual(terminalOutput, 'multi-stage\n');
  console.log('✓ Multi-stage pipeline (| ... | ...) verified');

  // Subtest 4.6: Pipeline combined with Output Redirection
  await runCommandLine('echo "pipeline to file" | cat > /workspace/piped.txt');
  assert.strictEqual(vfs.readFile('/workspace/piped.txt', true), 'pipeline to file\n');
  console.log('✓ Pipeline with output redirection verified');

  // Subtest 4.7: Input redirection combined with Output Redirection
  await runCommandLine('cat < /workspace/piped.txt > /workspace/copied.txt');
  assert.strictEqual(vfs.readFile('/workspace/copied.txt', true), 'pipeline to file\n');
  console.log('✓ Input and output redirection combined verified');

  // Subtest 4.8: Missing input file reports error
  terminalOutput = '';
  const code = await runCommandLine('cat < /workspace/missing.txt');
  assert.strictEqual(code, 1);
  assert.strictEqual(terminalOutput.includes('missing.txt: No such file or directory'), true);
  console.log('✓ Missing input file error handling verified');

  // Subtest 4.9: Interactive cat reading until Ctrl-D
  terminalOutput = '';
  const catPromise = runCommandLine('cat');
  // Simulate user typing "hello\nworld\n" and pressing Ctrl-D
  assert.notStrictEqual(activeStdinReader, null);
  handleInteractiveStdinKey('hello\n');
  handleInteractiveStdinKey('world\n');
  handleInteractiveStdinKey('\x04'); // Ctrl-D EOF
  await catPromise;
  assert.strictEqual(terminalOutput.includes('hello'), true);
  assert.strictEqual(terminalOutput.includes('world'), true);
  console.log('✓ Interactive cat reads stdin until Ctrl-D');

  // Subtest 4.10: Interactive cat - reading until Ctrl-D
  terminalOutput = '';
  const catDashPromise = runCommandLine('cat -');
  assert.notStrictEqual(activeStdinReader, null);
  handleInteractiveStdinKey('dash stdin\n\x04');
  await catDashPromise;
  assert.strictEqual(terminalOutput.includes('dash stdin'), true);
  console.log('✓ Interactive cat - reads stdin until Ctrl-D');

  // Subtest 4.11: Interactive cat > file reading until Ctrl-D
  terminalOutput = '';
  const catRedirectPromise = runCommandLine('cat > /workspace/interactive.txt');
  assert.notStrictEqual(activeStdinReader, null);
  handleInteractiveStdinKey('Line A\nLine B\n\x04');
  await catRedirectPromise;
  assert.strictEqual(vfs.readFile('/workspace/interactive.txt', true), 'Line A\nLine B\n');
  console.log('✓ Interactive cat > file writes stdin to file until Ctrl-D');
}

console.log('--- ALL SHELL PIPELINE & REDIRECTION TESTS PASSED ---');
