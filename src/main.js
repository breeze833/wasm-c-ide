// Main Application Bootstrap & UI Wiring

import { VFS } from './vfs/vfs.js';
import { loadWorkspace, setupAutoSync } from './vfs/storage.js';
import { mountSysroot } from './vfs/sysroot.js';
import { EditorManager } from './editor/editor.js';
import { TabsUI } from './editor/tabs.js';
import { FileTreeUI } from './components/filetree.js';
import { showToast } from './components/toast.js';
import { TerminalManager } from './terminal/terminal.js';

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
    this.shellWorker = null;
    this.mode = 'c'; // 'c' or 'cpp'
    this.buildSystem = 'sh'; // 'sh' or 'make'
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

    // Initialize Terminal & Shell Worker
    this.initTerminalAndShell();

    // Open default file main.c
    if (this.vfs.exists('/workspace/src/main.c')) {
      this.editorManager.openFile('/workspace/src/main.c');
    }
    this.tabsUI.render();

    // Attach Top Header Action Buttons
    this.attachHeaderActions();

    // Draggable Split Resizer between Editor and Terminal
    this.setupSplitResizer();
  }

  initTerminalAndShell() {
    const termContainer = document.getElementById('terminal-container');
    this.terminal = new TerminalManager(
      termContainer,
      (inputData) => {
        if (this.shellWorker) {
          this.shellWorker.postMessage({ type: 'input', data: inputData });
        }
      },
      () => {
        if (this.shellWorker) {
          this.shellWorker.postMessage({ type: 'interrupt' });
        }
      }
    );

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
        // Will be integrated in Milestones 5 & 6
        result = await this.executeExternalCommand(payload);
      }

      this.shellWorker.postMessage({ type: 'rpc_response', id, result });
    } catch (err) {
      this.shellWorker.postMessage({ type: 'rpc_response', id, error: err.message });
    }
  }

  async executeExternalCommand(payload) {
    const { cmd, args, rawLine } = payload;
    this.terminal.writeln(`Executing: ${rawLine}`);
    // Fallback until toolchain worker is integrated in Milestone 5:
    this.terminal.writeln(`[Command ${cmd} will be executed by toolchain/runtime worker]`);
    return true;
  }

  attachHeaderActions() {
    const btnSave = document.getElementById('btn-save');
    const btnCompile = document.getElementById('btn-compile');
    const btnBuild = document.getElementById('btn-build');
    const btnRun = document.getElementById('btn-run');
    const btnStop = document.getElementById('btn-stop');
    const modeSelect = document.getElementById('mode-select');
    const buildSystemSelect = document.getElementById('build-system-select');

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

        // Strict command bridge: Type into xterm
        const cmd = `gcc -Iinclude -Wall -c ${relPath} -o ${objPath}`;
        this.terminal.injectCommand(cmd);
      });
    }

    if (btnBuild) {
      btnBuild.addEventListener('click', () => {
        checkDirtyWarning();
        // Strict command bridge: Type into xterm
        if (this.buildSystem === 'make') {
          this.terminal.injectCommand('make');
        } else {
          this.terminal.injectCommand('sh build.sh');
        }
      });
    }

    if (btnRun) {
      btnRun.addEventListener('click', () => {
        this.terminal.injectCommand('./a.out');
      });
    }

    if (btnStop) {
      btnStop.addEventListener('click', () => {
        if (this.shellWorker) {
          this.shellWorker.postMessage({ type: 'interrupt' });
        }
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
        <button id="btn-save" class="btn" title="Save Active File (Ctrl+S)">Save</button>
        <button id="btn-compile" class="btn" title="Compile Active File">Compile</button>
        <button id="btn-build" class="btn btn-primary" title="Build Project">Build</button>
        <button id="btn-run" class="btn btn-success" title="Run Executable">Run</button>
        <button id="btn-stop" class="btn btn-danger" title="Stop Execution">Stop</button>
      </div>
    </header>

    <div class="main-layout">
      <aside class="sidebar">
        <div class="sidebar-header">
          <span>Workspace</span>
          <div class="sidebar-actions">
            <button id="btn-new-file" class="icon-btn" title="New File">+ File</button>
            <button id="btn-new-folder" class="icon-btn" title="New Folder">+ Folder</button>
            <button id="btn-export-zip" class="icon-btn" title="Export Zip">Export</button>
            <button id="btn-import-zip" class="icon-btn" title="Import Zip">Import</button>
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
            <button id="btn-clear-term" class="icon-btn" title="Clear Terminal">Clear</button>
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
