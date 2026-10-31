// Main Application Bootstrap & UI Wiring

import { VFS } from './vfs/vfs.js';
import { loadWorkspace, setupAutoSync } from './vfs/storage.js';
import { mountSysroot, mountRaylibSysroot, unmountRaylibSysroot } from './vfs/sysroot.js';
import { EditorManager } from './editor/editor.js';
import { TabsUI } from './editor/tabs.js';
import { FileTreeUI } from './components/filetree.js';
import { showToast } from './components/toast.js';
import { TerminalManager } from './terminal/terminal.js';
import { RuntimeManager } from './terminal/runtime.js';
import { WasmToolchain } from './toolchain/wasm-clang.js';
import { executeGccCommand, executeToolCommand, executeLdCommand } from './toolchain/driver.js';
import { executeArCommand } from './toolchain/ar.js';
import { GraphicsWindowUI } from 'canvas-wasi';
import 'canvas-wasi/style.css';

import { SettingsModal } from './components/settings.js';
import { runMake } from './toolchain/make.js';

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
    this.mode = 'c'; // 'c' or 'cpp'
    this.buildSystem = 'sh'; // 'sh' or 'make'
    this.deferredInstallPrompt = null;
  }

  async init() {
    const isIsolated = checkIsolation();

    // Mount read-only sysroot headers
    mountSysroot(this.vfs);

    // Asynchronously preload libturtle.a into VFS /usr/lib/libturtle.a
    (async () => {
      try {
        let basePath = './';
        if (typeof window !== 'undefined' && window.location) {
          const baseUrl = import.meta.env?.BASE_URL || './';
          let loc = new URL(window.location.href);
          if (!loc.pathname.endsWith('/') && !loc.pathname.split('/').pop().includes('.')) {
            loc.pathname += '/';
          }
          basePath = new URL(baseUrl, loc.href).href;
          if (!basePath.endsWith('/')) basePath += '/';
        }
        const res = await fetch(`${basePath}sysroot/wasm/libturtle.a`);
        if (res && res.ok) {
          const buf = await res.arrayBuffer();
          const u8 = new Uint8Array(buf);
          this.vfs.writeFile('/usr/lib/libturtle.a', u8, Date.now(), true);
          this.vfs.writeFile('/usr/lib/libturtle_canvas-wasi.a', u8, Date.now(), true);
        }
      } catch {}
    })();

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

    // Initialize Terminal, Shell Worker & Runtime
    this.initTerminalAndShell();

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

    this.toolchain = new WasmToolchain({
      basePath: wasmBasePath,
      vfs: this.vfs,
      hostWrite: (str) => {
        if (this.terminal) {
          this.terminal.write(str.replace(/\r?\n/g, '\r\n'));
        }
      },
    });

    // Warm up compiler in background so sysroot and llvm-box are ready
    this.toolchain.init().then(() => {
      return this.toolchain._getLlvmBox({ silent: true });
    }).catch(err => {
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

    // Draggable Split Resizer between Editor and Terminal
    this.setupSplitResizer();

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

  initTerminalAndShell() {
    const termContainer = document.getElementById('terminal-container');
    this.terminal = new TerminalManager(
      termContainer,
      (inputData) => {
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
        this.handleStopExecution();
      }
    );

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

      // Handle VFS RPC requests from shell worker
      if (msg.type.startsWith('vfs_') || msg.type === 'exec_command') {
        this.handleWorkerRpc(msg);
      }
    };

    this.shellWorker.postMessage({ type: 'init', cwd: '/workspace' });

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
    const { cmd, args, cwd, stdinData, captureStdout, stdoutRedirect } = payload;
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

    if (cmd === 'gcc' || cmd === 'clang' || cmd === 'g++' || cmd === 'clang++' || cmd === 'clang-cpp') {
      const effectiveMode = (cmd === 'g++' || cmd === 'clang++') ? 'cpp' : this.mode;
      const exitCode = await executeGccCommand({
        cmd,
        args,
        cwd,
        vfs: this.vfs,
        toolchain: this.toolchain,
        mode: effectiveMode,
        write: writeFn,
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

    if (cmd === 'ld' || cmd === 'lld' || cmd === 'wasm-ld' || cmd === 'ld.lld') {
      const exitCode = await executeLdCommand({
        cmd,
        args,
        cwd: cwd || '/workspace',
        vfs: this.vfs,
        toolchain: this.toolchain,
        write: writeFn,
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

    if (['ar', 'ranlib', 'nm', 'objdump', 'size', 'c++filt', 'cxxfilt', 'strings', 'readelf', 'strip'].includes(cmd)) {
      const toolMap = {
        'c++filt': 'cxxfilt',
        'readelf': 'readobj',
      };
      const activeTool = toolMap[cmd] || cmd;
      const exitCode = await executeToolCommand({
        cmd: activeTool,
        args,
        cwd: cwd || '/workspace',
        vfs: this.vfs,
        toolchain: this.toolchain,
        write: writeFn,
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

    if (cmd === 'make') {
      const exitCode = await runMake({
        targetName: args[0] || 'all',
        vfs: this.vfs,
        write: (str) => writeFn(str.replace(/\r?\n/g, '\r\n')),
        executeCommand: async (cmdLine) => {
          const trimmed = cmdLine.trim();
          if (!trimmed) return;

          if (trimmed.startsWith('rm ')) {
            const rmParts = trimmed.split(/\s+/).slice(1);
            const rmTargets = rmParts.filter(p => !p.startsWith('-'));
            for (const t of rmTargets) {
              const norm = `/workspace/${t}`;
              if (this.vfs.exists(norm)) this.vfs.remove(norm, true);
            }
            if (this.fileTreeUI) this.fileTreeUI.render();
          } else if (trimmed.startsWith('mkdir ')) {
            const dir = trimmed.split(/\s+/).pop();
            this.vfs.mkdir(`/workspace/${dir}`, true);
            if (this.fileTreeUI) this.fileTreeUI.render();
          } else if (
            trimmed.startsWith('gcc ') ||
            trimmed.startsWith('clang ') ||
            trimmed.startsWith('g++ ') ||
            trimmed.startsWith('clang++ ') ||
            trimmed.startsWith('$(CC)') ||
            trimmed.startsWith('$(CXX)')
          ) {
            const subArgs = trimmed.split(/\s+/);
            const subCmd = subArgs.shift();
            const subMode = (subCmd === 'g++' || subCmd === 'clang++' || subCmd === '$(CXX)') ? 'cpp' : this.mode;
            const exitCode = await executeGccCommand({
              cmd: subCmd,
              args: subArgs,
              cwd: cwd || '/workspace',
              vfs: this.vfs,
              toolchain: this.toolchain,
              mode: subMode,
              write: writeFn,
            });
            if (this.fileTreeUI) this.fileTreeUI.render();
            return exitCode;
          } else if (trimmed.startsWith('ar ') || trimmed.startsWith('$(AR)')) {
            const subArgs = trimmed.split(/\s+/);
            subArgs.shift();
            const exitCode = await executeArCommand({
              args: subArgs,
              cwd: cwd || '/workspace',
              vfs: this.vfs,
              toolchain: this.toolchain,
              write: writeFn,
            });
            if (this.fileTreeUI) this.fileTreeUI.render();
            return exitCode;
          }
        },
      });

      if (this.fileTreeUI) this.fileTreeUI.render();
      await flushStdoutRedirect();

      if (captureStdout) {
        return { exitCode, stdout: capturedStdout };
      }
      if (exitCode !== 0) {
        throw new Error(`make: exit code ${exitCode}`);
      }
      return true;
    }

    // Binary execution: ./a.out, a.out, or executable paths
    let execPath = null;
    if (cmd === './a.out' || cmd === 'a.out' || cmd.startsWith('./') || cmd.startsWith('/')) {
      execPath = cmd.startsWith('/') ? cmd : `${cwd}/${cmd.replace(/^\.\//, '')}`;
    } else if (this.vfs.exists(`${cwd}/${cmd}`)) {
      execPath = `${cwd}/${cmd}`;
    }

    if (execPath) {
      if (!this.vfs.exists(execPath)) {
        throw new Error(`${cmd}: no such file or directory`);
      }

      const wasmBytes = this.vfs.readFile(execPath, false);
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

  async syncRaylibState(enabled) {
    if (enabled) {
      if (!this.vfs.exists('/usr/include/raylib.h') || !this.vfs.exists('/usr/lib/libraylib.a')) {
        try {
          let basePath = './';
          if (typeof window !== 'undefined' && window.location) {
            const baseUrl = import.meta.env?.BASE_URL || './';
            let loc = new URL(window.location.href);
            if (!loc.pathname.endsWith('/') && !loc.pathname.split('/').pop().includes('.')) {
              loc.pathname += '/';
            }
            basePath = new URL(baseUrl, loc.href).href;
            if (!basePath.endsWith('/')) basePath += '/';
          }
          const [raylibH, raymathH, rlglH, libA, turtleRaylibH, turtleRaylibLibA] = await Promise.all([
            fetch(`${basePath}sysroot/include/raylib/raylib.h`).then(r => r.text()),
            fetch(`${basePath}sysroot/include/raylib/raymath.h`).then(r => r.text()),
            fetch(`${basePath}sysroot/include/raylib/rlgl.h`).then(r => r.text()),
            fetch(`${basePath}sysroot/wasm/libraylib.a`).then(r => r.arrayBuffer()),
            fetch(`${basePath}sysroot/include/turtle/turtle_backend_raylib.h`).then(r => r.ok ? r.text() : '').catch(() => ''),
            fetch(`${basePath}sysroot/wasm/libturtle_raylib.a`).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
          ]);
          mountRaylibSysroot(this.vfs, {
            'raylib.h': raylibH,
            'raymath.h': raymathH,
            'rlgl.h': rlglH,
            'turtle_backend_raylib.h': turtleRaylibH,
          }, new Uint8Array(libA), {}, turtleRaylibLibA ? new Uint8Array(turtleRaylibLibA) : null);
        } catch (err) {
          console.warn('Failed to mount Raylib sysroot:', err);
        }
      }
    } else {
      unmountRaylibSysroot(this.vfs, this.toolchain);
    }
    if (this.fileTreeUI) this.fileTreeUI.render();
  }

  attachHeaderActions() {
    const btnSave = document.getElementById('btn-save');
    const btnCompile = document.getElementById('btn-compile');
    const btnBuild = document.getElementById('btn-build');
    const btnRun = document.getElementById('btn-run');
    const btnStop = document.getElementById('btn-stop');
    const btnGraphicsWindow = document.getElementById('btn-graphics-window');
    const btnSettings = document.getElementById('btn-settings');
    const modeSelect = document.getElementById('mode-select');
    const buildSystemSelect = document.getElementById('build-system-select');

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
        { mode: this.mode, buildSystem: this.buildSystem },
        async (newConfig) => {
          this.mode = newConfig.mode;
          this.buildSystem = newConfig.buildSystem;
          if (modeSelect) modeSelect.value = newConfig.mode;
          if (buildSystemSelect) buildSystemSelect.value = newConfig.buildSystem;
          await this.syncRaylibState(Boolean(newConfig.enableRaylib));
          if (this.fileTreeUI) this.fileTreeUI.render();
          showToast('Settings saved.', 'success', 3000);
        },
        () => {
          if (this.fileTreeUI) this.fileTreeUI.render();
          showToast('Build scripts generated.', 'success', 3000);
        }
      );

      // Restore Raylib state if enabled in settings
      if (this.settingsModal.config && this.settingsModal.config.enableRaylib) {
        this.syncRaylibState(true);
      }

      btnSettings.addEventListener('click', () => {
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
        const cmd = 'pushd . && cd /workspace && ./a.out; popd';
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

  setupSplitResizer() {
    const resizer = document.getElementById('split-resizer');
    const terminalSection = document.querySelector('.terminal-section');
    if (!resizer || !terminalSection) return;

    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      startY = e.clientY;
      startHeight = terminalSection.clientHeight;
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
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
          <span>Workspace</span>
          <div class="sidebar-actions">
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
        </div>
        <div id="file-tree" class="file-tree-container"></div>
      </aside>

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
            <span>Terminal</span>
            <div class="terminal-actions">
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
