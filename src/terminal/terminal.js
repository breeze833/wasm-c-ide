// xterm.js Terminal Emulator Wrapper & Command Injection Bridge

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export class TerminalManager {
  constructor(containerElement, onInput = () => {}, onInterrupt = () => {}) {
    this.container = containerElement;
    this.onInput = onInput;
    this.onInterrupt = onInterrupt;

    this.term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
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
