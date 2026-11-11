// Main Application Bootstrap & UI Wiring

import { VFS } from './vfs/vfs.js';
import { loadWorkspace, setupAutoSync } from './vfs/storage.js';
import { mountSysroot, mountSysrootUtilities } from './vfs/sysroot.js';
import { loadOrBuildSharedSysroot } from './vfs/shared-sysroot.js';
import { EditorManager } from './editor/editor.js';
import { TabsUI } from './editor/tabs.js';
import { FileTreeUI } from './components/filetree.js';
import { showToast } from './components/toast.js';
import { TerminalManager } from './terminal/terminal.js';
import { RuntimeManager } from './terminal/runtime.js';
import { CompilerClient } from './toolchain/compiler-client.js';
import { WasmToolchain } from './toolchain/wasm-clang.js';
import { executeGccCommand, executeToolCommand, executeLdCommand } from './toolchain/driver.js';
import { executeArCommand } from './toolchain/ar.js';
import { GraphicsWindowUI } from 'canvas-wasi';
import 'canvas-wasi/style.css';

import { SettingsModal, DEFAULT_RUN_COMMAND } from './components/settings.js';
import { runMake } from './toolchain/make.js';
import { ReferenceDrawer, getDocsUrl } from './components/reference.js';

export function checkIsolation() {
  const isIsolated = window.crossOriginIsolated === true;
  console.log(`[Wasm C IDE] Cross-Origin Isolation: ${isIsolated ? 'ENABLED' : 'DISABLED'}`);
  return isIsolated;
}

// Synchronously register PWA install prompt listener at module evaluation to prevent race conditions
let globalDeferredInstallPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    globalDeferredInstallPrompt = e;
    if (window.__ideApp) {
      window.__ideApp.deferredInstallPrompt = e;
    }
    const btnInstall = document.getElementById('btn-install');
    if (btnInstall) {
      btnInstall.style.display = 'inline-flex';
    }
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredInstallPrompt = null;
    if (window.__ideApp) {
      window.__ideApp.deferredInstallPrompt = null;
    }
    const btnInstall = document.getElementById('btn-install');
    if (btnInstall) {
      btnInstall.style.display = 'none';
    }
    showToast('C/C++ Web IDE successfully installed!', 'success', 3500);
  });
}

export class App {
  constructor() {
    this.vfs = new VFS();
    this.editorManager = null;
    this.tabsUI = null;
    this.fileTreeUI = null;
    this.terminal = null;
    this.runtimeManager = null;
    this.graphicsWindow = null;
    this.shellWorker = null;
    this.toolchain = null;
    this.settingsModal = null;
    this.referenceDrawer = null;
    this.mode = 'c'; // 'c' or 'cpp'
    this.buildSystem = 'sh'; // 'sh' or 'make'
    const savedRunCmd = typeof localStorage !== 'undefined' ? localStorage.getItem('wasm_c_ide_run_command') : null;
    this.runCommand = savedRunCmd || DEFAULT_RUN_COMMAND;
    this.deferredInstallPrompt = null;
    this.sidebarWidth = 240;
    this.sidebarCollapsed = false;
    this.isReady = false;
  }

  async init() {
    const isIsolated = checkIsolation();

    // 1. Initialize Terminal, Shell Worker & Runtime early so xterm is visible and ready for startup messages
    this.initTerminalAndShell();

    if (this.terminal) {
      this.terminal.writeln('\x1b[1;36m[System]\x1b[0m Initializing WebAssembly C/C++ environment...');
      this.terminal.writeln('\x1b[90m[*] Mounting virtual filesystem headers...\x1b[0m');
    }

    // Mount read-only sysroot headers
    mountSysroot(this.vfs);

    if (this.terminal) {
      this.terminal.writeln('\x1b[90m[*] Loading workspace from storage...\x1b[0m');
    }

    // Load workspace from IndexedDB
    await loadWorkspace(this.vfs);
    setupAutoSync(this.vfs);

    // Initialize Monaco Editor
    const editorContainer = document.getElementById('editor-container');
    const tabsContainer = document.getElementById('tabs-bar');

    this.editorManager = new EditorManager(
      editorContainer,
      this.vfs,
      (_path, _isDirty) => {
        if (this.tabsUI) this.tabsUI.render();
      }
    );

    this.tabsUI = new TabsUI(tabsContainer, this.editorManager);

    // Initialize File Tree
    const fileTreeContainer = document.getElementById('file-tree');
    this.fileTreeUI = new FileTreeUI(fileTreeContainer, this.vfs, (path) => {
      this.editorManager.openFile(path);
      this.tabsUI.render();
    });

    this.fileTreeUI.attachToolbarButtons({
      btnNewFile: document.getElementById('btn-new-file'),
      btnNewFolder: document.getElementById('btn-new-folder'),
      btnExportZip: document.getElementById('btn-export-zip'),
      btnImportZip: document.getElementById('btn-import-zip'),
    });

    this.fileTreeUI.render();

    // Initialize Toolchain
    let wasmBasePath = '/sysroot/wasm';
    if (typeof window !== 'undefined' && window.location) {
      const baseUrl = import.meta.env?.BASE_URL || './';
      let loc = new URL(window.location.href);
      if (!loc.pathname.endsWith('/') && !loc.pathname.split('/').pop().includes('.')) {
        loc.pathname += '/';
      }
      const resolvedBase = new URL(baseUrl, loc.href);
      wasmBasePath = new URL('sysroot/wasm', resolvedBase).pathname.replace(/\/+$/, '');
    }

    this.toolchain = new CompilerClient({
      basePath: wasmBasePath,
      vfs: this.vfs,
      hostWrite: (str) => {
        if (this.terminal) {
          this.terminal.write(str.replace(/\r?\n/g, '\r\n'));
        }
      },
    });

    // Populate C/C++ sysroot headers and runtime libraries into VFS with progress indication
    if (this.terminal) {
      this.terminal.writeln('\x1b[90m[*] Preparing C/C++ standard library sysroot...\x1b[0m');
    }
    try {
      const sharedSysrootBuffer = await loadOrBuildSharedSysroot(wasmBasePath, (status) => {
        if (this.terminal) {
          this.terminal.writeln(`\x1b[90m[*] ${status}\x1b[0m`);
        }
      });
      this.vfs.setSharedSysroot(sharedSysrootBuffer);

      await this.toolchain.init((status) => {
        if (this.terminal) {
          this.terminal.writeln(`\x1b[90m[*] ${status}\x1b[0m`);
        }
      });
      await mountSysrootUtilities(this.vfs, wasmBasePath);
    } catch (err) {
      console.warn('Toolchain sysroot setup notice:', err);
      if (this.terminal) {
        this.terminal.writeln(`\x1b[33m[!] Sysroot setup notice: ${err.message || err}\x1b[0m`);
      }
    }

    // Signal VFS ready, display ready status in terminal, and launch shell prompt
    if (this.terminal) {
      this.terminal.writeln('\x1b[1;32m[✓]\x1b[0m System ready.\r\n');
    }
    this.isReady = true;
    if (this.shellWorker) {
      const initialFiles = {};
      const allFiles = this.vfs.getAllFiles('/workspace');
      for (const f of allFiles) {
        if (!f.isDir) {
          initialFiles[f.path] = f.content;
        }
      }
      this.shellWorker.postMessage({
        type: 'init',
        cwd: '/workspace',
        sharedBuffer: this.shellSharedBuffer,
        sharedSysrootBuffer: (this.vfs && this.vfs.sharedSysroot) ? this.vfs.sharedSysroot.buffer : null,
        files: initialFiles,
        basePath: wasmBasePath,
        rows: this.terminal && this.terminal.term ? this.terminal.term.rows : 24,
        cols: this.terminal && this.terminal.term ? this.terminal.term.cols : 80,
      });
    }

    // Warm up compiler in background so llvm-box is ready in cache
    this.toolchain._getLlvmBox({ silent: true }).catch(err => {
      console.warn('Toolchain background pre-initialization notice:', err);
    });

    // Open default file main.c
    if (this.vfs.exists('/workspace/src/main.c')) {
      this.editorManager.openFile('/workspace/src/main.c');
    }
    this.tabsUI.render();

    // Attach Top Header Action Buttons
    this.attachHeaderActions();

    // Zoom Controls for Editor and Terminal
    this.setupZoomControls();

    // Detached / Floating Windowing for Terminal
    this.setupTerminalWindowing();

    // Draggable Split Resizer between Editor and Terminal
    this.setupSplitResizer();

    // Collapsible & Resizable Workspace Sidebar
    this.setupSidebar();

    // Slide-Out Right Reference Drawer
    this.setupReferenceDrawer();

    // PWA Install Prompt & Connection Status Listeners
    if (globalDeferredInstallPrompt) {
      this.deferredInstallPrompt = globalDeferredInstallPrompt;
      const btnInstall = document.getElementById('btn-install');
      if (btnInstall) {
        btnInstall.style.display = 'inline-flex';
      }
    }

    window.addEventListener('online', () => {
      showToast('Network restored: Online', 'info', 3000);
    });

    window.addEventListener('offline', () => {
      showToast('Offline Mode: The IDE continues to run client-side.', 'warning', 4000);
    });
  }

  initTerminalAndShell(options = {}) {
    const termContainer = document.getElementById('terminal-container');
    this.terminal = new TerminalManager(
      termContainer,
      (inputData) => {
        // Drop input while system is initializing
        if (!this.isReady) {
          return;
        }
        // If runtime worker is active and waiting for stdin (scanf), route to runtime
        if (this.runtimeManager && this.runtimeManager.handleTerminalInput(inputData)) {
          return;
        }
        if (this.shellWorker) {
          this.shellWorker.postMessage({ type: 'input', data: inputData });
        }
      },
      () => {
        // Ctrl+C handling: interrupt active runtime process or shell
        if (!this.isReady) return;
        this.handleStopExecution();
      }
    );

    this.terminal.onDimensionsChange = (cols, rows) => {
      if (this.shellWorker) {
        this.shellWorker.postMessage({ type: 'term_resize', cols, rows });
      }
    };

    this.runtimeManager = new RuntimeManager(this.terminal);
    this.graphicsWindow = new GraphicsWindowUI({
      sharedBuffer: this.runtimeManager.raylibSharedBuffer,
      inputCoordinator: this.runtimeManager.inputCoordinator,
      onCloseRequested: () => {
        if (this.runtimeManager && this.runtimeManager.inputCoordinator) {
          this.runtimeManager.inputCoordinator.shouldClose = true;
          this.runtimeManager.inputCoordinator.updateSharedState();
        }
      },
      onFrameActivity: (hasActivity) => {
        const btn = document.getElementById('btn-graphics-window');
        if (btn) {
          if (hasActivity) {
            btn.classList.add('has-frame-activity');
            btn.setAttribute('title', 'Canvas (New frames rendering in background - Click to show)');
          } else {
            btn.classList.remove('has-frame-activity');
            btn.setAttribute('title', 'Toggle Graphics Canvas Window');
          }
        }
      },
    });
    this.runtimeManager.setGraphicsWindow(this.graphicsWindow);

    // Setup SharedArrayBuffer for synchronous host process execution in shell worker
    if (typeof SharedArrayBuffer !== 'undefined') {
      this.shellSharedBuffer = new SharedArrayBuffer(1024);
      this.shellSharedInt32 = new Int32Array(this.shellSharedBuffer);
    } else {
      this.shellSharedBuffer = null;
      this.shellSharedInt32 = null;
    }

    // Instantiate Shell Worker as ES Module worker
    this.shellWorker = new Worker(
      new URL('./workers/shell.worker.js', import.meta.url),
      { type: 'module' }
    );

    this.shellWorker.onmessage = async (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'term_write') {
        this.terminal.write(msg.data);
        return;
      }

      if (msg.type === 'vfs_sync') {
        const { changedFiles, deletedFiles, createdDirs, deletedDirs } = msg;
        if (createdDirs) {
          for (const d of createdDirs) {
            try { this.vfs.mkdir(d, true, true); } catch (_) {}
          }
        }
        if (changedFiles) {
          for (const [p, item] of Object.entries(changedFiles)) {
            const u8 = (item && item.content !== undefined) ? item.content : item;
            const mtime = (item && item.mtime !== undefined) ? item.mtime : Date.now();
            this.vfs.writeFile(p, u8, mtime, true);
          }
        }
        if (deletedFiles) {
          for (const p of deletedFiles) {
            try { this.vfs.remove(p, true, true); } catch (_) {}
          }
        }
        if (deletedDirs) {
          for (const d of deletedDirs) {
            try { this.vfs.remove(d, true, true); } catch (_) {}
          }
        }
        if (this.fileTreeUI) this.fileTreeUI.render();
        return;
      }

      if (msg.type === 'cwd_changed') {
        this.cwd = msg.cwd;
        return;
      }

      if (msg.type === 'host_spawn_request') {
        const { payload } = msg;
        let exitCode = 1;
        try {
          const res = await this.executeExternalCommand(payload);
          if (typeof res === 'object' && res !== null && typeof res.exitCode === 'number') {
            exitCode = res.exitCode;
          } else if (res === true || res === 0) {
            exitCode = 0;
          }
        } catch (err) {
          if (this.terminal) {
            this.terminal.write(`\r\n\x1b[31m${err.message || String(err)}\x1b[0m\r\n`);
          }
          exitCode = 1;
        }

        if (this.shellSharedInt32) {
          this.shellSharedInt32[1] = exitCode; // RESULT_IDX
          Atomics.store(this.shellSharedInt32, 0, 2); // CONTROL_IDX: 2 = done
          Atomics.notify(this.shellSharedInt32, 0, 1);
        }
        return;
      }

      // Handle legacy VFS RPC requests if any
      if (msg.type.startsWith('vfs_') || msg.type === 'exec_command') {
        this.handleWorkerRpc(msg);
      }
    };

    // Forward master VFS changes to shell worker so its in-memory VFS stays synchronized
    this.vfs.subscribe((event) => {
      if (!this.shellWorker) return;
      if (event.type === 'mkdir') {
        this.shellWorker.postMessage({
          type: 'dir_created',
          path: event.path,
        });
      } else if (event.type === 'write' && !event.isDir) {
        const content = this.vfs.readFile(event.path, false);
        const mtime = event.mtime || (this.vfs.stat(event.path)?.mtime) || Date.now();
        this.shellWorker.postMessage({
          type: 'file_changed',
          path: event.path,
          content,
          mtime,
        });
      } else if (event.type === 'remove') {
        this.shellWorker.postMessage({
          type: 'file_deleted',
          path: event.path,
        });
      } else if (event.type === 'rename') {
        this.shellWorker.postMessage({
          type: 'file_deleted',
          path: event.oldPath,
        });
        if (event.isDir || this.vfs.isDir(event.path)) {
          this.shellWorker.postMessage({
            type: 'dir_created',
            path: event.path,
          });
        } else {
          const content = this.vfs.readFile(event.path, false);
          const mtime = event.mtime || (this.vfs.stat(event.path)?.mtime) || Date.now();
          this.shellWorker.postMessage({
            type: 'file_changed',
            path: event.path,
            content,
            mtime,
          });
        }
      }
    });

    if (options.autoInit) {
      this.isReady = true;
      const initialFiles = {};
      const initialDirs = [];
      const allFiles = this.vfs.getAllFiles('/workspace');
      for (const f of allFiles) {
        if (!f.isDir) {
          initialFiles[f.path] = { content: f.content, mtime: f.mtime };
        } else {
          initialDirs.push(f.path);
        }
      }
      this.shellWorker.postMessage({
        type: 'init',
        cwd: '/workspace',
        sharedBuffer: this.shellSharedBuffer,
        files: initialFiles,
        dirs: initialDirs,
        rows: this.terminal && this.terminal.term ? this.terminal.term.rows : 24,
        cols: this.terminal && this.terminal.term ? this.terminal.term.cols : 80,
      });
    }

    const btnClearTerm = document.getElementById('btn-clear-term');
    if (btnClearTerm) {
      btnClearTerm.addEventListener('click', () => {
        this.terminal.clear();
        this.terminal.injectCommand('clear');
      });
    }
  }

  async handleWorkerRpc(msg) {
    const { id, type, payload } = msg;

    try {
      let result = null;
      if (type === 'vfs_readDir') {
        result = this.vfs.readDir(payload.path);
      } else if (type === 'vfs_readFile') {
        result = this.vfs.readFile(payload.path, payload.asText);
      } else if (type === 'vfs_writeFile') {
        this.vfs.writeFile(payload.path, payload.content);
        result = true;
      } else if (type === 'vfs_mkdir') {
        this.vfs.mkdir(payload.path, payload.recursive);
        result = true;
      } else if (type === 'vfs_remove') {
        this.vfs.remove(payload.path, payload.recursive);
        result = true;
      } else if (type === 'vfs_rename') {
        this.vfs.rename(payload.oldPath, payload.newPath);
        result = true;
      } else if (type === 'vfs_stat') {
        result = this.vfs.stat(payload.path);
      } else if (type === 'vfs_exists') {
        result = this.vfs.exists(payload.path);
      } else if (type === 'exec_command') {
        result = await this.executeExternalCommand(payload);
      }

      this.shellWorker.postMessage({ type: 'rpc_response', id, result });
    } catch (err) {
      this.shellWorker.postMessage({ type: 'rpc_response', id, error: err.message });
    }
  }

  async executeExternalCommand(payload) {
    let { cmd, args, cwd, stdinData, captureStdout, stdoutRedirect, environ } = payload;
    if (cmd === '__host_exec' && args && args.length > 0) {
      cmd = args[0];
      args = args.slice(1);
    }
    let capturedStdout = '';
    const shouldCapture = Boolean(captureStdout || stdoutRedirect);

    const writeFn = (str) => {
      if (shouldCapture) {
        capturedStdout += str;
      }
      if (!stdoutRedirect) {
        this.terminal.write(str.replace(/\r?\n/g, '\r\n'));
      }
    };

    const flushStdoutRedirect = async () => {
      if (stdoutRedirect && stdoutRedirect.path) {
        let content = capturedStdout;
        if (stdoutRedirect.append && this.vfs.exists(stdoutRedirect.path)) {
          const existing = this.vfs.readFile(stdoutRedirect.path, true);
          content = existing + capturedStdout;
        }
        this.vfs.writeFile(stdoutRedirect.path, content);
        if (this.fileTreeUI) this.fileTreeUI.render();
      }
    };

    const isToolchainCmd = (
      cmd === 'gcc' || cmd === 'clang' || cmd === 'g++' || cmd === 'clang++' || cmd === 'clang-cpp' ||
      cmd === 'ld' || cmd === 'lld' || cmd === 'wasm-ld' || cmd === 'ld.lld' ||
      ['ar', 'ranlib', 'nm', 'objdump', 'size', 'c++filt', 'cxxfilt', 'strings', 'readelf', 'strip'].includes(cmd) ||
      cmd === 'make'
    );

    if (isToolchainCmd) {
      const effectiveMode = (cmd === 'g++' || cmd === 'clang++') ? 'cpp' : this.mode;
      const exitCode = await this.toolchain.executeCommand({
        cmd,
        args,
        cwd: cwd || '/workspace',
        mode: effectiveMode,
        write: writeFn,
        environ,
      });

      if (this.fileTreeUI) this.fileTreeUI.render();
      await flushStdoutRedirect();

      if (captureStdout) {
        return { exitCode, stdout: capturedStdout };
      }
      if (exitCode !== 0) {
        throw new Error(`Process terminated with exit code ${exitCode}`);
      }
      return true;
    }

    // Binary execution: ./a.out, a.out, or executable paths
    let execPath = null;
    if (cmd === './a.out' || cmd === 'a.out' || cmd.startsWith('./') || cmd.startsWith('/')) {
      execPath = cmd.startsWith('/') ? cmd : `${cwd}/${cmd.replace(/^\.\//, '')}`;
    } else if (this.vfs.exists(`${cwd}/${cmd}`)) {
      execPath = `${cwd}/${cmd}`;
    } else if (this.vfs.exists(`/usr/bin/${cmd}`)) {
      execPath = `/usr/bin/${cmd}`;
    } else if (this.vfs.exists(`/bin/${cmd}`)) {
      execPath = `/bin/${cmd}`;
    }

    if (execPath) {
      if (!this.vfs.exists(execPath)) {
        throw new Error(`${cmd}: no such file or directory`);
      }

      let wasmBytes = this.vfs.readFile(execPath, false);
      if (
        !wasmBytes ||
        wasmBytes.length < 4 ||
        wasmBytes[0] !== 0x00 ||
        wasmBytes[1] !== 0x61 ||
        wasmBytes[2] !== 0x73 ||
        wasmBytes[3] !== 0x6d
      ) {
        // On-demand fetch fallback for prebuilt binaries like sqlite3
        if (cmd === 'sqlite3' || execPath.endsWith('/sqlite3')) {
          try {
            const basePath = (this.toolchain && this.toolchain.basePath) ||
              (typeof window !== 'undefined' ? `${window.location.origin}/sysroot/wasm` : '/sysroot/wasm');
            const res = await fetch(`${basePath}/sqlite3.wasm`);
            if (res && (res.ok || typeof res.ok === 'undefined')) {
              const buf = await res.arrayBuffer();
              const u8 = new Uint8Array(buf);
              this.vfs.writeFile(execPath, u8, Date.now(), true);
              wasmBytes = u8;
            }
          } catch (err) {
            console.warn('Failed to fetch sqlite3.wasm on demand:', err);
          }
        }
      }

      if (
        !wasmBytes ||
        wasmBytes.length < 4 ||
        wasmBytes[0] !== 0x00 ||
        wasmBytes[1] !== 0x61 ||
        wasmBytes[2] !== 0x73 ||
        wasmBytes[3] !== 0x6d
      ) {
        throw new Error(`${cmd}: not an executable WebAssembly binary`);
      }
      const res = await this.runtimeManager.runBinary(wasmBytes, [cmd, ...args], {
        vfs: this.vfs,
        stdinBytes: stdinData,
        captureStdout: shouldCapture,
        environ,
        onStdout: stdoutRedirect ? ((data) => { capturedStdout += data; }) : null,
      });

      const exitCode = typeof res === 'object' ? res.exitCode : res;
      if (typeof res === 'object') {
        capturedStdout = res.stdout;
      }

      await flushStdoutRedirect();

      if (captureStdout) {
        return { exitCode, stdout: capturedStdout };
      }
      if (exitCode !== 0) {
        throw new Error(`Process exited with code ${exitCode}`);
      }
      return true;
    }

    throw new Error(`${cmd}: command not found`);
  }

  attachHeaderActions() {
    const btnSave = document.getElementById('btn-save');
    const btnCompile = document.getElementById('btn-compile');
    const btnBuild = document.getElementById('btn-build');
    const btnRun = document.getElementById('btn-run');
    const btnStop = document.getElementById('btn-stop');
    const btnGraphicsWindow = document.getElementById('btn-graphics-window');
    const btnReference = document.getElementById('btn-reference');
    const btnSettings = document.getElementById('btn-settings');
    const modeSelect = document.getElementById('mode-select');
    const buildSystemSelect = document.getElementById('build-system-select');

    if (btnReference) {
      btnReference.addEventListener('click', () => {
        if (this.referenceDrawer) {
          this.referenceDrawer.toggle();
        }
      });
    }

    if (btnGraphicsWindow) {
      btnGraphicsWindow.addEventListener('click', () => {
        if (this.graphicsWindow) {
          this.graphicsWindow.toggle();
        }
      });
    }

    if (btnSettings) {
      this.settingsModal = new SettingsModal(
        this.vfs,
        { mode: this.mode, buildSystem: this.buildSystem, runCommand: this.runCommand },
        async (newConfig) => {
          this.mode = newConfig.mode;
          this.buildSystem = newConfig.buildSystem;
          if (newConfig.runCommand !== undefined) {
            this.runCommand = newConfig.runCommand;
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('wasm_c_ide_run_command', this.runCommand);
            }
          }
          if (modeSelect) modeSelect.value = newConfig.mode;
          if (buildSystemSelect) buildSystemSelect.value = newConfig.buildSystem;
          if (this.fileTreeUI) this.fileTreeUI.render();
          showToast('Settings saved.', 'success', 3000);
        },
        () => {
          if (this.fileTreeUI) this.fileTreeUI.render();
          showToast('Build scripts generated.', 'success', 3000);
        }
      );

      btnSettings.addEventListener('click', () => {
        if (this.settingsModal) {
          this.settingsModal.config.mode = this.mode;
          this.settingsModal.config.buildSystem = this.buildSystem;
          this.settingsModal.config.runCommand = this.runCommand;
        }
        this.settingsModal.show();
      });
    }

    if (modeSelect) {
      modeSelect.addEventListener('change', (e) => {
        this.mode = e.target.value;
        if (this.settingsModal) {
          this.settingsModal.config.mode = this.mode;
        }
      });
    }

    if (buildSystemSelect) {
      buildSystemSelect.addEventListener('change', (e) => {
        this.buildSystem = e.target.value;
        if (this.settingsModal) {
          this.settingsModal.config.buildSystem = this.buildSystem;
        }
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.editorManager.saveActiveFile();
        this.tabsUI.render();
        showToast('File saved.', 'success', 2000);
      });
    }

    const checkDirtyWarning = () => {
      if (this.editorManager.hasAnyDirtyFiles()) {
        showToast(
          'Warning: File has unsaved changes. Build proceeds with last saved disk state.',
          'warning',
          4000
        );
      }
    };

    if (btnCompile) {
      btnCompile.addEventListener('click', () => {
        checkDirtyWarning();
        const activePath = this.editorManager.getActivePath();
        if (!activePath) {
          showToast('No active file to compile', 'error', 3000);
          return;
        }

        // Relative path under /workspace
        const relPath = activePath.replace(/^\/workspace\/?/, '');
        if (!relPath.endsWith('.c') && !relPath.endsWith('.cpp')) {
          showToast('Active file is not a C/C++ source file', 'warning', 3000);
          return;
        }

        const baseName = relPath.split('/').pop().replace(/\.(c|cpp)$/, '');
        const objPath = `build/${baseName}.o`;
        const compiler = this.mode === 'cpp' ? 'g++' : 'gcc';

        // Strict command bridge: Type into xterm with directory stack preservation
        const cmd = `pushd . && cd /workspace && ${compiler} -Iinclude -Wall -c ${relPath} -o ${objPath}; popd`;
        this.terminal.injectCommand(cmd);
      });
    }

    if (btnBuild) {
      btnBuild.addEventListener('click', () => {
        checkDirtyWarning();
        // Strict command bridge: Type into xterm with directory stack preservation
        const buildCmd = this.buildSystem === 'make' ? 'make' : 'sh build.sh';
        const cmd = `pushd . && cd /workspace && ${buildCmd}; popd`;
        this.terminal.injectCommand(cmd);
      });
    }

    if (btnRun) {
      btnRun.addEventListener('click', () => {
        const cmd = this.runCommand || DEFAULT_RUN_COMMAND;
        this.terminal.injectCommand(cmd);
      });
    }

    if (btnStop) {
      btnStop.addEventListener('click', () => {
        this.handleStopExecution();
      });
    }

    const btnInstall = document.getElementById('btn-install');
    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        const promptEvent = this.deferredInstallPrompt || globalDeferredInstallPrompt;
        if (!promptEvent) return;
        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
          btnInstall.style.display = 'none';
        }
        this.deferredInstallPrompt = null;
        globalDeferredInstallPrompt = null;
      });
    }
  }

  handleStopExecution() {
    if (this.runtimeManager && this.runtimeManager.isRunning) {
      this.runtimeManager.kill();
    }
    if (this.toolchain && typeof this.toolchain.kill === 'function') {
      this.toolchain.kill();
    }
    if (this.graphicsWindow && this.graphicsWindow.isOpen()) {
      this.graphicsWindow.close();
    }
    if (this.shellWorker) {
      this.shellWorker.postMessage({ type: 'interrupt' });
    }
  }

  setupZoomControls() {
    // Editor Zoom Wiring
    const editorZoomLabel = document.getElementById('editor-font-size-label');
    const updateEditorZoomUI = (size) => {
      if (editorZoomLabel) editorZoomLabel.textContent = `${size}px`;
    };
    if (this.editorManager) {
      this.editorManager.onFontSizeChange = updateEditorZoomUI;
      updateEditorZoomUI(this.editorManager.getFontSize());
    }

    document.getElementById('btn-editor-zoom-in')?.addEventListener('click', () => {
      this.editorManager?.zoomIn();
    });
    document.getElementById('btn-editor-zoom-out')?.addEventListener('click', () => {
      this.editorManager?.zoomOut();
    });
    editorZoomLabel?.addEventListener('click', () => {
      this.editorManager?.resetFontSize();
    });

    // Terminal Zoom Wiring
    const termZoomLabel = document.getElementById('term-font-size-label');
    const updateTermZoomUI = (size) => {
      if (termZoomLabel) termZoomLabel.textContent = `${size}px`;
    };
    if (this.terminal) {
      this.terminal.onFontSizeChange = updateTermZoomUI;
      updateTermZoomUI(this.terminal.getFontSize());
    }

    document.getElementById('btn-term-zoom-in')?.addEventListener('click', () => {
      this.terminal?.zoomIn();
    });
    document.getElementById('btn-term-zoom-out')?.addEventListener('click', () => {
      this.terminal?.zoomOut();
    });
    termZoomLabel?.addEventListener('click', () => {
      this.terminal?.resetFontSize();
    });
  }

  setupTerminalWindowing() {
    const terminalSection = document.querySelector('.terminal-section');
    const terminalHeader = terminalSection?.querySelector('.terminal-header');
    const resizer = document.getElementById('split-resizer');
    const btnDetach = document.getElementById('btn-term-detach');
    const btnMin = document.getElementById('btn-term-min');
    const dimBadge = document.getElementById('term-dimension-badge');
    if (!terminalSection || !btnDetach || !this.terminal) return;

    let dockedHeight = terminalSection.clientHeight || 240;
    let isDetached = false;
    let isMinimized = false;
    let preMinHeight = '';
    let isProgrammaticResize = false;

    // Presets for dimension snapping
    const presets = [
      { cols: 80, rows: 24, label: '80x24' },
      { cols: 80, rows: 25, label: '80x25' },
      { cols: 100, rows: 30, label: '100x30' },
      { cols: 120, rows: 40, label: '120x40' },
      { cols: 132, rows: 24, label: '132x24' },
    ];
    let presetIdx = 0;

    const updateDimBadge = (cols, rows) => {
      if (!dimBadge) return;
      dimBadge.textContent = `${cols}x${rows}`;
      if (!isDetached) {
        dimBadge.title = `Terminal Dimensions: ${cols}x${rows} (Click to Detach 80x24)`;
        dimBadge.setAttribute('data-tooltip', 'Detach (80x24)');
      } else {
        const nextIdx = (presetIdx + 1) % presets.length;
        const next = presets[nextIdx];
        dimBadge.title = `Terminal Dimensions: ${cols}x${rows} (Click to switch to ${next.label})`;
        dimBadge.setAttribute('data-tooltip', `Switch to ${next.label}`);
      }
    };

    this.terminal.onDimensionsChange = (cols, rows) => {
      updateDimBadge(cols, rows);
    };

    // Initialize dimensions badge
    const dims = this.terminal.getGridDimensions();
    updateDimBadge(dims.cols, dims.rows);

    const detachSVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V9a.5.5 0 0 0-1 0v5H2V2h5a.5.5 0 0 0 0-1H1.5z"/>
      <path d="M10 .5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V1.707L8.854 7.854a.5.5 0 1 1-.708-.708L14.293 1H10.5a.5.5 0 0 1-.5-.5z"/>
    </svg>`;

    const dockSVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M14.5 15a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-13a.5.5 0 0 0-.5.5V7a.5.5 0 0 0 1 0V2h12v12H9a.5.5 0 0 0 0 1h5.5z"/>
      <path d="M6 15.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 1 0v3.793l6.146-6.147a.5.5 0 1 1 .708.708L1.707 15H5.5a.5.5 0 0 1 .5.5z"/>
    </svg>`;

    const minSVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 13a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 13z"/>
    </svg>`;

    const maxSVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 3h10v10H3V3zm1.5 1.5v7h7v-7h-7z"/>
    </svg>`;

    const setDetachedFocus = (focused) => {
      if (!isDetached) return;
      if (focused) {
        terminalSection.classList.add('focused');
        terminalSection.style.zIndex = '1001';
        this.terminal.focus();
      } else {
        terminalSection.classList.remove('focused');
        terminalSection.style.zIndex = '1000';
      }
    };

    const toggleMinimize = () => {
      if (!isDetached) return;
      isMinimized = !isMinimized;
      if (isMinimized) {
        preMinHeight = terminalSection.style.height || `${terminalSection.clientHeight}px`;
        terminalSection.classList.add('minimized');
        if (btnMin) {
          btnMin.innerHTML = maxSVG;
          btnMin.title = 'Maximize Terminal';
          btnMin.setAttribute('data-tooltip', 'Maximize');
          btnMin.setAttribute('aria-label', 'Maximize Terminal');
        }
      } else {
        terminalSection.classList.remove('minimized');
        if (preMinHeight) {
          terminalSection.style.height = preMinHeight;
        }
        if (btnMin) {
          btnMin.innerHTML = minSVG;
          btnMin.title = 'Minimize Terminal';
          btnMin.setAttribute('data-tooltip', 'Minimize');
          btnMin.setAttribute('aria-label', 'Minimize Terminal');
        }
        isProgrammaticResize = true;
        this.terminal.fit();
        setTimeout(() => { isProgrammaticResize = false; }, 60);
        setDetachedFocus(true);
      }
    };

    const detachTerminal = (cols = 80, rows = 24) => {
      isDetached = true;
      this.terminal.isDetached = true;
      dockedHeight = terminalSection.clientHeight || dockedHeight;

      terminalSection.classList.add('detached');
      if (resizer) resizer.classList.add('hidden');
      if (btnMin) {
        btnMin.style.display = 'inline-flex';
        btnMin.innerHTML = minSVG;
        btnMin.title = 'Minimize Terminal';
      }

      // Compute exact 80x24 window size
      const targetSize = this.terminal.computeContainerSizeForGrid(cols, rows);
      const winW = Math.min(window.innerWidth - 30, Math.max(480, targetSize.width));
      const winH = Math.min(window.innerHeight - 50, Math.max(260, targetSize.height));

      // Center floating window
      const left = Math.max(20, Math.round((window.innerWidth - winW) / 2));
      const top = Math.max(40, Math.round((window.innerHeight - winH) / 2));

      isProgrammaticResize = true;
      presetIdx = 0;
      terminalSection.style.position = 'fixed';
      terminalSection.style.left = `${left}px`;
      terminalSection.style.top = `${top}px`;
      terminalSection.style.width = `${winW}px`;
      terminalSection.style.height = `${winH}px`;
      terminalSection.style.zIndex = '1001';

      this.terminal.fixedGrid = true;
      this.terminal.setGridDimensions(cols, rows);
      updateDimBadge(cols, rows);
      setTimeout(() => { isProgrammaticResize = false; }, 80);

      btnDetach.innerHTML = dockSVG;
      btnDetach.title = 'Dock Terminal (Ctrl+Shift+D)';
      btnDetach.setAttribute('data-tooltip', 'Dock Terminal');
      btnDetach.setAttribute('aria-label', 'Dock Terminal');

      if (this.editorManager) this.editorManager.layout();
      setDetachedFocus(true);
    };

    const dockTerminal = () => {
      isDetached = false;
      this.terminal.isDetached = false;
      this.terminal.fixedGrid = false;
      if (isMinimized) {
        isMinimized = false;
        terminalSection.classList.remove('minimized');
      }

      terminalSection.classList.remove('detached');
      terminalSection.classList.remove('focused');
      if (resizer) resizer.classList.remove('hidden');
      if (btnMin) btnMin.style.display = 'none';

      terminalSection.style.position = '';
      terminalSection.style.left = '';
      terminalSection.style.top = '';
      terminalSection.style.width = '';
      terminalSection.style.height = `${dockedHeight}px`;
      terminalSection.style.zIndex = '';

      btnDetach.innerHTML = detachSVG;
      btnDetach.title = 'Detach Terminal (Floating 80x24)';
      btnDetach.setAttribute('data-tooltip', 'Detach Terminal (80x24)');
      btnDetach.setAttribute('aria-label', 'Detach Terminal');

      this.terminal.fit();
      updateDimBadge(this.terminal.term.cols, this.terminal.term.rows);
      if (this.editorManager) this.editorManager.layout();
      this.terminal.focus();
    };

    this.toggleTerminalDetach = () => {
      if (isDetached) {
        dockTerminal();
      } else {
        detachTerminal(80, 24);
      }
    };

    btnDetach.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleTerminalDetach();
    });

    btnMin?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      setDetachedFocus(true);
    });

    btnMin?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMinimize();
    });

    // Clicking dimension badge (prevents focus loss and allows cycling presets)
    dimBadge?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      setDetachedFocus(true);
    });

    dimBadge?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDetachedFocus(true);
      if (!isDetached) {
        detachTerminal(80, 24);
        return;
      }
      if (isMinimized) {
        toggleMinimize();
      }
      // If already detached, cycle through presets
      presetIdx = (presetIdx + 1) % presets.length;
      const target = presets[presetIdx];
      isProgrammaticResize = true;
      this.terminal.fixedGrid = true;
      const targetSize = this.terminal.computeContainerSizeForGrid(target.cols, target.rows);
      const winW = Math.min(window.innerWidth - 30, targetSize.width);
      const winH = Math.min(window.innerHeight - 50, targetSize.height);
      terminalSection.style.width = `${winW}px`;
      terminalSection.style.height = `${winH}px`;
      if (winW < targetSize.width || winH < targetSize.height) {
        this.terminal.fixedGrid = false;
        this.terminal.fit();
      } else {
        this.terminal.setGridDimensions(target.cols, target.rows);
      }
      updateDimBadge(this.terminal.term.cols, this.terminal.term.rows);
      setTimeout(() => {
        isProgrammaticResize = false;
        this.terminal.focus();
      }, 80);
    });

    // Bring detached window to focus on any click inside
    terminalSection.addEventListener('mousedown', () => {
      if (isDetached) {
        setDetachedFocus(true);
      }
    });

    // Header dragging & focus support
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initLeft = 0;
    let initTop = 0;

    terminalHeader?.addEventListener('mousedown', (e) => {
      if (!isDetached) return;
      setDetachedFocus(true);
      if (e.target.closest('button') || e.target.closest('.terminal-dim-badge') || e.target.closest('.pane-zoom-controls')) {
        return;
      }
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = terminalSection.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
      document.body.style.cursor = 'move';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging || !isDetached) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const maxL = window.innerWidth - 80;
      const maxT = window.innerHeight - 40;
      terminalSection.style.left = `${Math.max(0, Math.min(maxL, initLeft + dx))}px`;
      terminalSection.style.top = `${Math.max(0, Math.min(maxT, initTop + dy))}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = '';
      }
    });

    // Clicking outside unfocuses detached window
    window.addEventListener('mousedown', (e) => {
      if (isDetached && !terminalSection.contains(e.target)) {
        setDetachedFocus(false);
      }
    });

    // Terminal internal focus events
    if (this.terminal.term?.onFocus) {
      this.terminal.term.onFocus(() => {
        if (isDetached) setDetachedFocus(true);
      });
    }

    // Drag-resize observer when floating window is resized by user
    let prevW = 0;
    let prevH = 0;
    const roFloating = new ResizeObserver((entries) => {
      if (!isDetached || isMinimized) return;
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (!cr || cr.width === 0 || cr.height === 0) continue;
        if (isProgrammaticResize) {
          prevW = cr.width;
          prevH = cr.height;
          return;
        }
        if (Math.abs(cr.width - prevW) > 2 || Math.abs(cr.height - prevH) > 2) {
          prevW = cr.width;
          prevH = cr.height;
          presetIdx = -1;
          this.terminal.fixedGrid = false;
          this.terminal.fit();
          updateDimBadge(this.terminal.term.cols, this.terminal.term.rows);
        }
      }
    });
    roFloating.observe(terminalSection);

    // Global keyboard shortcut: Ctrl+Shift+D (or Cmd+Shift+D) to toggle detach/dock
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        this.toggleTerminalDetach();
      }
    });
  }

  setupSplitResizer() {
    const resizer = document.getElementById('split-resizer');
    const terminalSection = document.querySelector('.terminal-section');
    if (!resizer || !terminalSection) return;

    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    resizer.addEventListener('mousedown', (e) => {
      if (terminalSection.classList.contains('detached')) return;
      isDragging = true;
      startY = e.clientY;
      startHeight = terminalSection.clientHeight;
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging || terminalSection.classList.contains('detached')) return;
      const deltaY = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight - 150, startHeight + deltaY));
      terminalSection.style.height = `${newHeight}px`;
      if (this.editorManager) this.editorManager.layout();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = '';
        if (this.editorManager) this.editorManager.layout();
      }
    });
  }

  setupSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    const collapsedStrip = document.getElementById('sidebar-collapsed-strip');
    if (!sidebar || !resizer) return;

    // Load initial width and collapsed state from localStorage
    try {
      const savedWidth = parseInt(localStorage.getItem('wasm_c_ide_sidebar_width'), 10);
      if (Number.isFinite(savedWidth) && savedWidth >= 160 && savedWidth <= 600) {
        this.sidebarWidth = savedWidth;
      }
      const savedCollapsed = localStorage.getItem('wasm_c_ide_sidebar_collapsed');
      if (savedCollapsed === 'true') {
        this.sidebarCollapsed = true;
      }
    } catch {}

    const applyState = () => {
      if (this.sidebarCollapsed) {
        sidebar.classList.add('collapsed');
        resizer.classList.add('hidden');
        sidebar.style.width = '36px';
        if (toggleBtn) {
          toggleBtn.title = 'Expand Sidebar (Ctrl+B)';
          toggleBtn.setAttribute('data-tooltip', 'Expand (Ctrl+B)');
          toggleBtn.setAttribute('aria-label', 'Expand Sidebar');
        }
      } else {
        sidebar.classList.remove('collapsed');
        resizer.classList.remove('hidden');
        sidebar.style.width = `${this.sidebarWidth}px`;
        if (toggleBtn) {
          toggleBtn.title = 'Collapse Sidebar (Ctrl+B)';
          toggleBtn.setAttribute('data-tooltip', 'Collapse (Ctrl+B)');
          toggleBtn.setAttribute('aria-label', 'Collapse Sidebar');
        }
      }
      if (this.editorManager) this.editorManager.layout();
    };

    applyState();

    this.toggleSidebar = (force) => {
      this.sidebarCollapsed = typeof force === 'boolean' ? force : !this.sidebarCollapsed;
      try {
        localStorage.setItem('wasm_c_ide_sidebar_collapsed', String(this.sidebarCollapsed));
      } catch {}
      applyState();
    };

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSidebar();
      });
    }

    if (collapsedStrip) {
      collapsedStrip.addEventListener('click', () => {
        if (this.sidebarCollapsed) {
          this.toggleSidebar(false);
        }
      });
    }

    sidebar.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'width' && this.editorManager) {
        this.editorManager.layout();
      }
    });

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        this.toggleSidebar();
      }
    });

    // Sidebar resizer drag handling
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      if (this.sidebarCollapsed) return;
      isDragging = true;
      startX = e.clientX;
      startWidth = sidebar.clientWidth;
      sidebar.classList.add('resizing');
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging || this.sidebarCollapsed) return;
      const deltaX = e.clientX - startX;
      const maxW = Math.max(200, Math.min(600, window.innerWidth - 300));
      const newW = Math.max(160, Math.min(maxW, startWidth + deltaX));
      sidebar.style.width = `${newW}px`;
      this.sidebarWidth = newW;
      if (this.editorManager) this.editorManager.layout();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        sidebar.classList.remove('resizing');
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        try {
          localStorage.setItem('wasm_c_ide_sidebar_width', String(this.sidebarWidth));
        } catch {}
        if (this.editorManager) this.editorManager.layout();
      }
    });

    resizer.addEventListener('dblclick', () => {
      if (this.sidebarCollapsed) return;
      this.sidebarWidth = 240;
      sidebar.style.width = '240px';
      try {
        localStorage.setItem('wasm_c_ide_sidebar_width', '240');
      } catch {}
      if (this.editorManager) this.editorManager.layout();
    });
  }

  setupReferenceDrawer() {
    const mainLayout = document.querySelector('.main-layout');
    if (!mainLayout) return;

    this.referenceDrawer = new ReferenceDrawer({
      container: mainLayout,
      onOpenExample: (filename, content) => this.loadExample(filename, content),
      onToggle: () => {
        if (this.editorManager) this.editorManager.layout();
        if (this.terminal) this.terminal.fit();
      }
    });
  }

  loadExample(filename, content) {
    const targetPath = `/workspace/${filename}`;
    if (!this.vfs.exists(targetPath)) {
      this.vfs.writeFile(targetPath, content, Date.now(), true);
      if (this.fileTreeUI) {
        this.fileTreeUI.render();
      }
    }
    this.editorManager.openFile(targetPath);
    this.tabsUI.render();
    showToast(`Loaded example: ${filename}`, 'success', 3000);
  }
}

export function initApp() {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  const isIsolated = checkIsolation();

  appContainer.innerHTML = `
    <header class="app-header">
      <div class="app-title-group">
        <span>C/C++ Web IDE</span>
        <span class="isolation-badge ${isIsolated ? '' : 'unisolated'}">
          ${isIsolated ? 'Cross-Origin Isolated' : 'Not Isolated (SharedArrayBuffer Disabled)'}
        </span>
      </div>
      <div class="header-controls">
        <label for="mode-select">Mode:</label>
        <select id="mode-select" class="header-select">
          <option value="c">Pure C (C11, pedantic)</option>
          <option value="cpp">C++ (C++17)</option>
        </select>
        <label for="build-system-select">Build System:</label>
        <select id="build-system-select" class="header-select">
          <option value="sh">build.sh</option>
          <option value="make">Makefile</option>
        </select>
        <button id="btn-save" class="btn btn-save" title="Save Active File (Ctrl+S)">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.854 3.646l-1.5-1.5A.5.5 0 0 0 12 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a.5.5 0 0 0-.146-.354zM4 3h6v3H4V3zm9 10H3V3h1v3.5A.5.5 0 0 0 4.5 7h5a.5.5 0 0 0 .5-.5V3h1.793l1.207 1.207V13zM6 9h4v3H6V9z"/>
          </svg>
          <span>Save</span>
        </button>
        <button id="btn-compile" class="btn btn-compile" title="Compile Active File">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.5.5v1.2l2.5.5.3.8-1.4 1.9.8.8 2-1.4.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.8-.8-1.3-2 .3-.7 2.4-.5V7.6l-2.4-.5-.3-.7 1.3-2-.8-.8-2 1.3-.7-.2zM8 10c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
          </svg>
          <span>Compile</span>
        </button>
        <button id="btn-build" class="btn btn-primary" title="Build Project">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.7 10.7l-4.4-4.4c.4-.9.2-2-.5-2.7l-1.8-1.8c-.8-.8-2-.8-2.8 0L3.8 3.2c-.8.8-.8 2 0 2.8l1.8 1.8c.7.7 1.8.9 2.7.5l4.4 4.4c.2.2.5.2.7 0l1.3-1.3c.2-.2.2-.5 0-.7zm-8.8-5.3L4.5 4c-.4-.4-.4-1 0-1.4l1.4-1.4c.4-.4 1-.4 1.4 0l1.4 1.4c.4.4.4 1 0 1.4L7.3 5.4 5.9 4l-.7.7.7.7z"/>
          </svg>
          <span>Build</span>
        </button>
        <button id="btn-run" class="btn btn-success" title="Run Executable">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.5v11l9-5.5-9-5.5z"/>
          </svg>
          <span>Run</span>
        </button>
        <button id="btn-stop" class="btn btn-danger" title="Stop Execution">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.5 3.5h9v9h-9v-9z"/>
          </svg>
          <span>Stop</span>
        </button>
        <button id="btn-graphics-window" class="btn btn-graphics" title="Toggle Graphics Canvas Window">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.5 6.027a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm-1.5 1.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm2.5-.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm-1.5 1.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM4 6.5A.5.5 0 0 1 4.5 6h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 4 6.5z"/>
            <path d="M3.051 3.26a.5.5 0 0 1 .615-.357c.563.155 1.564.402 2.678.583a27.18 27.18 0 0 1 3.312 0c1.114-.181 2.115-.428 2.678-.583a.5.5 0 0 1 .59.822c-.2.25-.436.564-.69 1.018a10.985 10.985 0 0 0-.616 1.488c-.126.438-.204.887-.204 1.341v.003c0 1.25.405 2.44 1.134 3.411.396.527.877.986 1.408 1.353a.5.5 0 0 1 .15.688l-.75 1.25a.5.5 0 0 1-.774.137 11.026 11.026 0 0 1-2.112-2.164 12.185 12.185 0 0 1-2.81 0 11.025 11.025 0 0 1-2.112 2.164.5.5 0 0 1-.774-.137l-.75-1.25a.5.5 0 0 1 .15-.688 8.016 8.016 0 0 0 1.408-1.353c.729-.97 1.134-2.16 1.134-3.411v-.003c0-.454-.078-.903-.204-1.341a10.986 10.986 0 0 0-.616-1.488 12.24 12.24 0 0 0-.69-1.018.5.5 0 0 1 .025-.465z"/>
          </svg>
          <span>Canvas</span>
          <span class="canvas-active-dot" id="canvas-active-dot" title="Graphics frame update in background"></span>
        </button>
        <button id="btn-reference" class="btn btn-reference" title="API Reference & Cheatsheets (Ctrl+Shift+H / F1)">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94 2.85 1.084 1.353 1.542.454 1.94A.5.5 0 0 0 0 2.404v10.518a.5.5 0 0 0 .66.473c.961-.36 2.37-.777 3.754-.918 1.13-.115 2.148.04 2.898.489.262.157.625.157.888 0 .75-.449 1.768-.604 2.898-.489 1.384.141 2.793.558 3.754.918a.5.5 0 0 0 .66-.473V2.404a.5.5 0 0 0-.454-.464c-.899-.398-2.396-.856-3.833-.999-1.3-.13-2.728-.004-3.713.842z"/>
          </svg>
          <span>Docs</span>
        </button>
        <button id="btn-settings" class="btn" title="Project Settings">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14 4h-1.1a2 2 0 0 0-3.8 0H2v1h7.1a2 2 0 0 0 3.8 0H14V4zm-3 1.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM14 11H8.9a2 2 0 0 0-3.8 0H2v1h3.1a2 2 0 0 0 3.8 0H14v-1zm-7 1.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
          </svg>
          <span>Settings</span>
        </button>
        <button id="btn-install" class="btn btn-install" title="Install App to Desktop/Home Screen" style="display: none;">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
          </svg>
          <span>Install</span>
        </button>
      </div>
    </header>

    <div class="main-layout">
      <aside class="sidebar">
        <div class="sidebar-header">
          <span class="sidebar-title">Workspace</span>
          <div class="sidebar-actions">
            <div class="sidebar-action-tools">
              <button id="btn-new-file" class="icon-btn" title="New File" data-tooltip="New File" aria-label="New File">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h5v-1H3V2h5v3h3v3h1V4.5L8.5 1H9zm4 10v-2h-1v2H9v1h3v3h1v-3h3v-1h-3z"/>
                </svg>
              </button>
              <button id="btn-new-folder" class="icon-btn" title="New Folder" data-tooltip="New Folder" aria-label="New Folder">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M7.25 3l.75 1h6a1 1 0 0 1 1 1v2.5h-1V5H8l-.75-1H2v9h6v1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h4.25l1 1zm4.75 8v-2h-1v2H8v1h3v3h1v-3h3v-1h-3z"/>
                </svg>
              </button>
              <button id="btn-import-zip" class="icon-btn" title="Import Zip" data-tooltip="Import Zip" aria-label="Import Zip">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M7.5 10.5V3.707L5.354 5.854l-.708-.708L8 1.793l3.354 3.353-.708.708L8.5 3.707v6.793h-1zM2 11.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2h-1v2H3v-2H2z"/>
                </svg>
              </button>
              <button id="btn-export-zip" class="icon-btn" title="Export Zip" data-tooltip="Export Zip" aria-label="Export Zip">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8.5 1.5v6.793l2.146-2.147.708.708L8 10.207 4.646 6.854l.708-.708 2.146 2.147V1.5h1zM2 11.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2h-1v2H3v-2H2z"/>
                </svg>
              </button>
            </div>
            <button id="btn-sidebar-toggle" class="icon-btn sidebar-toggle-btn" title="Collapse Sidebar (Ctrl+B)" data-tooltip="Collapse (Ctrl+B)" aria-label="Toggle Sidebar">
              <svg id="sidebar-toggle-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M8.354 1.646a.5.5 0 0 1 0 .708L2.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
                <path fill-rule="evenodd" d="M12.354 1.646a.5.5 0 0 1 0 .708L6.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
              </svg>
            </button>
          </div>
        </div>
        <div id="file-tree" class="file-tree-container"></div>
        <div id="sidebar-collapsed-strip" class="sidebar-collapsed-strip" title="Click to Expand Workspace (Ctrl+B)">
          <span class="collapsed-title">WORKSPACE</span>
        </div>
      </aside>

      <div id="sidebar-resizer" class="sidebar-resizer" title="Drag to resize sidebar (Double-click to reset)"></div>

      <main class="content-area">
        <section class="editor-section">
          <div class="editor-header-bar">
            <div id="tabs-bar" class="tabs-bar"></div>
            <div class="pane-zoom-controls" id="editor-zoom-controls">
              <button id="btn-editor-zoom-out" class="icon-btn zoom-btn" title="Zoom Out Editor Font (Ctrl+-)" data-tooltip="Zoom Out (Ctrl+-)" aria-label="Zoom Out Editor Font">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8z"/>
                </svg>
              </button>
              <span id="editor-font-size-label" class="zoom-size-label" title="Click to Reset Font Size (13px)" data-tooltip="Click to Reset (13px)">13px</span>
              <button id="btn-editor-zoom-in" class="icon-btn zoom-btn" title="Zoom In Editor Font (Ctrl++)" data-tooltip="Zoom In (Ctrl++)" aria-label="Zoom In Editor Font">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
                </svg>
              </button>
            </div>
          </div>
          <div id="editor-container" class="editor-container"></div>
        </section>

        <div id="split-resizer" class="split-resizer"></div>

        <section class="terminal-section">
          <div class="terminal-header">
            <span class="terminal-title">Terminal</span>
            <div class="terminal-actions">
              <span id="term-dimension-badge" class="terminal-dim-badge" title="Terminal Dimensions (Click to Detach 80x24)" data-tooltip="Detach (80x24)">80x24</span>
              <div class="pane-zoom-controls" id="terminal-zoom-controls">
                <button id="btn-term-zoom-out" class="icon-btn zoom-btn" title="Zoom Out Terminal Font (Ctrl+-)" data-tooltip="Zoom Out (Ctrl+-)" aria-label="Zoom Out Terminal Font">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8z"/>
                  </svg>
                </button>
                <span id="term-font-size-label" class="zoom-size-label" title="Click to Reset Font Size (13px)" data-tooltip="Click to Reset (13px)">13px</span>
                <button id="btn-term-zoom-in" class="icon-btn zoom-btn" title="Zoom In Terminal Font (Ctrl++)" data-tooltip="Zoom In (Ctrl++)" aria-label="Zoom In Terminal Font">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
                  </svg>
                </button>
              </div>
              <button id="btn-clear-term" class="icon-btn" title="Clear Terminal" data-tooltip="Clear Terminal" aria-label="Clear Terminal">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 2V1h6v1h4v1H1V2h4zm1 3v8h1V5H6zm3 0v8h1V5H9zm-6 0v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5H3z"/>
                </svg>
              </button>
              <button id="btn-term-min" class="icon-btn" title="Minimize Terminal" data-tooltip="Minimize" aria-label="Minimize Terminal" style="display: none;">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 13a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 13z"/>
                </svg>
              </button>
              <button id="btn-term-detach" class="icon-btn" title="Detach Terminal (Floating 80x24)" data-tooltip="Detach Terminal (80x24)" aria-label="Detach Terminal">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V9a.5.5 0 0 0-1 0v5H2V2h5a.5.5 0 0 0 0-1H1.5z"/>
                  <path d="M10 .5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V1.707L8.854 7.854a.5.5 0 1 1-.708-.708L14.293 1H10.5a.5.5 0 0 1-.5-.5z"/>
                </svg>
              </button>
            </div>
          </div>
          <div id="terminal-container" class="terminal-container"></div>
        </section>
      </main>
    </div>

    <div id="toast-container" class="toast-container"></div>
  `;

  const app = new App();
  app.init().catch(err => console.error('App init error:', err));
  window.__ideApp = app;
}

window.addEventListener('DOMContentLoaded', () => {
  initApp();
});
