// Main Application Bootstrap

export function checkIsolation() {
  const isIsolated = window.crossOriginIsolated === true;
  console.log(`[Wasm C IDE] Cross-Origin Isolation: ${isIsolated ? 'ENABLED (SharedArrayBuffer available)' : 'DISABLED'}`);
  return isIsolated;
}

export function initApp() {
  const app = document.getElementById('app');
  if (!app) return;

  const isIsolated = checkIsolation();

  app.innerHTML = `
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
        <div id="file-tree" class="file-tree-container">
          <!-- File tree nodes populated dynamically -->
        </div>
      </aside>

      <main class="content-area">
        <section class="editor-section">
          <div id="tabs-bar" class="tabs-bar">
            <!-- Tabs populated dynamically -->
          </div>
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
}

window.addEventListener('DOMContentLoaded', () => {
  initApp();
});
