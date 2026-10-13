// xterm.js Terminal Emulator Wrapper & Command Injection Bridge

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export class TerminalManager {
  constructor(containerElement, onInput = () => {}, onInterrupt = () => {}) {
    this.container = containerElement;
    this.onInput = onInput;
    this.onInterrupt = onInterrupt;
    this.onFontSizeChange = null;

    let initialFontSize = 13;
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = parseInt(localStorage.getItem('wasm_ide_term_font_size'), 10);
        if (Number.isFinite(saved) && saved >= 9 && saved <= 36) {
          initialFontSize = saved;
        }
      }
    } catch {}
    this.fontSize = initialFontSize;

    this.term = new Terminal({
      cursorBlink: true,
      fontSize: this.fontSize,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      theme: {
        background: '#181818',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      convertEol: true,
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.container);
    this.fitAddon.fit();

    // Custom Key Event Handler for Font Zoom: Ctrl/Cmd + = / - / 0
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey)) {
        if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
          this.zoomIn();
          e.preventDefault();
          return false;
        }
        if (e.key === '-' || e.code === 'NumpadSubtract') {
          this.zoomOut();
          e.preventDefault();
          return false;
        }
        if (e.key === '0') {
          this.resetFontSize();
          e.preventDefault();
          return false;
        }
      }
      return true;
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      try {
        this.fitAddon.fit();
      } catch {}
    });
    ro.observe(this.container);

    // Keystroke listener
    this.term.onData((data) => {
      // Ctrl+C is 0x03
      if (data === '\x03') {
        this.onInterrupt();
      }
      this.onInput(data);
    });
  }

  getFontSize() {
    return this.fontSize;
  }

  setFontSize(size) {
    const clamped = Math.min(36, Math.max(9, Math.round(size)));
    this.fontSize = clamped;
    this.term.options.fontSize = clamped;
    try {
      this.fitAddon.fit();
    } catch {}
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('wasm_ide_term_font_size', String(clamped));
      }
    } catch {}
    if (typeof this.onFontSizeChange === 'function') {
      this.onFontSizeChange(clamped);
    }
    return clamped;
  }

  zoomIn(delta = 1) {
    return this.setFontSize(this.fontSize + delta);
  }

  zoomOut(delta = 1) {
    return this.setFontSize(this.fontSize - delta);
  }

  resetFontSize() {
    return this.setFontSize(13);
  }

  write(data) {
    this.term.write(data);
  }

  writeln(data) {
    this.term.writeln(data);
  }

  clear() {
    this.term.clear();
  }

  focus() {
    this.term.focus();
  }

  // Strict pedagogical principle:
  // Inject command into the terminal input stream as if typed by user, followed by Enter (\r)
  injectCommand(cmd) {
    this.focus();
    // Simulate user typing input stream
    for (let i = 0; i < cmd.length; i++) {
      this.onInput(cmd[i]);
    }
    this.onInput('\r');
  }
}
