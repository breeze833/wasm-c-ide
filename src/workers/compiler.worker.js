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
import { executeGccCommand, executeLdCommand, executeToolCommand } from '../toolchain/driver.js';
import { executeArCommand } from '../toolchain/ar.js';
import { runMake } from '../toolchain/make.js';

const vfs = new VFS();
let toolchain = null;
let isInitialized = false;

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
        changedFiles[f.path] = { content: f.content, mtime: f.mtime };
      }
    }
  }

  for (const path of beforeMap.keys()) {
    if (!currentFiles.has(path)) {
      deletedFiles.push(path);
    }
  }

  return { changedFiles, deletedFiles };
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'init') {
    const basePath = msg.basePath || '/sysroot/wasm';
    mountSysroot(vfs);

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
    const { id, cmd, args = [], cwd = '/workspace', mode = 'c', files = {}, deletedFiles = [] } = msg;

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
        exitCode = await executeGccCommand({
          cmd,
          args,
          cwd,
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
          vfs,
          toolchain,
          write: writeFn,
        });
      } else if (cmd === 'ar' || cmd === 'ranlib') {
        exitCode = await executeArCommand({
          args,
          cwd,
          vfs,
          toolchain,
          write: writeFn,
        });
      } else if (['nm', 'objdump', 'size', 'c++filt', 'cxxfilt', 'strings', 'readelf', 'strip'].includes(cmd)) {
        const toolMap = {
          'c++filt': 'cxxfilt',
          'readelf': 'readobj',
        };
        const activeTool = toolMap[cmd] || cmd;
        exitCode = await executeToolCommand({
          cmd: activeTool,
          args,
          cwd,
          vfs,
          toolchain,
          write: writeFn,
        });
      } else if (cmd === 'make') {
        exitCode = await runMake({
          args,
          cwd,
          vfs,
          toolchain,
          basePath: '/sysroot/wasm',
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

    const { changedFiles, deletedFiles: diffDeleted } = getWorkspaceDiff(beforeMap);
    self.postMessage({
      type: 'done',
      id,
      exitCode,
      changedFiles,
      deletedFiles: diffDeleted,
    });
  }
};
