// Project Settings Panel & Build File Generator

export class SettingsModal {
  constructor(vfs, config, onSave = () => {}) {
    this.vfs = vfs;
    this.config = {
      mode: 'c',
      buildSystem: 'sh',
      includePaths: ['include'],
      compilerFlags: ['-Wall', '-Wextra'],
      targetName: 'a.out',
      sources: ['src/calc.c', 'src/main.c'],
      ...config,
    };
    this.onSave = onSave;
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
          <button id="modal-save-btn" class="btn btn-primary">Save & Regenerate Build Files</button>
        </div>
      </div>
    `;

    modalOverlay.style.display = 'flex';

    const close = () => {
      modalOverlay.style.display = 'none';
    };

    modalOverlay.querySelector('#modal-close-btn').addEventListener('click', close);
    modalOverlay.querySelector('#modal-cancel-btn').addEventListener('click', close);

    modalOverlay.querySelector('#modal-save-btn').addEventListener('click', () => {
      this.config.mode = modalOverlay.querySelector('#setting-mode').value;
      this.config.buildSystem = modalOverlay.querySelector('#setting-build-sys').value;
      this.config.includePaths = modalOverlay.querySelector('#setting-includes').value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      this.config.compilerFlags = modalOverlay.querySelector('#setting-flags').value
        .split(' ')
        .map(s => s.trim())
        .filter(Boolean);
      this.config.targetName = modalOverlay.querySelector('#setting-target').value.trim() || 'a.out';

      this.regenerateBuildFiles();
      this.onSave(this.config);
      close();
    });
  }

  regenerateBuildFiles() {
    const incFlags = this.config.includePaths.map(p => `-I${p}`).join(' ');
    const extraFlags = this.config.compilerFlags.join(' ');
    const compiler = this.config.mode === 'cpp' ? 'clang++' : 'gcc';

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
      buildSh += `${compiler} ${incFlags} ${extraFlags} -c ${sources[i]} -o ${objFiles[i]}\n`;
    }
    buildSh += `${compiler} ${objFiles.join(' ')} -o ${this.config.targetName}\n`;
    buildSh += `echo "Build complete: ${this.config.targetName}"\n`;

    this.vfs.writeFile('/workspace/build.sh', buildSh);

    // 2. Generate /workspace/Makefile
    let makefile = `# Auto-generated Makefile\nCC = ${compiler}\n`;
    makefile += `CFLAGS = ${incFlags} ${extraFlags}\n`;
    makefile += `TARGET = ${this.config.targetName}\n\n`;
    makefile += `all: $(TARGET)\n\n`;
    makefile += `build:\n\tmkdir -p build\n\n`;

    for (let i = 0; i < sources.length; i++) {
      makefile += `${objFiles[i]}: ${sources[i]} | build\n\t$(CC) $(CFLAGS) -c ${sources[i]} -o ${objFiles[i]}\n\n`;
    }

    makefile += `$(TARGET): ${objFiles.join(' ')}\n\t$(CC) ${objFiles.join(' ')} -o $(TARGET)\n\n`;
    makefile += `clean:\n\trm -rf build $(TARGET)\n`;

    this.vfs.writeFile('/workspace/Makefile', makefile);
  }
}
