/**
 * Interactive visual boot progress indicator for xterm.js terminal.
 * Displays rotating braille spinner and live download progress bar for long network operations.
 */
export class BootProgress {
  /**
   * @param {{ write?: (data: string) => void, writeln?: (data: string) => void }} terminal
   */
  constructor(terminal) {
    this.terminal = terminal;
    this.currentMessage = '';
    this.currentDetail = '';
    this.spinnerIndex = 0;
    this.spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.timer = null;
    this.isFinished = false;
  }

  /**
   * Start a new boot step message with active spinner.
   * @param {string} initialMessage
   */
  start(initialMessage) {
    if (this.isFinished) return;
    if (this.currentMessage) {
      this.completeCurrent();
    }
    this.currentMessage = initialMessage;
    this.currentDetail = '';
    this._render();
    this._startTimer();
  }

  /**
   * Update current message or download progress.
   * @param {string} [message]
   * @param {{ loaded?: number, total?: number }} [progress]
   */
  update(message, progress) {
    if (this.isFinished) return;
    if (message && message !== this.currentMessage) {
      if (this.currentMessage) {
        this.completeCurrent();
      }
      this.currentMessage = message;
      this._startTimer();
    }
    if (progress && typeof progress.loaded === 'number') {
      const { loaded, total } = progress;
      const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
      if (total && total > 0) {
        const totalMB = (total / (1024 * 1024)).toFixed(1);
        const pct = Math.min(100, Math.max(0, Math.floor((loaded / total) * 100)));
        const barWidth = 10;
        const filled = Math.min(barWidth, Math.max(0, Math.floor((loaded / total) * barWidth)));
        const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
        this.currentDetail = ` [${bar}] ${pct}% (${loadedMB}/${totalMB} MB)`;
      } else {
        this.currentDetail = ` (${loadedMB} MB)`;
      }
    } else if (progress === null) {
      this.currentDetail = '';
    }
    this._render();
  }

  /**
   * Mark current step as completed with a green checkmark.
   */
  completeCurrent() {
    if (!this.terminal || !this.currentMessage) return;
    const msg = this.currentMessage;
    this._write(`\r\x1b[2K\x1b[90m[\x1b[32m✓\x1b[90m] ${msg}\x1b[0m\r\n`);
    this.currentMessage = '';
    this.currentDetail = '';
  }

  /**
   * Report failure in current step.
   * @param {string} [errorMessage]
   */
  fail(errorMessage) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.currentMessage) {
      this._write(`\r\x1b[2K\x1b[90m[\x1b[31m✗\x1b[90m] ${this.currentMessage}\x1b[0m\r\n`);
      this.currentMessage = '';
    }
    if (this.terminal && errorMessage) {
      this._write(`\x1b[33m[!] Sysroot setup notice: ${errorMessage}\x1b[0m\r\n`);
    }
  }

  /**
   * Finish all boot progress output and display system ready banner.
   * @param {string} [finalMessage='System ready.']
   */
  finish(finalMessage = 'System ready.') {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.currentMessage) {
      this.completeCurrent();
    }
    if (this.terminal && finalMessage) {
      this._write(`\x1b[1;32m[✓]\x1b[0m ${finalMessage}\r\n`);
    }
    this.isFinished = true;
  }

  _startTimer() {
    if (this.timer || this.isFinished || !this.terminal) return;
    this.timer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this._render();
    }, 80);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  _write(str) {
    if (!this.terminal) return;
    if (typeof this.terminal.write === 'function') {
      this.terminal.write(str);
    } else if (typeof this.terminal.writeln === 'function') {
      this.terminal.writeln(str);
    }
  }

  _render() {
    if (!this.terminal || !this.currentMessage || this.isFinished) return;
    const frame = this.spinnerFrames[this.spinnerIndex];
    this._write(`\r\x1b[2K\x1b[90m[\x1b[36m${frame}\x1b[90m] ${this.currentMessage}${this.currentDetail}\x1b[0m`);
  }
}
