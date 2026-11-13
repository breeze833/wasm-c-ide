// Web Worker: Dedicated Toolchain and Compiler Worker
// Runs Clang, LLD, ar, and make off the main browser thread to ensure 60 FPS UI responsiveness

if (typeof self === 'undefined') {
  globalThis.self = globalThis;
  if (!globalThis.postMessage) {
    globalThis.postMessage = () => {};
  }
}

import { VFS, normalizePath } from '../vfs/vfs.js';
import { mountSysroot } from '../vfs/sysroot.js';
import { WasmToolchain } from '../toolchain/wasm-clang.js';
import { executeGccCommand, executeLdCommand, executeToolCommand } from 'clang-wasi/driver';
import { runMake } from '../toolchain/make.js';

const vfs = new VFS();
let toolchain = null;
let isInitialized = false;
let workerBasePath = '/sysroot/wasm';

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

  for (const path of beforeSnapshot.fileMap.keys()) {
    if (!currentFiles.has(path)) {
      deletedFiles.push(path);
    }
  }

  for (const path of beforeSnapshot.dirSet) {
    if (!currentDirs.has(path)) {
      deletedDirs.push(path);
    }
  }

  return { changedFiles, deletedFiles, createdDirs, deletedDirs };
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'init') {
    workerBasePath = msg.basePath || '/sysroot/wasm';
    const basePath = workerBasePath;
    if (msg.sharedSysrootBuffer) {
      vfs.setSharedSysroot(msg.sharedSysrootBuffer);
    } else {
      mountSysroot(vfs);
    }

    toolchain = new WasmToolchain({
      basePath,
      vfs,
      hostWrite: (str) => {
        self.postMessage({ type: 'stdout', data: str });
      },
    });

    try {
      await toolchain.init((status) => {
        self.postMessage({ type: 'init_progress', status });
      });

      // Warm up compiler in background so llvm-box is ready in cache
      toolchain._getLlvmBox({ silent: true }).catch(() => {});

      isInitialized = true;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message || String(err) });
    }
    return;
  }

  if (msg.type === 'exec') {
    const { id, cmd, args = [], cwd = '/workspace', mode = 'c', files = {}, deletedFiles = [], basePath, environ = {} } = msg;

    if (!isInitialized || !toolchain) {
      self.postMessage({ type: 'done', id, exitCode: 1, error: 'Compiler worker not initialized' });
      return;
    }

    // Apply incoming workspace file updates
    if (files) {
      for (const [p, item] of Object.entries(files)) {
        const norm = normalizePath(p);
        const content = (item && item.content !== undefined) ? item.content : item;
        const mtime = (item && item.mtime !== undefined) ? item.mtime : Date.now();
        const u8 = typeof content === 'string'
          ? new TextEncoder().encode(content)
          : (content instanceof Uint8Array ? content : new Uint8Array(content));
        const existing = vfs.stat(norm);
        if (!existing || existing.mtime !== mtime || existing.size !== u8.byteLength) {
          vfs.writeFile(norm, u8, mtime, true);
        }
      }
    }

    if (deletedFiles) {
      for (const p of deletedFiles) {
        const norm = normalizePath(p);
        if (vfs.exists(norm)) {
          try { vfs.remove(norm, true, true); } catch (_) {}
        }
      }
    }

    const writeFn = (str) => {
      self.postMessage({ type: 'stdout', id, data: str });
    };

    const beforeMap = getWorkspaceSnapshot();
    let exitCode = 0;

    try {
      if (cmd === 'gcc' || cmd === 'clang' || cmd === 'g++' || cmd === 'clang++' || cmd === 'clang-cpp') {
        const effectiveMode = (cmd === 'g++' || cmd === 'clang++') ? 'cpp' : (mode || 'c');
        let finalArgs = args;
        if (effectiveMode === 'c') {
          const hasPedantic = args.includes('-pedantic') || args.includes('-pedantic-errors');
          if (!hasPedantic && !args.some(a => a.startsWith('-std='))) {
            finalArgs = ['-std=c11', '-pedantic-errors', ...args];
          }
        }
        exitCode = await executeGccCommand({
          cmd,
          args: finalArgs,
          cwd,
          environ,
          vfs,
          toolchain,
          mode: effectiveMode,
          write: writeFn,
        });
      } else if (cmd === 'ld' || cmd === 'lld' || cmd === 'wasm-ld' || cmd === 'ld.lld') {
        exitCode = await executeLdCommand({
          cmd,
          args,
          cwd,
          environ,
          vfs,
          toolchain,
          write: writeFn,
        });
      } else if (['ar', 'ranlib', 'nm', 'objdump', 'size', 'c++filt', 'cxxfilt', 'strings', 'readelf', 'strip'].includes(cmd)) {
        const toolMap = {
          'c++filt': 'cxxfilt',
          'readelf': 'readobj',
        };
        const activeTool = toolMap[cmd] || cmd;
        exitCode = await executeToolCommand({
          cmd: activeTool,
          args,
          cwd,
          environ,
          vfs,
          toolchain,
          write: writeFn,
        });
      } else if (cmd === 'make') {
        const makeBasePath = basePath || (toolchain && toolchain.basePath) || workerBasePath || '/sysroot/wasm';
        exitCode = await runMake({
          args,
          cwd,
          environ,
          vfs,
          toolchain,
          basePath: makeBasePath,
          mode,
          write: writeFn,
        });
      } else {
        writeFn(`compiler.worker: unrecognized command: ${cmd}\r\n`);
        exitCode = 127;
      }
    } catch (err) {
      writeFn(`\r\n\x1b[31mCompilation Error: ${err.message || String(err)}\x1b[0m\r\n`);
      exitCode = 1;
    }

    const { changedFiles, deletedFiles: diffDeleted, createdDirs, deletedDirs } = getWorkspaceDiff(beforeMap);
    self.postMessage({
      type: 'done',
      id,
      exitCode,
      changedFiles,
      deletedFiles: diffDeleted,
      createdDirs,
      deletedDirs,
    });
  }
};
