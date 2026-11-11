// Toolchain Client: Orchestrates compilation through dedicated Compiler Web Worker
// Keeps main thread responsive at 60 FPS and enables real-time diagnostic streaming & Ctrl+C abort

import { normalizePath } from '../vfs/vfs.js';
import { WasmToolchain } from './wasm-clang.js';
import { executeGccCommand, executeLdCommand, executeToolCommand } from './driver.js';
import { executeArCommand } from './ar.js';
import { runMake } from './make.js';

export class CompilerClient {
  constructor(options = {}) {
    this.vfs = options.vfs || null;
    this.basePath = (options.basePath || '/sysroot/wasm').replace(/\/+$/, '');
    this.hostWrite = options.hostWrite || console.log;
    this.worker = null;
    this.isReady = false;
    this.initPromise = null;
    this.isCompiling = false;
    this.currentRequestId = 0;
    this.pendingRequests = new Map();
    this.inProcessToolchain = null;

    // Detect browser Web Worker support
    this.useWorker = typeof window !== 'undefined' && typeof Worker !== 'undefined';
  }

  getWorkspaceFiles() {
    const files = {};
    if (!this.vfs || typeof this.vfs.getAllFiles !== 'function') return files;
    const all = this.vfs.getAllFiles('/workspace');
    for (const f of all) {
      if (!f.isDir && f.content) {
        files[f.path] = { content: f.content, mtime: f.mtime };
      }
    }
    return files;
  }

  _spawnWorker(onProgress) {
    this.worker = new Worker(
      new URL('../workers/compiler.worker.js', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'init_progress') {
        if (typeof onProgress === 'function') {
          onProgress(msg.status);
        }
      } else if (msg.type === 'ready') {
        this.isReady = true;
      } else if (msg.type === 'stdout') {
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id);
          if (typeof req.write === 'function') {
            req.write(msg.data);
          } else if (typeof this.hostWrite === 'function') {
            this.hostWrite(msg.data);
          }
        } else if (typeof this.hostWrite === 'function') {
          this.hostWrite(msg.data);
        }
      } else if (msg.type === 'done') {
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          this.isCompiling = false;

          // Commit changed files back to master VFS
          if (this.vfs && msg.changedFiles) {
            for (const [p, item] of Object.entries(msg.changedFiles)) {
              try {
                const content = (item && item.content !== undefined) ? item.content : item;
                const mtime = (item && item.mtime !== undefined) ? item.mtime : Date.now();
                this.vfs.writeFile(p, content, mtime, true);
              } catch (_) {}
            }
          }

          // Commit deleted files back to master VFS
          if (this.vfs && Array.isArray(msg.deletedFiles)) {
            for (const p of msg.deletedFiles) {
              try {
                if (this.vfs.exists(p)) {
                  this.vfs.remove(p, true, true);
                }
              } catch (_) {}
            }
          }

          req.resolve(msg.exitCode !== undefined ? msg.exitCode : 0);
        }
      } else if (msg.type === 'error') {
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          this.isCompiling = false;
          req.reject(new Error(msg.error || 'Compiler worker error'));
        }
      }
    };

    this.worker.onerror = (err) => {
      for (const [id, req] of this.pendingRequests.entries()) {
        req.reject(new Error(`Compiler Worker error: ${err.message}`));
      }
      this.pendingRequests.clear();
      this.isCompiling = false;
    };
  }

  async init(onProgress = () => {}) {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    if (!this.useWorker) {
      // In Node.js testing environment: use in-process WasmToolchain
      this.inProcessToolchain = new WasmToolchain({
        basePath: this.basePath,
        vfs: this.vfs,
        hostWrite: this.hostWrite,
      });
      this.initPromise = (async () => {
        await this.inProcessToolchain.init(onProgress);
        this.isReady = true;
      })();
      await this.initPromise;
      return;
    }

    this.initPromise = new Promise((resolve, reject) => {
      this._spawnWorker((status) => {
        if (typeof onProgress === 'function') onProgress(status);
      });

      const readyHandler = (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'ready') {
          this.worker.removeEventListener('message', readyHandler);
          this.isReady = true;
          resolve();
        } else if (msg.type === 'error') {
          this.worker.removeEventListener('message', readyHandler);
          reject(new Error(msg.error));
        }
      };

      this.worker.addEventListener('message', readyHandler);
      const sharedSysrootBuffer = (this.vfs && this.vfs.sharedSysroot) ? this.vfs.sharedSysroot.buffer : null;
      this.worker.postMessage({ type: 'init', basePath: this.basePath, sharedSysrootBuffer });
    });

    return this.initPromise;
  }

  async _getLlvmBox(options = {}) {
    if (!this.useWorker && this.inProcessToolchain) {
      return this.inProcessToolchain._getLlvmBox(options);
    }
    // In worker mode, warming is initiated by worker on init
    return null;
  }

  async executeCommand(payload) {
    const { cmd, args = [], cwd = '/workspace', mode = 'c', write, captureStdout } = payload;

    if (!this.useWorker) {
      // Fallback for Node.js unit tests
      if (!this.inProcessToolchain) {
        await this.init();
      }
      if (cmd === 'gcc' || cmd === 'clang' || cmd === 'g++' || cmd === 'clang++' || cmd === 'clang-cpp') {
        const effectiveMode = (cmd === 'g++' || cmd === 'clang++') ? 'cpp' : (mode || 'c');
        return await executeGccCommand({
          cmd,
          args,
          cwd,
          vfs: this.vfs,
          toolchain: this.inProcessToolchain,
          mode: effectiveMode,
          write: write || this.hostWrite,
        });
      }
      if (cmd === 'ld' || cmd === 'lld' || cmd === 'wasm-ld' || cmd === 'ld.lld') {
        return await executeLdCommand({
          cmd,
          args,
          cwd,
          vfs: this.vfs,
          toolchain: this.inProcessToolchain,
          write: write || this.hostWrite,
        });
      }
      if (cmd === 'ar' || cmd === 'ranlib') {
        return await executeArCommand({
          args,
          cwd,
          vfs: this.vfs,
          toolchain: this.inProcessToolchain,
          write: write || this.hostWrite,
        });
      }
      if (['nm', 'objdump', 'size', 'c++filt', 'cxxfilt', 'strings', 'readelf', 'strip'].includes(cmd)) {
        const toolMap = { 'c++filt': 'cxxfilt', 'readelf': 'readobj' };
        const activeTool = toolMap[cmd] || cmd;
        return await executeToolCommand({
          cmd: activeTool,
          args,
          cwd,
          vfs: this.vfs,
          toolchain: this.inProcessToolchain,
          write: write || this.hostWrite,
        });
      }
      if (cmd === 'make') {
        return await runMake({
          args,
          cwd,
          vfs: this.vfs,
          toolchain: this.inProcessToolchain,
          basePath: this.basePath,
          mode,
          write: write || this.hostWrite,
        });
      }
      return 127;
    }

    if (!this.isReady) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const id = ++this.currentRequestId;
      this.isCompiling = true;
      this.pendingRequests.set(id, { resolve, reject, write });

      const files = this.getWorkspaceFiles();

      this.worker.postMessage({
        type: 'exec',
        id,
        cmd,
        args,
        cwd,
        mode,
        files,
        basePath: this.basePath,
      });
    });
  }

  kill() {
    if (!this.useWorker || !this.worker) return;

    if (this.isCompiling) {
      this.worker.terminate();
      for (const [id, req] of this.pendingRequests.entries()) {
        req.reject(new Error('Interrupted'));
      }
      this.pendingRequests.clear();
      this.isCompiling = false;
      this.isReady = false;
      this.initPromise = null;

      // Re-spawn fresh worker in background
      this.init().catch(() => {});
    }
  }

  // WasmToolchain compatibility shims
  async compile(sourcePath, objPath, mode = 'c', customFlags = [], options = {}) {
    if (!this.useWorker) {
      if (!this.inProcessToolchain) await this.init();
      return this.inProcessToolchain.compile(sourcePath, objPath, mode, customFlags, options);
    }
    const args = [];
    if (options && options.stage === 'preprocess') args.push('-E');
    else if (options && options.stage === 'assembly') args.push('-S');
    else args.push('-c');
    args.push(...customFlags, sourcePath, '-o', objPath);
    return this.executeCommand({ cmd: mode === 'cpp' ? 'clang++' : 'clang', args, cwd: '/workspace', mode });
  }

  async link(objectPaths, outputPath, linkerFlags = []) {
    if (!this.useWorker) {
      if (!this.inProcessToolchain) await this.init();
      return this.inProcessToolchain.link(objectPaths, outputPath, linkerFlags);
    }
    const args = [...linkerFlags, ...objectPaths, '-o', outputPath];
    return this.executeCommand({ cmd: 'wasm-ld', args, cwd: '/workspace' });
  }

  async runTool(toolName, toolArgs = [], options = {}) {
    if (!this.useWorker) {
      if (!this.inProcessToolchain) await this.init();
      return this.inProcessToolchain.runTool(toolName, toolArgs, options);
    }
    return this.executeCommand({ cmd: toolName, args: toolArgs, cwd: options.cwd || '/workspace' });
  }

  getFile(path) {
    if (!this.useWorker && this.inProcessToolchain) {
      return this.inProcessToolchain.getFile(path);
    }
    const cleanPath = normalizePath(path);
    if (this.vfs && this.vfs.exists(cleanPath)) {
      return this.vfs.readFile(cleanPath, false);
    }
    return null;
  }

  hasFile(path) {
    if (!this.useWorker && this.inProcessToolchain) {
      return this.inProcessToolchain.hasFile(path);
    }
    const cleanPath = normalizePath(path);
    return Boolean(this.vfs && this.vfs.exists(cleanPath));
  }

  removeFile(path) {
    if (!this.useWorker && this.inProcessToolchain) {
      return this.inProcessToolchain.removeFile(path);
    }
    const cleanPath = normalizePath(path);
    if (this.vfs && this.vfs.exists(cleanPath)) {
      try {
        this.vfs.remove(cleanPath, true, true);
        return true;
      } catch (_) {}
    }
    return false;
  }
}
