// Monaco Editor and Tab State Manager

import { monaco } from './monaco-setup.js';

function getLanguageForPath(path) {
  const filename = path.split('/').pop().toLowerCase();
  if (filename === 'makefile' || filename.endsWith('.mk')) return 'makefile';
  if (filename.endsWith('.c') || filename.endsWith('.h')) return 'c';
  if (filename.endsWith('.cpp') || filename.endsWith('.cc') || filename.endsWith('.cxx') || filename.endsWith('.hpp')) return 'cpp';
  if (filename.endsWith('.sh') || filename.endsWith('.bash')) return 'shell';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

export class EditorManager {
  constructor(containerElement, vfs, onDirtyChange = () => {}) {
    this.container = containerElement;
    this.vfs = vfs;
    this.onDirtyChange = onDirtyChange;

    this.openTabs = new Map(); // path -> { model, isDirty }
    this.activePath = null;

    this.editor = monaco.editor.create(this.container, {
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 4,
    });

    // Explicit Save: Ctrl+S / Cmd+S
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (this.activePath) {
        this.saveFile(this.activePath);
      }
    });

    // Resize listener
    window.addEventListener('resize', () => {
      this.editor.layout();
    });
  }

  layout() {
    this.editor.layout();
  }

  openFile(path) {
    if (!this.vfs.exists(path)) {
      throw new Error(`File does not exist: ${path}`);
    }

    if (this.openTabs.has(path)) {
      this.setActiveFile(path);
      return;
    }

    const diskContent = this.vfs.readFile(path);
    const lang = getLanguageForPath(path);
    const model = monaco.editor.createModel(diskContent, lang);

    const tabState = {
      model,
      isDirty: false,
    };

    model.onDidChangeContent(() => {
      const currentVal = model.getValue();
      const savedVal = this.vfs.exists(path) ? this.vfs.readFile(path) : '';
      const isDirty = currentVal !== savedVal;

      if (tabState.isDirty !== isDirty) {
        tabState.isDirty = isDirty;
        this.onDirtyChange(path, isDirty);
      }
    });

    this.openTabs.set(path, tabState);
    this.setActiveFile(path);
  }

  setActiveFile(path) {
    const tabState = this.openTabs.get(path);
    if (!tabState) return;

    this.activePath = path;
    this.editor.setModel(tabState.model);
    this.editor.focus();
  }

  closeFile(path) {
    const tabState = this.openTabs.get(path);
    if (!tabState) return;

    tabState.model.dispose();
    this.openTabs.delete(path);

    if (this.activePath === path) {
      const remaining = Array.from(this.openTabs.keys());
      if (remaining.length > 0) {
        this.setActiveFile(remaining[remaining.length - 1]);
      } else {
        this.activePath = null;
        this.editor.setModel(null);
      }
    }
  }

  saveFile(path) {
    const tabState = this.openTabs.get(path);
    if (!tabState) return;

    const content = tabState.model.getValue();
    this.vfs.writeFile(path, content);
    tabState.isDirty = false;
    this.onDirtyChange(path, false);
  }

  saveActiveFile() {
    if (this.activePath) {
      this.saveFile(this.activePath);
    }
  }

  isDirty(path) {
    const tabState = this.openTabs.get(path);
    return tabState ? tabState.isDirty : false;
  }

  hasAnyDirtyFiles() {
    for (const tabState of this.openTabs.values()) {
      if (tabState.isDirty) return true;
    }
    return false;
  }

  getActivePath() {
    return this.activePath;
  }

  getOpenFiles() {
    return Array.from(this.openTabs.keys());
  }
}
