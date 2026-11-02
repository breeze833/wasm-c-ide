// Project Settings Panel & Build File Generator
import { clearWasmCache } from '../toolchain/wasm-cache.js';

export const DEFAULT_RUN_COMMAND = 'pushd . && cd /workspace && ./a.out; popd';

export async function upgradeSystemFiles() {
  // 1. Clear IndexedDB compiler cache (llvm-box.wasm)
  try {
    await clearWasmCache();
  } catch (err) {
    console.warn('[Upgrade] Failed to clear wasm cache:', err);
  }

  // 2. Clear all Service Worker CacheStorage
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (err) {
    console.warn('[Upgrade] Failed to clear CacheStorage:', err);
  }

  // 3. Update Service Worker registration if active
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update().catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[Upgrade] Failed to update Service Worker registration:', err);
  }

  // 4. Reload page to fetch fresh system assets
  if (typeof window !== 'undefined' && window.location) {
    window.location.reload();
  }
}

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class SettingsModal {
  constructor(vfs, config = {}, onSave = () => {}, onGenerateBuildFiles = () => {}) {
    this.vfs = vfs;
    const rawLinker = (config && config.linkerFlags !== undefined)
      ? config.linkerFlags
      : (config && config.targetName !== undefined
          ? (config.targetName.startsWith('-o') ? config.targetName : `-o ${config.targetName}`)
          : '-o a.out');

    this.config = {
      mode: 'c',
      buildSystem: 'sh',
      includePaths: ['include'],
      compilerFlags: ['-Wall', '-Wextra'],
      linkerFlags: rawLinker,
      targetName: this.extractTarget(rawLinker),
      runCommand: (config && config.runCommand !== undefined) ? config.runCommand : DEFAULT_RUN_COMMAND,
      sources: ['src/calc.c', 'src/main.c'],
      ...config,
    };
    if (this.config.linkerFlags) {
      this.config.targetName = this.extractTarget(this.config.linkerFlags);
    }
    if (this.config.runCommand === undefined) {
      this.config.runCommand = DEFAULT_RUN_COMMAND;
    }
    this.onSave = onSave;
    this.onGenerateBuildFiles = onGenerateBuildFiles;
  }

  extractTarget(linkerFlags) {
    if (!linkerFlags || typeof linkerFlags !== 'string') return 'a.out';
    const match = linkerFlags.match(/(?:^|\s)-o\s*([^\s]+)/);
    if (match) return match[1];
    const token = linkerFlags.trim().split(/\s+/).find(t => !t.startsWith('-'));
    return token || 'a.out';
  }

  readFormValues(modalOverlay) {
    if (!modalOverlay) return;
    const mode = modalOverlay.querySelector('#setting-mode');
    const buildSys = modalOverlay.querySelector('#setting-build-sys');
    const includes = modalOverlay.querySelector('#setting-includes');
    const flags = modalOverlay.querySelector('#setting-flags');
    const linkerEl = modalOverlay.querySelector('#setting-linker-flags');
    const targetEl = modalOverlay.querySelector('#setting-target');
    const linkerFlags = (linkerEl && linkerEl.value !== undefined && linkerEl.value !== '')
      ? linkerEl
      : (targetEl && targetEl.value !== undefined && targetEl.value !== '')
        ? targetEl
        : (linkerEl || targetEl);

    if (mode) this.config.mode = mode.value;
    if (buildSys) this.config.buildSystem = buildSys.value;
    if (includes) {
      this.config.includePaths = includes.value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
    if (flags) {
      this.config.compilerFlags = flags.value
        .split(' ')
        .map(s => s.trim())
        .filter(Boolean);
    }
    if (linkerFlags) {
      const val = linkerFlags.value.trim();
      const resolved = val ? (val.startsWith('-') ? val : `-o ${val}`) : '-o a.out';
      this.config.linkerFlags = resolved;
      this.config.targetName = this.extractTarget(resolved);
    }
    const runCmdEl = modalOverlay.querySelector('#setting-run-cmd');
    if (runCmdEl) {
      const val = runCmdEl.value.trim();
      this.config.runCommand = val !== '' ? val : (this.config.runCommand || DEFAULT_RUN_COMMAND);
    }
  }

  show() {
    let modalOverlay = document.getElementById('settings-modal');
    if (!modalOverlay) {
      modalOverlay = document.createElement('div');
      modalOverlay.id = 'settings-modal';
      modalOverlay.className = 'modal-overlay';
      document.body.appendChild(modalOverlay);
    }

    modalOverlay.innerHTML = `
      <div class="modal-card" id="modal-card">
        <div class="modal-header">
          <h3>Project & Build Settings</h3>
          <div class="modal-header-actions">
            <button id="modal-upgrade-btn" class="btn-upgrade-system" title="Refresh compiler tools and sysroot files from server">
              <svg class="btn-icon" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 0.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H5a.5.5 0 0 1 0-1h2.5V1a.5.5 0 0 1 .5-.5z"/>
              </svg>
              <span>Update System</span>
            </button>
            <button id="modal-close-btn" class="modal-close" title="Close Settings">&times;</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="setting-mode">Language Dialect:</label>
            <select id="setting-mode" class="form-control">
              <option value="c" ${this.config.mode === 'c' ? 'selected' : ''}>Pure C (C11, -pedantic-errors)</option>
              <option value="cpp" ${this.config.mode === 'cpp' ? 'selected' : ''}>C++ (C++17, libc++)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="setting-build-sys">Default Build System:</label>
            <select id="setting-build-sys" class="form-control">
              <option value="sh" ${this.config.buildSystem === 'sh' ? 'selected' : ''}>Shell Script (build.sh)</option>
              <option value="make" ${this.config.buildSystem === 'make' ? 'selected' : ''}>Makefile (make)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="setting-includes">Include Directories (comma-separated):</label>
            <input type="text" id="setting-includes" class="form-control" value="${this.config.includePaths.join(', ')}">
          </div>
          <div class="form-group">
            <label for="setting-flags">Compiler Flags:</label>
            <input type="text" id="setting-flags" class="form-control" value="${this.config.compilerFlags.join(' ')}">
          </div>
          <div class="form-group">
            <label for="setting-linker-flags">Linker Flags:</label>
            <input type="text" id="setting-linker-flags" class="form-control" value="${this.config.linkerFlags || '-o a.out'}">
          </div>
          <div class="form-group">
            <label for="setting-run-cmd">Run Command:</label>
            <input type="text" id="setting-run-cmd" class="form-control" value="${escapeAttr(this.config.runCommand || DEFAULT_RUN_COMMAND)}">
          </div>
        </div>
        <div class="modal-footer">
          <button id="modal-cancel-btn" class="btn">Cancel</button>
          <button id="modal-generate-btn" class="btn" title="Generate build.sh and Makefile based on files in workspace">Generate Build Script</button>
          <button id="modal-save-btn" class="btn btn-primary" title="Save state and mount/unmount system files">Save</button>
        </div>
      </div>
    `;

    modalOverlay.style.display = 'flex';

    const close = () => {
      modalOverlay.style.display = 'none';
    };

    modalOverlay.querySelector('#modal-close-btn').addEventListener('click', close);
    modalOverlay.querySelector('#modal-cancel-btn').addEventListener('click', close);

    const btnUpgrade = modalOverlay.querySelector('#modal-upgrade-btn');
    if (btnUpgrade) {
      btnUpgrade.addEventListener('click', () => {
        this.showUpgradeConfirmation(modalOverlay);
      });
    }

    const btnGenerate = modalOverlay.querySelector('#modal-generate-btn');
    if (btnGenerate) {
      btnGenerate.addEventListener('click', () => {
        this.readFormValues(modalOverlay);
        this.regenerateBuildFiles();
        if (typeof this.onGenerateBuildFiles === 'function') {
          this.onGenerateBuildFiles(this.config);
        }
        const origText = btnGenerate.textContent;
        btnGenerate.textContent = '✓ Generated!';
        setTimeout(() => {
          btnGenerate.textContent = origText;
        }, 1500);
      });
    }

    const btnSave = modalOverlay.querySelector('#modal-save-btn');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.readFormValues(modalOverlay);
        this.onSave(this.config);
        close();
      });
    }
  }

  showUpgradeConfirmation(modalOverlay) {
    const modalCard = modalOverlay.querySelector('.modal-card') || modalOverlay.querySelector('#modal-card') || modalOverlay;
    if (!modalCard) return;

    let confirmOverlay = modalCard.querySelector('#upgrade-confirm-overlay');
    if (confirmOverlay) confirmOverlay.remove();

    confirmOverlay = document.createElement('div');
    confirmOverlay.id = 'upgrade-confirm-overlay';
    confirmOverlay.className = 'confirm-overlay';
    confirmOverlay.innerHTML = `
      <div class="confirm-card">
        <div class="confirm-header">
          <svg class="confirm-header-icon" width="18" height="18" viewBox="0 0 16 16" fill="#38bdf8">
            <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
            <path d="M8 0.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H5a.5.5 0 0 1 0-1h2.5V1a.5.5 0 0 1 .5-.5z"/>
          </svg>
          <h4>Refresh System Files?</h4>
        </div>
        <div class="confirm-body">
          <p>This will clear cached compiler tools (<code>llvm-box.wasm</code>) and sysroot libraries, and re-download them fresh from the server.</p>
          <div class="confirm-notice">
            <span class="confirm-notice-icon">✓</span>
            <span>Your project files and folders in <strong>/workspace</strong> will <strong>NOT</strong> be affected.</span>
          </div>
        </div>
        <div class="confirm-footer">
          <button id="confirm-cancel-btn" class="btn">Cancel</button>
          <button id="confirm-proceed-btn" class="btn btn-primary">Proceed &amp; Reload</button>
        </div>
      </div>
    `;

    modalCard.appendChild(confirmOverlay);

    const closeConfirm = () => {
      confirmOverlay.remove();
    };

    confirmOverlay.querySelector('#confirm-cancel-btn').addEventListener('click', closeConfirm);

    const btnProceed = confirmOverlay.querySelector('#confirm-proceed-btn');
    btnProceed.addEventListener('click', async () => {
      btnProceed.disabled = true;
      btnProceed.textContent = 'Refreshing...';
      await upgradeSystemFiles();
    });
  }

  regenerateBuildFiles() {
    const incFlags = this.config.includePaths.map(p => `-I${p}`).join(' ');
    const extraFlags = this.config.compilerFlags.join(' ');
    const compiler = this.config.mode === 'cpp' ? 'g++' : 'gcc';
    const linkerFlags = (this.config.linkerFlags || '-o a.out').trim();
    const targetName = this.extractTarget(linkerFlags);

    // Scan workspace for C/C++ source files
    let sources = [];
    try {
      const allFiles = this.vfs.getAllFiles('/workspace');
      sources = allFiles
        .filter(f => !f.isDir && (f.path.endsWith('.c') || f.path.endsWith('.cpp')))
        .map(f => f.path.replace(/^\/workspace\/?/, ''));
    } catch {}

    if (sources.length === 0) {
      sources = ['src/calc.c', 'src/main.c'];
    }

    const objFiles = sources.map(s => {
      const base = s.split('/').pop().replace(/\.(c|cpp)$/, '');
      return `build/${base}.o`;
    });

    // 1. Generate /workspace/build.sh
    let buildSh = `#!/bin/sh\n# Auto-generated build script\nmkdir -p build\n`;
    for (let i = 0; i < sources.length; i++) {
      const compileCmd = [compiler, incFlags, extraFlags, '-c', sources[i], '-o', objFiles[i]]
        .filter(Boolean)
        .join(' ');
      buildSh += `${compileCmd}\n`;
    }
    const linkCmd = [compiler, ...objFiles, linkerFlags]
      .filter(Boolean)
      .join(' ');
    buildSh += `${linkCmd}\n`;
    buildSh += `echo "Build complete: ${targetName}"\n`;

    this.vfs.writeFile('/workspace/build.sh', buildSh);

    // 2. Generate /workspace/Makefile
    const cflags = [incFlags, extraFlags].filter(Boolean).join(' ');
    let makefile = `# Auto-generated Makefile\nCC = ${compiler}\n`;
    makefile += `CFLAGS = ${cflags}\n`;
    makefile += `LDFLAGS = ${linkerFlags}\n`;
    makefile += `TARGET = ${targetName}\n\n`;
    makefile += `all: $(TARGET)\n\n`;
    makefile += `build:\n\tmkdir -p build\n\n`;

    for (let i = 0; i < sources.length; i++) {
      makefile += `${objFiles[i]}: ${sources[i]} | build\n\t$(CC) $(CFLAGS) -c ${sources[i]} -o ${objFiles[i]}\n\n`;
    }

    makefile += `$(TARGET): ${objFiles.join(' ')}\n\t$(CC) ${objFiles.join(' ')} $(LDFLAGS)\n\n`;
    makefile += `clean:\n\trm -rf build $(TARGET)\n`;

    this.vfs.writeFile('/workspace/Makefile', makefile);
  }
}
