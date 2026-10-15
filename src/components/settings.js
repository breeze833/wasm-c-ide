// Project Settings Panel & Build File Generator

export class SettingsModal {
  constructor(vfs, config, onSave = () => {}, onGenerateBuildFiles = () => {}) {
    this.vfs = vfs;
    this.config = {
      mode: 'c',
      buildSystem: 'sh',
      enableRaylib: false,
      includePaths: ['include'],
      compilerFlags: ['-Wall', '-Wextra'],
      targetName: 'a.out',
      sources: ['src/calc.c', 'src/main.c'],
      ...config,
    };
    this.onSave = onSave;
    this.onGenerateBuildFiles = onGenerateBuildFiles;
  }

  readFormValues(modalOverlay) {
    if (!modalOverlay) return;
    const mode = modalOverlay.querySelector('#setting-mode');
    const buildSys = modalOverlay.querySelector('#setting-build-sys');
    const raylib = modalOverlay.querySelector('#setting-raylib');
    const includes = modalOverlay.querySelector('#setting-includes');
    const flags = modalOverlay.querySelector('#setting-flags');
    const target = modalOverlay.querySelector('#setting-target');

    if (mode) this.config.mode = mode.value;
    if (buildSys) this.config.buildSystem = buildSys.value;
    if (raylib) this.config.enableRaylib = raylib.checked;
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
    if (target) {
      this.config.targetName = target.value.trim() || 'a.out';
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
      <div class="modal-card">
        <div class="modal-header">
          <h3>Project & Build Settings</h3>
          <button id="modal-close-btn" class="modal-close">&times;</button>
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
          <div class="form-group" style="flex-direction: row; align-items: center; gap: 8px; margin: 4px 0;">
            <input type="checkbox" id="setting-raylib" ${this.config.enableRaylib ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
            <label for="setting-raylib" style="cursor: pointer; font-size: 13px; color: var(--text-bright); font-weight: 500;">
              🎮 Enable Raylib Graphics Support
            </label>
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
            <label for="setting-target">Output Target Binary:</label>
            <input type="text" id="setting-target" class="form-control" value="${this.config.targetName}">
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

  regenerateBuildFiles() {
    const incFlags = this.config.includePaths.map(p => `-I${p}`).join(' ');
    const extraFlags = this.config.compilerFlags.join(' ');
    const compiler = this.config.mode === 'cpp' ? 'g++' : 'gcc';
    const linkLibs = this.config.enableRaylib ? '-lraylib' : '';

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
    const linkCmd = [compiler, ...objFiles, linkLibs, '-o', this.config.targetName]
      .filter(Boolean)
      .join(' ');
    buildSh += `${linkCmd}\n`;
    buildSh += `echo "Build complete: ${this.config.targetName}"\n`;

    this.vfs.writeFile('/workspace/build.sh', buildSh);

    // 2. Generate /workspace/Makefile
    let makefile = `# Auto-generated Makefile\nCC = ${compiler}\n`;
    makefile += `CFLAGS = ${incFlags} ${extraFlags}\n`;
    if (this.config.enableRaylib) {
      makefile += `LDFLAGS = -lraylib\n`;
    }
    makefile += `TARGET = ${this.config.targetName}\n\n`;
    makefile += `all: $(TARGET)\n\n`;
    makefile += `build:\n\tmkdir -p build\n\n`;

    for (let i = 0; i < sources.length; i++) {
      makefile += `${objFiles[i]}: ${sources[i]} | build\n\t$(CC) $(CFLAGS) -c ${sources[i]} -o ${objFiles[i]}\n\n`;
    }

    const ldFlagsRef = this.config.enableRaylib ? ' $(LDFLAGS)' : '';
    makefile += `$(TARGET): ${objFiles.join(' ')}\n\t$(CC) ${objFiles.join(' ')}${ldFlagsRef} -o $(TARGET)\n\n`;
    makefile += `clean:\n\trm -rf build $(TARGET)\n`;

    this.vfs.writeFile('/workspace/Makefile', makefile);
  }
}
