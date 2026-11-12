// Web Worker: POSIX Shell Worker powered by busybox-wasi (ash)
// Combines LineEditor frontend UX with true in-memory BusyBox ash scripting

if (typeof self === 'undefined') {
  globalThis.self = globalThis;
  if (!globalThis.postMessage) {
    globalThis.postMessage = () => {};
  }
}

import { LineEditor } from '../terminal/line-editor.js';
import { VFS, normalizePath } from '../vfs/vfs.js';
import { mountSysroot, BIN_COMMANDS } from '../vfs/sysroot.js';
import { WasiHost, ProcExit, ESUCCESS } from '../vfs/wasi-host.js';
import { getWasmModule, saveWasmModule } from '../toolchain/wasm-cache.js';

const CACHE_KEY = 'busybox-1.38.0-r1';

let cwd = '/workspace';
let isExecuting = false;
let isInitialized = false;
let termRows = 24;
let termCols = 80;
let multiLineBuffer = [];

let shellEnviron = {
  USER: 'student',
  HOME: '/workspace',
  PWD: cwd,
  PATH: '/bin:/usr/bin:/workspace',
};

const TOOLCHAIN_COMMANDS = new Set([
  'gcc',
  'g++',
  'clang',
  'clang++',
  'clang-cpp',
  'ld',
  'lld',
  'wasm-ld',
  'ld.lld',
  'make',
  'ar',
  'ranlib',
  'nm',
  'objdump',
  'size',
  'c++filt',
  'cxxfilt',
  'strings',
  'readelf',
  'strip',
  'sqlite3',
]);

const SHELL_BUILTINS = new Set([
  'cd',
  'pushd',
  'popd',
  'dirs',
  'alias',
  'unalias',
  'type',
  'help',
  'exit',
  'return',
  'exec',
  'eval',
  '.',
  'source',
  'set',
  'export',
  'unset',
]);

const BIN_COMMANDS_SET = new Set(BIN_COMMANDS);

const vfs = new VFS();
let busyboxModule = null;

let sharedInt32 = null;
let sharedUint8 = null;
const CONTROL_IDX = 0; // 0 = idle, 1 = waiting, 2 = done
const RESULT_IDX = 1;  // exitCode

// Synchronous stdin control for shell applets (cat, read, etc.)
const STDIN_STATE_IDX = 4;
const STDIN_LEN_IDX = 5;
const STDIN_READ_POS_IDX = 6;

const STDIN_STATE_IDLE = 0;
const STDIN_STATE_WAITING = 1;
const STDIN_STATE_READY = 2;
const STDIN_STATE_EOF = -1;

const STDIN_DATA_OFFSET = 32;

function readStdin(iovs, iovs_len, nread_out, host) {
  let totalRead = 0;

  for (let i = 0; i < iovs_len; i++) {
    const bufPtr = host.memU32()[(iovs >> 2) + i * 2];
    const bufLen = host.memU32()[(iovs >> 2) + i * 2 + 1];

    let available = 0;
    let curLen = 0;
    let curPos = 0;

    if (sharedInt32) {
      curLen = Atomics.load(sharedInt32, STDIN_LEN_IDX);
      curPos = Atomics.load(sharedInt32, STDIN_READ_POS_IDX);
      available = curLen - curPos;
    }

    if (available <= 0 && sharedInt32) {
      // Set state to WAITING before notifying host to prevent race
      Atomics.store(sharedInt32, STDIN_STATE_IDX, STDIN_STATE_WAITING);

      // Notify main thread that shell/applet is waiting for stdin input
      self.postMessage({ type: 'stdin_request' });

      // Block worker until main thread issues Atomics.notify()
      Atomics.wait(sharedInt32, STDIN_STATE_IDX, STDIN_STATE_WAITING);

      const state = Atomics.load(sharedInt32, STDIN_STATE_IDX);
      if (state === STDIN_STATE_EOF) {
        break;
      }

      curLen = Atomics.load(sharedInt32, STDIN_LEN_IDX);
      curPos = Atomics.load(sharedInt32, STDIN_READ_POS_IDX);
      available = curLen - curPos;
    }

    if (available > 0 && sharedInt32 && sharedUint8) {
      curPos = Atomics.load(sharedInt32, STDIN_READ_POS_IDX);
      const toCopy = Math.min(bufLen, available);
      const target = host.memU8().subarray(bufPtr, bufPtr + toCopy);
      const source = sharedUint8.subarray(STDIN_DATA_OFFSET + curPos, STDIN_DATA_OFFSET + curPos + toCopy);

      target.set(source);
      Atomics.add(sharedInt32, STDIN_READ_POS_IDX, toCopy);
      totalRead += toCopy;
    }

    if (totalRead > 0) break;
  }

  host.memU32()[nread_out >> 2] = totalRead;
  return ESUCCESS;
}

const shellEditor = new LineEditor({
  write: (str) => write(str),
  historyContext: 'shell',
});

function write(str) {
  self.postMessage({ type: 'term_write', data: str });
}

function writeln(str = '') {
  self.postMessage({ type: 'term_write', data: str + '\r\n' });
}

function getPrompt() {
  const displayCwd = cwd === '/workspace' ? '~' : cwd.replace(/^\/workspace/, '~');
  return `\x1b[1;32mide\x1b[0m:\x1b[1;34m${displayCwd}\x1b[0m$ `;
}

function getActivePrompt() {
  return multiLineBuffer.length > 0 ? '> ' : getPrompt();
}

function showPrompt() {
  shellEditor.reset();
  write(getActivePrompt());
}

function resolvePath(p, currentCwd = cwd) {
  if (!p) return currentCwd;
  let target = p.startsWith('/') ? p : `${currentCwd}/${p}`;
  return normalizePath(target);
}

function getWorkspaceSnapshot() {
  const fileMap = new Map();
  const dirSet = new Set();
  const all = vfs.getAllFiles('/workspace');
  for (const f of all) {
    if (!f.isDir) {
      fileMap.set(f.path, {
        mtime: f.mtime,
        length: f.content ? f.content.length : 0,
      });
    } else {
      dirSet.add(f.path);
    }
  }
  return { fileMap, dirSet };
}

function getWorkspaceDiff(beforeSnapshot) {
  const changedFiles = {};
  const deletedFiles = [];
  const createdDirs = [];
  const deletedDirs = [];
  const currentFiles = new Set();
  const currentDirs = new Set();

  const all = vfs.getAllFiles('/workspace');
  for (const f of all) {
    if (!f.isDir) {
      currentFiles.add(f.path);
      const before = beforeSnapshot.fileMap.get(f.path);
      if (!before || before.mtime !== f.mtime || before.length !== (f.content ? f.content.length : 0)) {
        changedFiles[f.path] = { content: f.content, mtime: f.mtime };
      }
    } else {
      currentDirs.add(f.path);
      if (!beforeSnapshot.dirSet.has(f.path)) {
        createdDirs.push(f.path);
      }
    }
  }

  for (const p of beforeSnapshot.fileMap.keys()) {
    if (!currentFiles.has(p)) {
      deletedFiles.push(p);
    }
  }

  for (const p of beforeSnapshot.dirSet) {
    if (!currentDirs.has(p)) {
      deletedDirs.push(p);
    }
  }

  return { changedFiles, deletedFiles, createdDirs, deletedDirs };
}

// Synchronous host dispatch via SharedArrayBuffer + Atomics.wait
function execHostCommandSync(payload) {
  if (sharedInt32) {
    Atomics.store(sharedInt32, RESULT_IDX, 0);
    Atomics.store(sharedInt32, CONTROL_IDX, 1);
    self.postMessage({ type: 'host_spawn_request', payload });

    while (Atomics.load(sharedInt32, CONTROL_IDX) === 1) {
      Atomics.wait(sharedInt32, CONTROL_IDX, 1, 100);
    }
    return Atomics.load(sharedInt32, RESULT_IDX);
  }

  // Fallback for non-SharedArrayBuffer contexts
  self.postMessage({ type: 'host_spawn_request', payload });
  return 0;
}

async function loadBusyboxBinary(basePath) {
  // 1. Try persistent IndexedDB cache
  try {
    const cached = await getWasmModule(CACHE_KEY);
    if (cached instanceof WebAssembly.Module) {
      return cached;
    }
  } catch (_) {}

  // 2. Fetch from network or VFS
  const url = `${basePath}/busybox.wasm`;
  let arrayBuf = null;

  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res && (res.ok || typeof res.ok === 'undefined')) {
      arrayBuf = await res.arrayBuffer();
    }
  } catch (_) {}

  if (!arrayBuf && vfs.exists('/bin/busybox')) {
    const bytes = vfs.readFile('/bin/busybox', false);
    if (bytes && bytes.length > 0) {
      arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  }

  if (!arrayBuf) {
    throw new Error(`Failed to load busybox.wasm from ${url}`);
  }

  // 3. Compile and save to cache
  const mod = await WebAssembly.compile(arrayBuf);
  saveWasmModule(CACHE_KEY, arrayBuf).catch(() => {});
  return mod;
}

let dirStackStr = '';

function getShellPreamble(stack) {
  return `_DIR_STACK="${stack}"; _save_dstack() { __host_update_dstack "$_DIR_STACK"; }; pushd() { if [ -z "$1" ]; then echo "pushd: no other directory" >&2; return 1; fi; _DIR_STACK="$(pwd)|\${_DIR_STACK}"; _save_dstack; cd "$1" || return 1; dirs; }; popd() { if [ -z "$_DIR_STACK" ]; then echo "popd: directory stack empty" >&2; return 1; fi; _TARGET="\${_DIR_STACK%%|*}"; _DIR_STACK="\${_DIR_STACK#*|}"; _save_dstack; cd "$_TARGET" || return 1; dirs; }; dirs() { _res="$(pwd)"; _rest="$_DIR_STACK"; while [ -n "$_rest" ]; do _d="\${_rest%%|*}"; _rest="\${_rest#*|}"; if [ -n "$_d" ]; then _res="$_res $_d"; fi; done; echo "$_res"; };`;
}

function findHeredocs(line) {
  const heredocs = [];
  let inSingle = false;
  let inDouble = false;
  let isEscaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (isEscaped) { isEscaped = false; continue; }
    if (ch === '\\' && !inSingle) { isEscaped = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }

    if (!inSingle && !inDouble) {
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
      if (ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<' && (i === 0 || line[i - 1] !== '<')) {
        let idx = i + 2;
        let stripTabs = false;
        if (line[idx] === '-') { stripTabs = true; idx++; }
        while (idx < line.length && (line[idx] === ' ' || line[idx] === '\t')) idx++;
        let word = '';
        while (idx < line.length && !/[\s;|<>&()]/.test(line[idx])) { word += line[idx]; idx++; }
        const cleanDelim = word.replace(/^(['"])(.*)\1$/, '$2').replace(/^\\/, '');
        if (cleanDelim.length > 0) heredocs.push({ delim: cleanDelim, stripTabs });
        i = idx - 1;
      }
    }
  }
  return heredocs;
}

function getPendingHeredocs(lines) {
  const pending = [];
  for (const line of lines) {
    if (pending.length > 0) {
      const cur = pending[0];
      const checkLine = cur.stripTabs ? line.replace(/^\t+/, '') : line;
      if (checkLine === cur.delim) {
        pending.shift();
      }
    } else {
      const found = findHeredocs(line);
      for (const h of found) pending.push(h);
    }
  }
  return pending;
}

function checkHeredocPending(lines) {
  return getPendingHeredocs(lines).length > 0;
}

function closePendingHeredocs(lines) {
  const pending = getPendingHeredocs(lines);
  if (pending.length === 0) {
    return lines.join('\n');
  }
  const result = [...lines];
  for (const h of pending) {
    result.push(h.delim);
  }
  return result.join('\n');
}

function checkSyntaxEof(fullText) {
  if (!busyboxModule) return false;
  let err = '';
  let code = 0;
  const host = new WasiHost({
    vfs,
    cwd,
    argv: ['busybox', 'sh', '-n', '-c', fullText],
    stdout: () => {},
    stderr: (s) => err += s,
  });
  const inst = new WebAssembly.Instance(busyboxModule, host.createImportObject());
  host.getMemory = () => inst.exports.memory;
  try { inst.exports._start(); } catch (e) { code = (e && typeof e.code === 'number') ? e.code : 0; }
  return code !== 0 && (err.includes('unexpected end of file') || err.includes('unterminated quoted string'));
}

function isCommandIncomplete(lines) {
  if (lines.length === 0) return false;
  if (checkHeredocPending(lines)) return true;

  const lastLine = lines[lines.length - 1];
  let backslashes = 0;
  for (let i = lastLine.length - 1; i >= 0 && lastLine[i] === '\\'; i--) {
    backslashes++;
  }
  if (backslashes % 2 === 1) return true;

  if (/(?:\||\|\||&&)\s*$/.test(lastLine)) return true;

  return checkSyntaxEof(lines.join('\n'));
}

function hasUnquotedShellOperators(line) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let isEscaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (ch === '\\' && !inSingleQuote) {
      return true;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (
        ch === '|' ||
        ch === '&' ||
        ch === ';' ||
        ch === '<' ||
        ch === '>' ||
        ch === '$' ||
        ch === '`' ||
        ch === '*' ||
        ch === '?' ||
        ch === '(' ||
        ch === ')' ||
        ch === '{' ||
        ch === '}' ||
        ch === '\n'
      ) {
        return true;
      }
    } else if (inDoubleQuote) {
      if (ch === '$' || ch === '`') {
        return true;
      }
    }
  }

  return false;
}

function tokenizeSimpleCommand(line) {
  const tokens = [];
  let current = '';
  let inQuote = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function isHostBuiltin(name) {
  if (
    name === '__host_update_pwd' ||
    name === '__host_update_dstack' ||
    name === '__host_exec' ||
    name === 'time' ||
    name === 'clear' ||
    TOOLCHAIN_COMMANDS.has(name) ||
    name.startsWith('./') ||
    name.startsWith('/') ||
    vfs.exists(`${cwd}/${name}`) ||
    vfs.exists(`/workspace/${name}`) ||
    vfs.exists(`/usr/bin/${name}`)
  ) {
    return 1;
  }
  return 0;
}

function handleHostBuiltinRun({ cwd: runCwd, argc, argv, envp }, defaultEnviron) {
  let cmd = argv[0];
  let args = argv.slice(1);

  if (cmd === '__host_update_pwd') {
    const newPwd = args[0] ? args[0].trim() : '';
    if (newPwd && newPwd !== cwd && (vfs.exists(newPwd) || newPwd === '/')) {
      cwd = newPwd;
      shellEnviron.PWD = cwd;
      self.postMessage({ type: 'cwd_changed', cwd });
    }
    return 0;
  }

  if (cmd === '__host_update_dstack') {
    dirStackStr = args[0] || '';
    return 0;
  }

  if (cmd === '__host_exec') {
    cmd = args[0];
    args = args.slice(1);
  }

  if (cmd === 'clear') {
    write('\x1b[2J\x1b[H');
    return 0;
  }

  const runEnviron = { ...(defaultEnviron || shellEnviron), PWD: runCwd || cwd };
  if (Array.isArray(envp)) {
    for (const entry of envp) {
      if (typeof entry === 'string') {
        const eqIdx = entry.indexOf('=');
        if (eqIdx !== -1) {
          runEnviron[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
        }
      }
    }
  } else if (envp && typeof envp === 'object') {
    Object.assign(runEnviron, envp);
  }

  if (cmd === 'time') {
    const subCmd = args[0];
    if (!subCmd) {
      write('time: missing command\r\n');
      return 1;
    }
    const timeStart = performance.now();
    let targetCmd = subCmd;
    let targetArgs = args.slice(1);
    if (targetCmd === '__host_exec') {
      targetCmd = targetArgs[0];
      targetArgs = targetArgs.slice(1);
    }
    const code = execHostCommandSync({
      cmd: targetCmd,
      args: targetArgs,
      cwd: runCwd || cwd,
      environ: runEnviron,
    });
    const elapsed = ((performance.now() - timeStart) / 1000).toFixed(3);
    write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
    return code;
  }

  if (cmd.startsWith('./') || cmd.startsWith('/')) {
    const targetPath = resolvePath(cmd, runCwd || cwd);
    if (!vfs.exists(targetPath)) {
      write(`${cmd}: not found\r\n`);
      return 127;
    }
  }

  return execHostCommandSync({
    cmd,
    args,
    cwd: runCwd || cwd,
    environ: runEnviron,
  });
}

function syncWorkspaceDiff(beforeSnapshot) {
  const { changedFiles, deletedFiles, createdDirs, deletedDirs } = getWorkspaceDiff(beforeSnapshot);
  if (
    Object.keys(changedFiles).length > 0 ||
    deletedFiles.length > 0 ||
    createdDirs.length > 0 ||
    deletedDirs.length > 0
  ) {
    self.postMessage({
      type: 'vfs_sync',
      changedFiles,
      deletedFiles,
      createdDirs,
      deletedDirs,
    });
  }
}

const SCRIPT_PREAMBLE = `_DIR_STACK=""; pushd() { if [ -z "$1" ]; then echo "pushd: no other directory" >&2; return 1; fi; _DIR_STACK="$(pwd)|\${_DIR_STACK}"; cd "$1" || return 1; dirs; }; popd() { if [ -z "$_DIR_STACK" ]; then echo "popd: directory stack empty" >&2; return 1; fi; _TARGET="\${_DIR_STACK%%|*}"; _DIR_STACK="\${_DIR_STACK#*|}"; cd "$_TARGET" || return 1; dirs; }; dirs() { _res="$(pwd)"; _rest="$_DIR_STACK"; while [ -n "$_rest" ]; do _d="\${_rest%%|*}"; _rest="\${_rest#*|}"; if [ -n "$_d" ]; then _res="$_res $_d"; fi; done; echo "$_res"; };`;

async function runScriptFile(scriptPath, args, environ, isTimed, beforeMap) {
  const t0 = performance.now();
  const wasiHost = new WasiHost({
    vfs,
    cwd,
    argv: ['busybox', 'sh', '-c', `cd "$1" || exit 1; shift; ${SCRIPT_PREAMBLE} . "$@"`, 'sh', cwd, scriptPath, ...args],
    environ,
    stdin: readStdin,
    stdout: (str) => write(str),
    stderr: (str) => write(str),
    rows: termRows,
    cols: termCols,
    hostBuiltinLookup: (name) => isHostBuiltin(name),
    hostBuiltinRun: (params) => handleHostBuiltinRun(params, environ),
  });

  const imports = wasiHost.createImportObject();
  const instance = new WebAssembly.Instance(busyboxModule, imports);
  wasiHost.getMemory = () => instance.exports.memory;

  let exitCode = 0;
  try {
    instance.exports._start();
  } catch (err) {
    if (err instanceof ProcExit) {
      exitCode = err.code;
    } else {
      writeln(`\x1b[31mScript error: ${err.message || String(err)}\x1b[0m`);
      exitCode = 1;
    }
  }

  if (isTimed) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
    write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
  }

  syncWorkspaceDiff(beforeMap);
  return exitCode;
}

function wrapHostExecutables(cmdLine) {
  const lines = cmdLine.split('\n');
  const pending = [];
  const resultLines = [];

  for (const line of lines) {
    if (pending.length > 0) {
      resultLines.push(line);
      const cur = pending[0];
      const checkLine = cur.stripTabs ? line.replace(/^\t+/, '') : line;
      if (checkLine === cur.delim) {
        pending.shift();
      }
    } else {
      const wrappedLine = line.replace(/(^|[;&|\n]\s*|\btime\s+)(\.{1,2}\/[^\s;&|<>]+|\/[^\s;&|<>]+)/g, (match, prefix, target) => {
        const resolved = resolvePath(target);
        if (vfs.exists(resolved)) {
          const bytes = vfs.readFile(resolved, false);
          if (bytes && bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) {
            // Starts with #! -> script, let ash handle it directly
            return match;
          }
        }
        return `${prefix}__host_exec ${target}`;
      });
      resultLines.push(wrappedLine);

      const found = findHeredocs(line);
      for (const h of found) {
        pending.push(h);
      }
    }
  }

  return resultLines.join('\n');
}

async function executeCommandLine(toExecute) {
  if (!busyboxModule) {
    writeln('sh: busybox binary not initialized');
    return;
  }

  const beforeMap = getWorkspaceSnapshot();

  const trimmed = toExecute.trim();
  if (!trimmed) return;

  const isTimed = /^\s*time(\s+|$)/.test(trimmed);
  const actualCmd = isTimed ? trimmed.replace(/^\s*time\s*/, '').trim() : trimmed;
  if (!actualCmd) {
    if (isTimed) {
      write('time: missing command\r\n');
    }
    return;
  }

  // Check if command line has unquoted shell constructs (pipes, redirections, expansions, etc.)
  const hasShellConstructs = hasUnquotedShellOperators(actualCmd);

  if (!hasShellConstructs) {
    const tokens = tokenizeSimpleCommand(actualCmd);
    let tokenIdx = 0;
    const envOverrides = {};
    const envAssignRegex = /^[A-Za-z_][A-Za-z0-9_]*=/;

    while (tokenIdx < tokens.length && envAssignRegex.test(tokens[tokenIdx])) {
      const token = tokens[tokenIdx];
      const eqIdx = token.indexOf('=');
      const key = token.slice(0, eqIdx);
      const val = token.slice(eqIdx + 1);
      envOverrides[key] = val;
      tokenIdx++;
    }

    // Standalone variable assignments: VAR="val" ...
    if (tokenIdx === tokens.length) {
      Object.assign(shellEnviron, envOverrides);
      shellEnviron.PWD = cwd;
      return;
    }

    const cmd = tokens[tokenIdx];
    const args = tokens.slice(tokenIdx + 1);

    // export [VAR="val"] [VAR] or export / export -p (print all)
    if (cmd === 'export') {
      if (args.length === 0 || (args.length === 1 && args[0] === '-p')) {
        const keys = Object.keys(shellEnviron).sort();
        for (const key of keys) {
          const val = shellEnviron[key];
          const escapedVal = String(val).replace(/'/g, "'\\''");
          write(`export ${key}='${escapedVal}'\r\n`);
        }
        return 0;
      }

      for (const arg of args) {
        if (arg === '-p') continue;
        const eqIdx = arg.indexOf('=');
        if (eqIdx !== -1) {
          const key = arg.slice(0, eqIdx);
          const val = arg.slice(eqIdx + 1);
          shellEnviron[key] = val;
        } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) {
          if (!(arg in shellEnviron)) {
            shellEnviron[arg] = '';
          }
        }
      }
      shellEnviron.PWD = cwd;
      return 0;
    }

    // unset VAR
    if (cmd === 'unset') {
      for (const arg of args) {
        delete shellEnviron[arg];
      }
      return;
    }

    const effectiveEnviron = {
      ...shellEnviron,
      ...envOverrides,
      PWD: cwd,
    };

    if (cmd === 'clear') {
      write('\x1b[2J\x1b[H');
      return;
    }

    // Toolchain commands (gcc, clang, make, ld, etc.)
    if (TOOLCHAIN_COMMANDS.has(cmd)) {
      const t0 = performance.now();
      const code = execHostCommandSync({
        cmd,
        args,
        cwd,
        environ: effectiveEnviron,
      });
      if (isTimed) {
        const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
        write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
      }
      syncWorkspaceDiff(beforeMap);
      return code;
    }

    // Shell script execution via "sh script.sh" or "ash script.sh"
    if ((cmd === 'sh' || cmd === 'ash') && args.length > 0 && !args[0].startsWith('-')) {
      const scriptPath = resolvePath(args[0]);
      if (vfs.exists(scriptPath)) {
        return await runScriptFile(scriptPath, args.slice(1), effectiveEnviron, isTimed, beforeMap);
      }
    }

    // Explicit path specified (e.g. ./a.out, /workspace/a.out, ../bin/tool)
    if (cmd.startsWith('./') || cmd.startsWith('/') || cmd.startsWith('../')) {
      const targetPath = resolvePath(cmd);
      if (!vfs.exists(targetPath)) {
        writeln(`${cmd}: not found`);
        if (isTimed) {
          write(`\r\nreal\t0m0.000s\r\nuser\t0m0.000s\r\nsys\t0m0.000s\r\n`);
        }
        return 127;
      }

      const bytes = vfs.readFile(targetPath, false);
      const isScript = (bytes && bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) || cmd.endsWith('.sh');
      if (isScript) {
        return await runScriptFile(targetPath, args, effectiveEnviron, isTimed, beforeMap);
      } else {
        const t0 = performance.now();
        const code = execHostCommandSync({
          cmd: targetPath,
          args,
          cwd,
          environ: effectiveEnviron,
        });
        if (isTimed) {
          const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
          write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
        }
        syncWorkspaceDiff(beforeMap);
        return code;
      }
    }

    // Simple command without slashes
    if (!BIN_COMMANDS_SET.has(cmd) && !SHELL_BUILTINS.has(cmd)) {
      const workspaceCandidate = resolvePath(cmd);
      if (vfs.exists(workspaceCandidate)) {
        const bytes = vfs.readFile(workspaceCandidate, false);
        const isScript = (bytes && bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) || cmd.endsWith('.sh');
        if (isScript) {
          return await runScriptFile(workspaceCandidate, args, effectiveEnviron, isTimed, beforeMap);
        } else {
          const t0 = performance.now();
          const code = execHostCommandSync({
            cmd: workspaceCandidate,
            args,
            cwd,
            environ: effectiveEnviron,
          });
          if (isTimed) {
            const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
            write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
          }
          syncWorkspaceDiff(beforeMap);
          return code;
        }
      }

      if (!vfs.exists(`/usr/bin/${cmd}`) && !vfs.exists(`/bin/${cmd}`)) {
        writeln(`${cmd}: command not found`);
        if (isTimed) {
          write(`\r\nreal\t0m0.000s\r\nuser\t0m0.000s\r\nsys\t0m0.000s\r\n`);
        }
        return 127;
      }
    }
  }

  // Tier 2: BusyBox ash execution for shell constructs, pipelines, BusyBox applets, and builtins
  const effectiveEnviron = {
    ...shellEnviron,
    PWD: cwd,
  };

  const closedCmd = closePendingHeredocs(actualCmd.split('\n'));
  const wrapped = wrapHostExecutables(closedCmd);
  const t0 = performance.now();

  // Single-line preamble so ash execution starts at line 1
  const preamble = getShellPreamble(dirStackStr);
  const wrappedCmd = `cd "${cwd}"; ${preamble}\n${wrapped}\n__rc=$?; __host_update_pwd "$(pwd)"; exit $__rc`;

  const wasiHost = new WasiHost({
    vfs,
    cwd,
    argv: ['busybox', 'sh', '-c', wrappedCmd],
    environ: effectiveEnviron,
    stdin: readStdin,
    stdout: (str) => write(str),
    stderr: (str) => write(str),
    rows: termRows,
    cols: termCols,
    hostBuiltinLookup: (name) => isHostBuiltin(name),
    hostBuiltinRun: (params) => handleHostBuiltinRun(params, effectiveEnviron),
  });

  const imports = wasiHost.createImportObject();
  const instance = new WebAssembly.Instance(busyboxModule, imports);
  wasiHost.getMemory = () => instance.exports.memory;

  try {
    instance.exports._start();
  } catch (err) {
    if (!(err instanceof ProcExit)) {
      writeln(`\x1b[31mShell error: ${err.message || String(err)}\x1b[0m`);
    }
  }

  if (isTimed) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
    write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
  }

  syncWorkspaceDiff(beforeMap);
}

async function handleTabCompletion() {
  const currentLine = shellEditor.getBuffer();
  const tokens = currentLine.trim().split(/\s+/);
  const lastToken = tokens.length > 0 && !currentLine.endsWith(' ') ? tokens[tokens.length - 1] : '';

  let searchDir = cwd;
  let prefix = lastToken;

  if (lastToken.includes('/')) {
    const slashIdx = lastToken.lastIndexOf('/');
    const dirPart = lastToken.substring(0, slashIdx);
    prefix = lastToken.substring(slashIdx + 1);
    searchDir = resolvePath(dirPart);
  }

  try {
    if (!vfs.exists(searchDir)) return;
    const items = vfs.readDir(searchDir);
    const matches = items.filter((it) => it.name.startsWith(prefix));

    if (matches.length === 1) {
      const match = matches[0];
      const completion = match.name.substring(prefix.length) + (match.isDir ? '/' : ' ');
      shellEditor.feed(completion);
    } else if (matches.length > 1) {
      writeln('');
      writeln(matches.map((m) => m.name + (m.isDir ? '/' : '')).join('  '));
      write(getActivePrompt() + shellEditor.getBuffer());
      if (shellEditor.getCursor() < shellEditor.getBuffer().length) {
        write('\b'.repeat(shellEditor.getBuffer().length - shellEditor.getCursor()));
      }
    }
  } catch (_) {}
}

async function handleKey(key) {
  if (isExecuting) {
    return;
  }

  // Enter
  if (key === '\r' || key === '\n') {
    writeln('');
    const line = shellEditor.getBuffer();
    shellEditor.reset();

    if (multiLineBuffer.length === 0 && line.trim().length === 0) {
      showPrompt();
      return;
    }

    multiLineBuffer.push(line);

    if (isCommandIncomplete(multiLineBuffer)) {
      write('> ');
      return;
    }

    const toExecute = multiLineBuffer.join('\n').trim();
    multiLineBuffer = [];

    if (toExecute.length > 0) {
      shellEditor.commitHistory(toExecute);
      isExecuting = true;
      try {
        await executeCommandLine(toExecute);
      } catch (err) {
        if (err.message !== 'Interrupted') {
          writeln(`Error: ${err.message}`);
        }
      } finally {
        isExecuting = false;
        self.postMessage({ type: 'command_done' });
        showPrompt();
      }
      return;
    }

    showPrompt();
    return;
  }

  // Tab
  if (key === '\t') {
    await handleTabCompletion();
    return;
  }

  // Ctrl+C
  if (key === '\x03') {
    multiLineBuffer = [];
    writeln('^C');
    showPrompt();
    return;
  }

  // Ctrl+D (EOF on empty prompt)
  if (key === '\x04') {
    if (shellEditor.getBuffer().length === 0) {
      if (multiLineBuffer.length > 0) {
        writeln('');
        const toExecute = closePendingHeredocs(multiLineBuffer).trim();
        multiLineBuffer = [];
        if (toExecute.length > 0) {
          shellEditor.commitHistory(toExecute);
          isExecuting = true;
          try {
            await executeCommandLine(toExecute);
          } catch (err) {
            if (err.message !== 'Interrupted') {
              writeln(`Error: ${err.message}`);
            }
          } finally {
            isExecuting = false;
            self.postMessage({ type: 'command_done' });
            showPrompt();
          }
          return;
        }
      } else {
        writeln('exit');
        showPrompt();
      }
    }
    return;
  }

  // Delegate all arrow keys, history recall, inline editing to shellEditor
  shellEditor.feed(key);
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'init') {
    cwd = msg.cwd || '/workspace';
    shellEnviron.PWD = cwd;
    if (msg.rows) termRows = msg.rows;
    if (msg.cols) termCols = msg.cols;
    if (msg.sharedBuffer) {
      sharedInt32 = new Int32Array(msg.sharedBuffer);
      sharedUint8 = new Uint8Array(msg.sharedBuffer);
    }

    if (msg.sharedSysrootBuffer) {
      vfs.setSharedSysroot(msg.sharedSysrootBuffer);
    } else {
      mountSysroot(vfs);
    }

    if (msg.dirs) {
      for (const d of msg.dirs) {
        try { vfs.mkdir(normalizePath(d), true, true); } catch (_) {}
      }
    }

    if (msg.files) {
      for (const [p, item] of Object.entries(msg.files)) {
        const norm = normalizePath(p);
        const content = (item && item.content !== undefined) ? item.content : item;
        const mtime = (item && item.mtime !== undefined) ? item.mtime : Date.now();
        const u8 = typeof content === 'string'
          ? new TextEncoder().encode(content)
          : (content instanceof Uint8Array ? content : new Uint8Array(content));
        vfs.writeFile(norm, u8, mtime, true);
      }
    }

    try {
      const basePath = msg.basePath || '/sysroot/wasm';
      busyboxModule = await loadBusyboxBinary(basePath);
      isInitialized = true;
    } catch (err) {
      console.warn('Failed to load busybox binary:', err);
    }

    writeln('\x1b[1;36mWelcome to the In-Browser C/C++ Teaching IDE!\x1b[0m');
    writeln('Type \x1b[33mls\x1b[0m, \x1b[33mcat\x1b[0m, \x1b[33mcd\x1b[0m, \x1b[33mgcc\x1b[0m, \x1b[33msh\x1b[0m, \x1b[33mmake\x1b[0m, or use the toolbar buttons.\r\n');
    showPrompt();
    return;
  }

  if (msg.type === 'term_resize') {
    if (msg.rows) termRows = msg.rows;
    if (msg.cols) termCols = msg.cols;
    return;
  }

  if (msg.type === 'input') {
    const inputData = msg.data;
    if (inputData.length > 1 && (inputData.includes('\r') || inputData.includes('\n'))) {
      let i = 0;
      while (i < inputData.length) {
        if (inputData[i] === '\x1b') {
          let j = i + 1;
          while (j < inputData.length && !/[a-zA-Z~]/.test(inputData[j])) {
            j++;
          }
          if (j < inputData.length) j++;
          await handleKey(inputData.substring(i, j));
          i = j;
        } else {
          await handleKey(inputData[i]);
          i++;
        }
      }
    } else {
      await handleKey(inputData);
    }
    return;
  }

  if (msg.type === 'file_changed') {
    const norm = normalizePath(msg.path);
    const u8 = typeof msg.content === 'string'
      ? new TextEncoder().encode(msg.content)
      : (msg.content instanceof Uint8Array ? msg.content : new Uint8Array(msg.content));
    vfs.writeFile(norm, u8, msg.mtime || Date.now(), true);
    return;
  }

  if (msg.type === 'dir_created') {
    const norm = normalizePath(msg.path);
    try { vfs.mkdir(norm, true, true); } catch (_) {}
    return;
  }

  if (msg.type === 'file_deleted') {
    const norm = normalizePath(msg.path);
    if (vfs.exists(norm)) {
      try { vfs.remove(norm, true, true); } catch (_) {}
    }
    return;
  }

  if (msg.type === 'interrupt') {
    multiLineBuffer = [];
    if (sharedInt32) {
      Atomics.store(sharedInt32, STDIN_STATE_IDX, STDIN_STATE_EOF);
      Atomics.notify(sharedInt32, STDIN_STATE_IDX, 1);
    }
    if (isExecuting) {
      isExecuting = false;
      writeln('\r\n\x1b[31m[Process interrupted]\x1b[0m');
      showPrompt();
    } else {
      writeln('^C');
      showPrompt();
    }
  }
};
