// Execution Runtime Host Manager
// Coordinates runtime.worker.js with SharedArrayBuffer and terminal stdin capture

import { InputCoordinator } from 'canvas-wasi';

const CONTROL_STATE_IDX = 0;
const CONTROL_LEN_IDX = 1;
const CONTROL_READ_POS_IDX = 2;
const DATA_OFFSET = 16;

const STATE_IDLE = 0;
const STATE_WAITING = 1;
const STATE_READY = 2;
const STATE_EOF = -1;

export class RuntimeManager {
  constructor(terminal, options = {}) {
    this.terminal = terminal;
    this.graphicsWindow = options.graphicsWindow || null;
    this.worker = null;
    this.isRunning = false;
    this.isWaitingForStdin = false;
    this.stdinLineBuffer = '';
    this.currentResolve = null;
    this.currentReject = null;
    this.currentOptions = null;

    if (typeof window !== 'undefined' && window.crossOriginIsolated) {
      this.sharedBuffer = new SharedArrayBuffer(8192);
      this.sharedInt32 = new Int32Array(this.sharedBuffer);
      this.sharedUint8 = new Uint8Array(this.sharedBuffer);

      this.raylibSharedBuffer = new SharedArrayBuffer(512);
      this.inputCoordinator = new InputCoordinator({
        sharedBuffer: this.raylibSharedBuffer,
        width: 800,
        height: 450,
      });
      if (this.graphicsWindow) {
        this.graphicsWindow.setInputCoordinator(this.inputCoordinator);
      }
    } else {
      this.sharedBuffer = null;
      this.sharedInt32 = null;
      this.sharedUint8 = null;
      this.raylibSharedBuffer = null;
      this.inputCoordinator = new InputCoordinator({
        sharedBuffer: null,
        width: 800,
        height: 450,
      });
      if (this.graphicsWindow && typeof this.graphicsWindow.setInputCoordinator === 'function') {
        this.graphicsWindow.setInputCoordinator(this.inputCoordinator);
      }
    }

    if (this.inputCoordinator) {
      this.inputCoordinator.addListener((event) => {
        if (this.worker && this.isRunning) {
          try {
            this.worker.postMessage({ type: 'input_event', event });
          } catch (_) {}
        }
      });
    }
  }

  setGraphicsWindow(graphicsWindow) {
    this.graphicsWindow = graphicsWindow;
    if (this.inputCoordinator && this.graphicsWindow && typeof this.graphicsWindow.setInputCoordinator === 'function') {
      this.graphicsWindow.setInputCoordinator(this.inputCoordinator);
    }
  }

  runBinary(wasmBytes, argv = ['./a.out'], options = {}) {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        this.kill();
      }

      this.currentResolve = resolve;
      this.currentReject = reject;
      this.currentOptions = options;

      this.isRunning = true;
      this.isWaitingForStdin = false;
      this.stdinLineBuffer = '';
      let capturedStdout = '';

      if (this.sharedInt32) {
        Atomics.store(this.sharedInt32, CONTROL_STATE_IDX, STATE_IDLE);
        Atomics.store(this.sharedInt32, CONTROL_LEN_IDX, 0);
        Atomics.store(this.sharedInt32, CONTROL_READ_POS_IDX, 0);
      }

      if (this.inputCoordinator) {
        this.inputCoordinator.reset();
      }
      if (this.raylibSharedBuffer) {
        new Uint8Array(this.raylibSharedBuffer).fill(0);
      }

      this.worker = new Worker(
        new URL('../workers/runtime.worker.js', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'stdout') {
          if (options.captureStdout) {
            capturedStdout += msg.data;
          }
          if (typeof options.onStdout === 'function') {
            options.onStdout(msg.data);
          } else if (!options.captureStdout) {
            this.terminal.write(msg.data.replace(/\r?\n/g, '\r\n'));
          }
        } else if (msg.type === 'graphics_init') {
          if (this.graphicsWindow) {
            this.graphicsWindow.open(msg.width, msg.height, msg.title);
          }
        } else if (msg.type === 'frame') {
          if (this.graphicsWindow) {
            this.graphicsWindow.renderFrame(msg.bitmap);
          }
        } else if (msg.type === 'frame_buffer') {
          if (this.graphicsWindow) {
            this.graphicsWindow.renderFrameBuffer(msg.buffer, msg.width, msg.height);
          }
        } else if (msg.type === 'fps') {
          if (this.graphicsWindow) {
            this.graphicsWindow.updateFPS(msg.fps);
          }
        } else if (msg.type === 'graphics_close') {
          if (this.graphicsWindow) {
            this.graphicsWindow.close();
          }
        } else if (msg.type === 'stdin_request') {
          this.isWaitingForStdin = true;
        } else if (msg.type === 'done') {
          const res = this.currentResolve;
          const opt = this.currentOptions;
          this.currentResolve = null;
          this.currentReject = null;
          this.currentOptions = null;
          this.cleanUp();
          if (res) {
            if (opt && opt.captureStdout) {
              res({ exitCode: msg.exitCode, stdout: capturedStdout });
            } else {
              res(msg.exitCode);
            }
          }
        } else if (msg.type === 'error') {
          const res = this.currentResolve;
          const opt = this.currentOptions;
          this.currentResolve = null;
          this.currentReject = null;
          this.currentOptions = null;
          this.cleanUp();
          this.terminal.writeln(`\r\n\x1b[31mRuntime Error: ${msg.error}\x1b[0m`);
          if (res) {
            if (opt && opt.captureStdout) {
              res({ exitCode: 1, stdout: capturedStdout });
            } else {
              res(1);
            }
          }
        }
      };

      this.worker.onerror = (err) => {
        const res = this.currentResolve;
        const opt = this.currentOptions;
        this.currentResolve = null;
        this.currentReject = null;
        this.currentOptions = null;
        this.cleanUp();
        this.terminal.writeln(`\r\n\x1b[31mRuntime Worker Error: ${err.message}\x1b[0m`);
        if (res) {
          if (opt && opt.captureStdout) {
            res({ exitCode: 1, stdout: capturedStdout });
          } else {
            res(1);
          }
        }
      };

      const stdinBytes = options.stdinBytes
        ? (typeof options.stdinBytes === 'string'
            ? new TextEncoder().encode(options.stdinBytes)
            : options.stdinBytes)
        : null;

      this.worker.postMessage({
        type: 'run',
        wasmBytes,
        sharedBuffer: this.sharedBuffer,
        raylibSharedBuffer: this.raylibSharedBuffer,
        argv,
        stdinBytes,
      });
    });
  }

  handleTerminalInput(key) {
    if (!this.isRunning || !this.isWaitingForStdin) {
      return false;
    }

    // Ctrl-D (EOT: \x04)
    if (key === '\x04') {
      if (this.stdinLineBuffer.length > 0) {
        // Flush line buffer without newline
        const lineWithoutNewline = this.stdinLineBuffer;
        this.stdinLineBuffer = '';

        if (this.sharedInt32 && this.sharedUint8) {
          const encoded = new TextEncoder().encode(lineWithoutNewline);
          const toWrite = Math.min(encoded.length, this.sharedBuffer.byteLength - DATA_OFFSET);

          this.sharedUint8.set(encoded.subarray(0, toWrite), DATA_OFFSET);
          Atomics.store(this.sharedInt32, CONTROL_LEN_IDX, toWrite);
          Atomics.store(this.sharedInt32, CONTROL_READ_POS_IDX, 0);

          Atomics.store(this.sharedInt32, CONTROL_STATE_IDX, STATE_READY);
          Atomics.notify(this.sharedInt32, CONTROL_STATE_IDX, 1);
        }

        this.isWaitingForStdin = false;
        return true;
      }

      // Empty buffer: signal EOF
      if (this.sharedInt32) {
        Atomics.store(this.sharedInt32, CONTROL_STATE_IDX, STATE_EOF);
        Atomics.notify(this.sharedInt32, CONTROL_STATE_IDX, 1);
      }

      this.isWaitingForStdin = false;
      return true;
    }

    // Enter
    if (key === '\r' || key === '\n') {
      this.terminal.writeln('');
      const lineWithNewline = this.stdinLineBuffer + '\n';
      this.stdinLineBuffer = '';

      if (this.sharedInt32 && this.sharedUint8) {
        const encoded = new TextEncoder().encode(lineWithNewline);
        const toWrite = Math.min(encoded.length, this.sharedBuffer.byteLength - DATA_OFFSET);

        this.sharedUint8.set(encoded.subarray(0, toWrite), DATA_OFFSET);
        Atomics.store(this.sharedInt32, CONTROL_LEN_IDX, toWrite);
        Atomics.store(this.sharedInt32, CONTROL_READ_POS_IDX, 0);

        // Resume runtime worker waiting on Atomics.wait
        Atomics.store(this.sharedInt32, CONTROL_STATE_IDX, STATE_READY);
        Atomics.notify(this.sharedInt32, CONTROL_STATE_IDX, 1);
      }

      this.isWaitingForStdin = false;
      return true;
    }

    // Backspace
    if (key === '\x7f' || key === '\x08') {
      if (this.stdinLineBuffer.length > 0) {
        this.stdinLineBuffer = this.stdinLineBuffer.slice(0, -1);
        this.terminal.write('\b \b');
      }
      return true;
    }

    // Printable key
    if (key.length === 1 && key >= ' ') {
      this.stdinLineBuffer += key;
      this.terminal.write(key);
      return true;
    }

    return true;
  }

  kill() {
    if (!this.isRunning) return;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.sharedInt32) {
      Atomics.store(this.sharedInt32, CONTROL_STATE_IDX, STATE_EOF);
      Atomics.notify(this.sharedInt32, CONTROL_STATE_IDX, 1);
    }

    if (this.graphicsWindow && typeof this.graphicsWindow.close === 'function') {
      this.graphicsWindow.close();
    }

    const res = this.currentResolve;
    const opt = this.currentOptions;
    this.currentResolve = null;
    this.currentReject = null;
    this.currentOptions = null;

    this.cleanUp();

    if (res) {
      if (opt && opt.captureStdout) {
        res({ exitCode: 130, stdout: '' });
      } else {
        res(130);
      }
    }
  }

  cleanUp() {
    this.isRunning = false;
    this.isWaitingForStdin = false;
    this.stdinLineBuffer = '';
    if (this.inputCoordinator) {
      this.inputCoordinator.reset();
    }
    if (this.graphicsWindow && typeof this.graphicsWindow.clearActivity === 'function') {
      this.graphicsWindow.clearActivity();
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
