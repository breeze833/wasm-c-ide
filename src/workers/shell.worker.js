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
import { mountSysroot } from '../vfs/sysroot.js';
import { WasiHost, ProcExit } from '../vfs/wasi-host.js';
import { getWasmModule, saveWasmModule } from '../toolchain/wasm-cache.js';

const CACHE_KEY = 'busybox-1.38.0';

let cwd = '/workspace';
let isExecuting = false;
let isInitialized = false;

const vfs = new VFS();
let busyboxModule = null;

let sharedInt32 = null;
const CONTROL_IDX = 0; // 0 = idle, 1 = waiting, 2 = done
const RESULT_IDX = 1;  // exitCode

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

function showPrompt() {
  shellEditor.reset();
  write(getPrompt());
}

function resolvePath(p) {
  if (!p) return cwd;
  let target = p.startsWith('/') ? p : `${cwd}/${p}`;
  return normalizePath(target);
}

function getWorkspaceSnapshot() {
  const map = new Map();
  const all = vfs.getAllFiles('/workspace');
  for (const f of all) {
    if (!f.isDir) {
      map.set(f.path, {
        mtime: f.mtime,
        length: f.content ? f.content.length : 0,
      });
    }
  }
  return map;
}

function getWorkspaceDiff(beforeMap) {
  const changedFiles = {};
  const deletedFiles = [];
  const currentFiles = new Set();

  const all = vfs.getAllFiles('/workspace');
  for (const f of all) {
    if (!f.isDir) {
      currentFiles.add(f.path);
      const before = beforeMap.get(f.path);
      if (!before || before.mtime !== f.mtime || before.length !== (f.content ? f.content.length : 0)) {
        changedFiles[f.path] = f.content;
      }
    }
  }

  for (const p of beforeMap.keys()) {
    if (!currentFiles.has(p)) {
      deletedFiles.push(p);
    }
  }

  return { changedFiles, deletedFiles };
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
    const res = await fetch(url);
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

const SHELL_PREAMBLE = `
_read_dstack() {
  if [ -f /workspace/.ide_dir_stack ]; then
    _DIR_STACK="$(cat /workspace/.ide_dir_stack 2>/dev/null)"
  else
    _DIR_STACK=""
  fi
}
_save_dstack() {
  echo "$_DIR_STACK" > /workspace/.ide_dir_stack
}
pushd() {
  _read_dstack
  if [ -z "$1" ]; then
    echo "pushd: no other directory" >&2
    return 1
  fi
  _DIR_STACK="$(pwd)|\${_DIR_STACK}"
  _save_dstack
  cd "$1" || return 1
  dirs
}
popd() {
  _read_dstack
  if [ -z "$_DIR_STACK" ]; then
    echo "popd: directory stack empty" >&2
    return 1
  fi
  _TARGET="\${_DIR_STACK%%|*}"
  _DIR_STACK="\${_DIR_STACK#*|}"
  _save_dstack
  cd "$_TARGET" || return 1
  dirs
}
dirs() {
  _read_dstack
  _res="$(pwd)"
  _rest="$_DIR_STACK"
  while [ -n "$_rest" ]; do
    _d="\${_rest%%|*}"
    _rest="\${_rest#*|}"
    if [ -n "$_d" ]; then
      _res="$_res $_d"
    fi
  done
  echo "$_res"
}
`;

function wrapHostExecutables(cmdLine) {
  return cmdLine.replace(/(^|[;&|]\s*|\btime\s+)(\.{1,2}\/[^\s;&|<>]+|\/[^\s;&|<>]+)/g, (match, prefix, target) => {
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
}

async function executeCommandLine(toExecute) {
  if (!busyboxModule) {
    writeln('sh: busybox binary not initialized');
    return;
  }

  const beforeMap = getWorkspaceSnapshot();

  const isTimed = /^\s*time(\s+|$)/.test(toExecute);
  const actualCmd = isTimed ? toExecute.replace(/^\s*time\s*/, '') : toExecute;
  const wrapped = wrapHostExecutables(actualCmd);
  const t0 = performance.now();

  // Prefix with cd "${cwd}" so busybox ash executes in the active directory,
  // load directory stack functions, and record final working directory via /workspace/.ide_pwd
  const wrappedCmd = `cd "${cwd}"\n${SHELL_PREAMBLE}\n${wrapped}\n__rc=$?; pwd > /workspace/.ide_pwd; exit $__rc`;

  const wasiHost = new WasiHost({
    vfs,
    cwd,
    argv: ['busybox', 'sh', '-c', wrappedCmd],
    environ: {
      USER: 'student',
      HOME: '/workspace',
      PWD: cwd,
      PATH: '/bin:/usr/bin:/workspace',
    },
    stdout: (str) => write(str),
    stderr: (str) => write(str),
    hostBuiltinLookup: (name) => {
      if (
        name === '__host_exec' ||
        name === 'time' ||
        name === 'make' ||
        name === 'clear' ||
        name === 'gcc' ||
        name === 'clang' ||
        name === 'g++' ||
        name === 'clang++' ||
        name === 'clang-cpp' ||
        name === 'wasm-ld' ||
        name === 'ld' ||
        name === 'lld' ||
        name === 'ar' ||
        name === 'ranlib' ||
        name === 'nm' ||
        name === 'size' ||
        name === 'objdump' ||
        name === 'strings' ||
        name === 'sqlite3' ||
        name.startsWith('./') ||
        name.startsWith('/') ||
        vfs.exists(`${cwd}/${name}`) ||
        vfs.exists(`/workspace/${name}`) ||
        vfs.exists(`/usr/bin/${name}`)
      ) {
        return 1;
      }
      return 0;
    },
    hostBuiltinRun: ({ cwd: runCwd, argc, argv, envp }) => {
      let cmd = argv[0];
      let args = argv.slice(1);

      if (cmd === '__host_exec') {
        cmd = args[0];
        args = args.slice(1);
      }

      if (cmd === 'clear') {
        write('\x1b[2J\x1b[H');
        return 0;
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
        });
        const elapsed = ((performance.now() - timeStart) / 1000).toFixed(3);
        write(`\r\nreal\t0m${elapsed}s\r\nuser\t0m${elapsed}s\r\nsys\t0m0.000s\r\n`);
        return code;
      }

      return execHostCommandSync({
        cmd,
        args,
        cwd: runCwd || cwd,
      });
    },
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

  // Check if cwd was updated by cd
  if (vfs.exists('/workspace/.ide_pwd')) {
    try {
      const newPwd = vfs.readFile('/workspace/.ide_pwd', true).trim();
      vfs.remove('/workspace/.ide_pwd');
      if (newPwd && newPwd !== cwd && (vfs.exists(newPwd) || newPwd === '/')) {
        cwd = newPwd;
        self.postMessage({ type: 'cwd_changed', cwd });
      }
    } catch (_) {}
  }

  // Synchronize any workspace file modifications
  const { changedFiles, deletedFiles } = getWorkspaceDiff(beforeMap);
  if (Object.keys(changedFiles).length > 0 || deletedFiles.length > 0) {
    self.postMessage({
      type: 'vfs_sync',
      changedFiles,
      deletedFiles,
    });
  }
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
      write(getPrompt() + shellEditor.getBuffer());
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
    const toExecute = shellEditor.getBuffer().trim();
    if (toExecute.length > 0) {
      shellEditor.commitHistory(toExecute);
    }
    shellEditor.reset();

    if (toExecute.length > 0) {
      isExecuting = true;
      try {
        await executeCommandLine(toExecute);
      } catch (err) {
        if (err.message !== 'Interrupted') {
          writeln(`Error: ${err.message}`);
        }
      } finally {
        isExecuting = false;
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
    writeln('^C');
    showPrompt();
    return;
  }

  // Ctrl+D (EOF on empty prompt)
  if (key === '\x04') {
    if (shellEditor.getBuffer().length === 0) {
      writeln('exit');
      showPrompt();
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
    if (msg.sharedBuffer) {
      sharedInt32 = new Int32Array(msg.sharedBuffer);
    }

    mountSysroot(vfs);

    if (msg.files) {
      for (const [p, content] of Object.entries(msg.files)) {
        const norm = normalizePath(p);
        const u8 = typeof content === 'string'
          ? new TextEncoder().encode(content)
          : (content instanceof Uint8Array ? content : new Uint8Array(content));
        vfs.writeFile(norm, u8, Date.now(), true);
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

  if (msg.type === 'input') {
    await handleKey(msg.data);
    return;
  }

  if (msg.type === 'file_changed') {
    const norm = normalizePath(msg.path);
    const u8 = typeof msg.content === 'string'
      ? new TextEncoder().encode(msg.content)
      : (msg.content instanceof Uint8Array ? msg.content : new Uint8Array(msg.content));
    vfs.writeFile(norm, u8, Date.now(), true);
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
