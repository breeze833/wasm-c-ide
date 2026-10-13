// Main Application Bootstrap & UI Wiring

import { VFS } from './vfs/vfs.js';
import { loadWorkspace, setupAutoSync } from './vfs/storage.js';
import { mountSysroot } from './vfs/sysroot.js';
import { EditorManager } from './editor/editor.js';
import { TabsUI } from './editor/tabs.js';
import { FileTreeUI } from './components/filetree.js';
import { showToast } from './components/toast.js';

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

  attachHeaderActions() {
    const btnSave = document.getElementById('btn-save');
    const btnCompile = document.getElementById('btn-compile');
    const btnBuild = document.getElementById('btn-build');
    const btnRun = document.getElementById('btn-run');
    const btnStop = document.getElementById('btn-stop');

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
        // Dispatched to terminal in Milestone 4 & 5
      });
    }

    if (btnBuild) {
      btnBuild.addEventListener('click', () => {
        checkDirtyWarning();
        // Dispatched to terminal in Milestone 4 & 7
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
