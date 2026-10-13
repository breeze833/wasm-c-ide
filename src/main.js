// Main Application Bootstrap & UI Wiring

import { VFS } from './vfs/vfs.js';
import { loadWorkspace, setupAutoSync } from './vfs/storage.js';
import { mountSysroot } from './vfs/sysroot.js';
import { EditorManager } from './editor/editor.js';
import { TabsUI } from './editor/tabs.js';
import { FileTreeUI } from './components/filetree.js';
import { showToast } from './components/toast.js';
import { TerminalManager } from './terminal/terminal.js';
import { RuntimeManager } from './terminal/runtime.js';
import { WasmToolchain } from './toolchain/wasm-clang.js';
import { executeGccCommand } from './toolchain/driver.js';

import { SettingsModal } from './components/settings.js';
import { runMake } from './toolchain/make.js';

export function checkIsolation() {
  const isIsolated = window.crossOriginIsolated === true;
  console.log(`[Wasm C IDE] Cross-Origin Isolation: ${isIsolated ? 'ENABLED' : 'DISABLED'}`);
  return isIsolated;
}

export class App {
  constructor() {
    this.vfs = new VFS();
    this.editorManager = null;
    this.tabsUI = null;
    this.fileTreeUI = null;
    this.terminal = null;
    this.runtimeManager = null;
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

    // Warm up compiler in background so memfs is ready
    this.toolchain.init().catch(err => {
      console.warn('Toolchain background pre-initialization notice:', err);
    });

    // Open default file main.c
    if (this.vfs.exists('/workspace/src/main.c')) {
      this.editorManager.openFile('/workspace/src/main.c');
    }
    this.tabsUI.render();

    // Attach Top Header Action Buttons
    this.attachHeaderActions();

    // Draggable Split Resizer between Editor and Terminal
    this.setupSplitResizer();

    // PWA Install Prompt & Connection Status Listeners
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      const btnInstall = document.getElementById('btn-install');
      if (btnInstall) {
        btnInstall.style.display = 'inline-flex';
      }
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      const btnInstall = document.getElementById('btn-install');
      if (btnInstall) {
        btnInstall.style.display = 'none';
      }
      showToast('Wasm C/C++ IDE successfully installed!', 'success', 3500);
    });

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
        if (this.runtimeManager && this.runtimeManager.isRunning) {
          this.runtimeManager.kill();
          if (this.shellWorker) {
            this.shellWorker.postMessage({ type: 'interrupt' });
          }
        } else if (this.shellWorker) {
          this.shellWorker.postMessage({ type: 'interrupt' });
        }
      }
    );

    this.runtimeManager = new RuntimeManager(this.terminal);

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
    const { cmd, args, cwd } = payload;

    if (cmd === 'gcc' || cmd === 'clang') {
      const exitCode = await executeGccCommand({
        cmd,
        args,
        cwd,
        vfs: this.vfs,
        toolchain: this.toolchain,
        mode: this.mode,
        write: (str) => this.terminal.write(str),
      });

      if (this.fileTreeUI) this.fileTreeUI.render();
      if (exitCode !== 0) {
        throw new Error(`Process terminated with exit code ${exitCode}`);
      }
      return true;
    }

    if (cmd === 'make') {
      const exitCode = await runMake({
        targetName: args[0] || 'all',
        vfs: this.vfs,
        write: (str) => this.terminal.write(str.replace(/\r?\n/g, '\r\n')),
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
            trimmed.startsWith('clang++ ') ||
            trimmed.startsWith('$(CC)')
          ) {
            const subArgs = trimmed.split(/\s+/);
            const subCmd = subArgs.shift();
            await executeGccCommand({
              cmd: subCmd,
              args: subArgs,
              cwd: cwd || '/workspace',
              vfs: this.vfs,
              toolchain: this.toolchain,
              mode: this.mode,
              write: (str) => this.terminal.write(str),
            });
            if (this.fileTreeUI) this.fileTreeUI.render();
          }
        },
      });

      if (this.fileTreeUI) this.fileTreeUI.render();
      if (exitCode !== 0) {
        throw new Error(`make: exit code ${exitCode}`);
      }
      return true;
    }

    // Binary execution: ./a.out or executable paths
    if (cmd === './a.out' || cmd.startsWith('./') || cmd.startsWith('/')) {
      const resolved = cmd.startsWith('/') ? cmd : `${cwd}/${cmd.replace(/^\.\//, '')}`;
      if (!this.vfs.exists(resolved)) {
        throw new Error(`${cmd}: no such file or directory`);
      }

      const wasmBytes = this.vfs.readFile(resolved, false);
      const exitCode = await this.runtimeManager.runBinary(wasmBytes, [cmd, ...args]);
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
    const btnSettings = document.getElementById('btn-settings');
    const modeSelect = document.getElementById('mode-select');
    const buildSystemSelect = document.getElementById('build-system-select');

    if (btnSettings) {
      this.settingsModal = new SettingsModal(
        this.vfs,
        { mode: this.mode, buildSystem: this.buildSystem },
        (newConfig) => {
          this.mode = newConfig.mode;
          this.buildSystem = newConfig.buildSystem;
          if (modeSelect) modeSelect.value = newConfig.mode;
          if (buildSystemSelect) buildSystemSelect.value = newConfig.buildSystem;
          if (this.fileTreeUI) this.fileTreeUI.render();
          showToast('Settings saved & build files regenerated.', 'success', 3000);
        }
      );

      btnSettings.addEventListener('click', () => {
        this.settingsModal.show();
      });
    }

    if (modeSelect) {
      modeSelect.addEventListener('change', (e) => {
        this.mode = e.target.value;
      });
    }

    if (buildSystemSelect) {
      buildSystemSelect.addEventListener('change', (e) => {
        this.buildSystem = e.target.value;
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

        // Strict command bridge: Type into xterm with directory stack preservation
        const cmd = `pushd . && cd /workspace && gcc -Iinclude -Wall -c ${relPath} -o ${objPath}; popd`;
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
        if (this.shellWorker) {
          this.shellWorker.postMessage({ type: 'interrupt' });
        }
      });
    }

    const btnInstall = document.getElementById('btn-install');
    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        if (!this.deferredInstallPrompt) return;
        this.deferredInstallPrompt.prompt();
        const { outcome } = await this.deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          btnInstall.style.display = 'none';
        }
        this.deferredInstallPrompt = null;
      });
    }
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
        <span>C/C++ Wasm IDE</span>
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
          <div id="tabs-bar" class="tabs-bar"></div>
          <div id="editor-container" class="editor-container"></div>
        </section>

        <div id="split-resizer" class="split-resizer"></div>

        <section class="terminal-section">
          <div class="terminal-header">
            <span>Terminal</span>
            <button id="btn-clear-term" class="icon-btn" title="Clear Terminal" data-tooltip="Clear Terminal" aria-label="Clear Terminal">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 2V1h6v1h4v1H1V2h4zm1 3v8h1V5H6zm3 0v8h1V5H9zm-6 0v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5H3z"/>
              </svg>
            </button>
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
