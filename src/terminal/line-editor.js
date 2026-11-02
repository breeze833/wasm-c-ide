// Standalone, Prompt-Safe Terminal Line Editor
// Provides in-line editing, history recall, and cursor movement without overwriting external prompts

const sharedHistory = new Map();

export class LineEditor {
  constructor(options = {}) {
    this.write = options.write || (() => {});
    this.historyContext = options.historyContext || 'default';
    this.maxHistory = options.maxHistory || 200;
    this.onLine = options.onLine || null;
    this.onTab = options.onTab || null;
    this.onEof = options.onEof || null;
    this.onInterrupt = options.onInterrupt || null;

    this.buffer = '';
    this.cursor = 0;
    this.historyIndex = -1;
    this.savedScratch = '';
  }

  setHistoryContext(ctx) {
    if (this.historyContext !== ctx) {
      this.historyContext = ctx || 'default';
      this.historyIndex = -1;
      this.savedScratch = '';
    }
  }

  getHistory() {
    if (!sharedHistory.has(this.historyContext)) {
      sharedHistory.set(this.historyContext, []);
    }
    return sharedHistory.get(this.historyContext);
  }

  getBuffer() {
    return this.buffer;
  }

  getCursor() {
    return this.cursor;
  }

  reset() {
    this.buffer = '';
    this.cursor = 0;
    this.historyIndex = -1;
    this.savedScratch = '';
  }

  commitHistory(line = null) {
    const text = (line !== null ? line : this.buffer).trim();
    if (text.length > 0) {
      const hist = this.getHistory();
      if (hist.length === 0 || hist[hist.length - 1] !== text) {
        hist.push(text);
        if (hist.length > this.maxHistory) {
          hist.shift();
        }
      }
    }
    this.historyIndex = -1;
    this.savedScratch = '';
  }

  // Clear current buffer text from terminal output relative to cursor
  clearFromTerminal() {
    if (this.cursor > 0) {
      this.write('\b'.repeat(this.cursor));
    }
    this.write('\x1b[K');
  }

  setBuffer(newBuffer, newCursor = null) {
    this.clearFromTerminal();
    this.buffer = newBuffer || '';
    this.cursor = newCursor !== null ? Math.max(0, Math.min(newBuffer.length, newCursor)) : this.buffer.length;
    this.write(this.buffer);
    if (this.cursor < this.buffer.length) {
      const back = this.buffer.length - this.cursor;
      this.write('\b'.repeat(back));
    }
  }

  feed(key) {
    if (!key) return false;

    // Ctrl+C (\x03)
    if (key === '\x03') {
      if (typeof this.onInterrupt === 'function') {
        this.onInterrupt();
      }
      return true;
    }

    // Ctrl+D (\x04)
    if (key === '\x04') {
      if (typeof this.onEof === 'function') {
        this.onEof(this.buffer);
      }
      return true;
    }

    // Enter (\r or \n)
    if (key === '\r' || key === '\n') {
      const committed = this.buffer;
      this.commitHistory(committed);
      this.reset();
      if (typeof this.onLine === 'function') {
        this.onLine(committed);
      }
      return true;
    }

    // Tab (\t)
    if (key === '\t') {
      if (typeof this.onTab === 'function') {
        this.onTab(this.buffer, this.cursor);
      }
      return true;
    }

    // Backspace (\x7f or \x08)
    if (key === '\x7f' || key === '\x08') {
      if (this.cursor > 0) {
        this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
        this.cursor--;
        this.write('\b');
        const remaining = this.buffer.slice(this.cursor);
        this.write(remaining + ' ' + '\b'.repeat(remaining.length + 1));
      }
      return true;
    }

    // Delete (\x1b[3~)
    if (key === '\x1b[3~') {
      if (this.cursor < this.buffer.length) {
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        const remaining = this.buffer.slice(this.cursor);
        this.write(remaining + ' ' + '\b'.repeat(remaining.length + 1));
      }
      return true;
    }

    // Up Arrow (\x1b[A): History Backward
    if (key === '\x1b[A') {
      const hist = this.getHistory();
      if (hist.length > 0) {
        if (this.historyIndex === -1) {
          this.savedScratch = this.buffer;
          this.historyIndex = hist.length - 1;
        } else if (this.historyIndex > 0) {
          this.historyIndex--;
        }
        this.setBuffer(hist[this.historyIndex]);
      }
      return true;
    }

    // Down Arrow (\x1b[B): History Forward
    if (key === '\x1b[B') {
      const hist = this.getHistory();
      if (this.historyIndex !== -1) {
        if (this.historyIndex < hist.length - 1) {
          this.historyIndex++;
          this.setBuffer(hist[this.historyIndex]);
        } else {
          this.historyIndex = -1;
          this.setBuffer(this.savedScratch);
          this.savedScratch = '';
        }
      }
      return true;
    }

    // Left Arrow (\x1b[D)
    if (key === '\x1b[D') {
      if (this.cursor > 0) {
        this.cursor--;
        this.write('\x1b[D');
      }
      return true;
    }

    // Right Arrow (\x1b[C)
    if (key === '\x1b[C') {
      if (this.cursor < this.buffer.length) {
        this.cursor++;
        this.write('\x1b[C');
      }
      return true;
    }

    // Home (\x1b[H, \x1b[1~, \x01 Ctrl+A)
    if (key === '\x1b[H' || key === '\x1b[1~' || key === '\x01') {
      if (this.cursor > 0) {
        this.write('\b'.repeat(this.cursor));
        this.cursor = 0;
      }
      return true;
    }

    // End (\x1b[F, \x1b[4~, \x05 Ctrl+E)
    if (key === '\x1b[F' || key === '\x1b[4~' || key === '\x05') {
      if (this.cursor < this.buffer.length) {
        const diff = this.buffer.length - this.cursor;
        this.write('\x1b[' + diff + 'C');
        this.cursor = this.buffer.length;
      }
      return true;
    }

    // Ctrl+K (\x0b): Kill to end of line
    if (key === '\x0b') {
      if (this.cursor < this.buffer.length) {
        this.buffer = this.buffer.slice(0, this.cursor);
        this.write('\x1b[K');
      }
      return true;
    }

    // Ctrl+U (\x15): Clear line
    if (key === '\x15') {
      this.clearFromTerminal();
      this.buffer = '';
      this.cursor = 0;
      return true;
    }

    // Ignore other escape sequences (e.g. unknown function keys, mouse escape codes)
    if (key.startsWith('\x1b')) {
      return true;
    }

    // Printable character(s)
    let printable = '';
    for (let i = 0; i < key.length; i++) {
      const code = key.charCodeAt(i);
      if (code >= 32 || code === 9) { // >= space or tab
        printable += key[i];
      }
    }

    if (printable.length > 0) {
      this.buffer = this.buffer.slice(0, this.cursor) + printable + this.buffer.slice(this.cursor);
      this.cursor += printable.length;
      this.write(printable);
      if (this.cursor < this.buffer.length) {
        const remaining = this.buffer.slice(this.cursor);
        this.write(remaining + '\b'.repeat(remaining.length));
      }
      return true;
    }

    return true;
  }
}
