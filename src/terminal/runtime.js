// Execution Runtime Host Manager
// Coordinates runtime.worker.js with SharedArrayBuffer and terminal stdin capture

import { InputCoordinator } from 'canvas-wasi';
import { createAudioReceiver } from 'raylib-wasi';
import { LineEditor } from 'ansi-line-editor';
import { StdinHost } from 'stdin-wasi/host';

export class RuntimeManager {
  constructor(terminal, options = {}) {
    this.terminal = terminal;
    this.graphicsWindow = options.graphicsWindow || null;
    this.audioReceiver = typeof createAudioReceiver === 'function' ? createAudioReceiver() : null;
    this.worker = null;
    this.isRunning = false;
    this.isWaitingForStdin = false;
    this.lineEditor = new LineEditor({
      write: (str) => this.terminal.write(str),
      historyContext: 'default',
    });
    this.currentResolve = null;
    this.currentReject = null;
    this.currentOptions = null;

    if (typeof window !== 'undefined' && window.crossOriginIsolated) {
      this.stdinHost = new StdinHost({ bufferSize: 8192 });
      this.sharedBuffer = this.stdinHost.getSharedBuffer();
      this.sharedInt32 = this.stdinHost.sharedInt32;
      this.sharedUint8 = this.stdinHost.sharedUint8;

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
      this.stdinHost = null;
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

  get stdinLineBuffer() {
    return this.lineEditor ? this.lineEditor.getBuffer() : '';
  }

  set stdinLineBuffer(val) {
    if (this.lineEditor) {
      if (!val) {
        this.lineEditor.reset();
      } else {
        this.lineEditor.setBuffer(val);
      }
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
      const progName = (argv && argv[0]) ? argv[0].split('/').pop().replace(/^\.\//, '') : 'default';
      this.lineEditor.setHistoryContext(progName || 'default');
      this.lineEditor.reset();
      let capturedStdout = '';

      if (this.stdinHost) {
        this.stdinHost.reset();
      } else if (this.sharedInt32) {
        Atomics.store(this.sharedInt32, 0, 0);
        Atomics.store(this.sharedInt32, 1, 0);
        Atomics.store(this.sharedInt32, 2, 0);
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
        } else if (msg.type === 'stdin_request') {
          this.isWaitingForStdin = true;
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
        } else if (msg.type && msg.type.startsWith('audio_')) {
          if (this.audioReceiver) {
            this.audioReceiver.handleMessage(msg);
          }
        } else if (msg.type === 'file_sync') {
          if (options.vfs && msg.path && msg.data) {
            try {
              options.vfs.writeFile(msg.path, msg.data);
            } catch (_) {}
          }
        } else if (msg.type === 'file_delete') {
          if (options.vfs && msg.path) {
            try {
              if (options.vfs.exists(msg.path)) {
                options.vfs.unlink(msg.path);
              }
            } catch (_) {}
          }
        } else if (msg.type === 'done') {
          if (options.vfs) {
            if (msg.changedFiles) {
              for (const [path, data] of Object.entries(msg.changedFiles)) {
                try {
                  options.vfs.writeFile(path, data);
                } catch (_) {}
              }
            }
            if (Array.isArray(msg.deletedFiles)) {
              for (const path of msg.deletedFiles) {
                try {
                  if (options.vfs.exists(path)) {
                    options.vfs.unlink(path);
                  }
                } catch (_) {}
              }
            }
          }
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

      let filesSnapshot = options.files || {};
      if (options.vfs && Object.keys(filesSnapshot).length === 0) {
        filesSnapshot = {};
        for (const f of options.vfs.getAllFiles('/workspace')) {
          if (!f.isDir) {
            filesSnapshot[f.path] = options.vfs.readFile(f.path, false);
          }
        }
      }

      const sharedSysrootBuffer = (options.vfs && options.vfs.sharedSysroot) ? options.vfs.sharedSysroot.buffer : null;

      this.worker.postMessage({
        type: 'run',
        wasmBytes,
        sharedBuffer: this.sharedBuffer,
        raylibSharedBuffer: this.raylibSharedBuffer,
        sharedSysrootBuffer,
        argv,
        environ: options.environ || {},
        stdinBytes,
        files: filesSnapshot,
      });
    });
  }

  handleTerminalInput(key) {
    if (!this.isRunning || !this.isWaitingForStdin) {
      return false;
    }

    // Ctrl-D (EOT: \x04)
    if (key === '\x04') {
      const currentBuf = this.lineEditor.getBuffer();
      if (currentBuf.length > 0) {
        // Flush line buffer without newline
        this.lineEditor.reset();

        if (this.stdinHost) {
          this.stdinHost.sendInput(currentBuf);
        } else if (this.sharedInt32 && this.sharedUint8) {
          const encoded = new TextEncoder().encode(currentBuf);
          const toWrite = Math.min(encoded.length, this.sharedBuffer.byteLength - 16);
          this.sharedUint8.set(encoded.subarray(0, toWrite), 16);
          Atomics.store(this.sharedInt32, 1, toWrite);
          Atomics.store(this.sharedInt32, 2, 0);
          Atomics.store(this.sharedInt32, 0, 2);
          Atomics.notify(this.sharedInt32, 0, 1);
        }

        this.isWaitingForStdin = false;
        return true;
      }

      // Empty buffer: signal EOF
      if (this.stdinHost) {
        this.stdinHost.sendEof();
      } else if (this.sharedInt32) {
        Atomics.store(this.sharedInt32, 0, -1);
        Atomics.notify(this.sharedInt32, 0, 1);
      }

      this.isWaitingForStdin = false;
      return true;
    }

    // Enter
    if (key === '\r' || key === '\n') {
      this.terminal.writeln('');
      const lineText = this.lineEditor.getBuffer();
      this.lineEditor.commitHistory(lineText);
      this.lineEditor.reset();
      const lineWithNewline = lineText + '\n';

      if (this.stdinHost) {
        this.stdinHost.sendInput(lineWithNewline);
      } else if (this.sharedInt32 && this.sharedUint8) {
        const encoded = new TextEncoder().encode(lineWithNewline);
        const toWrite = Math.min(encoded.length, this.sharedBuffer.byteLength - 16);
        this.sharedUint8.set(encoded.subarray(0, toWrite), 16);
        Atomics.store(this.sharedInt32, 1, toWrite);
        Atomics.store(this.sharedInt32, 2, 0);
        Atomics.store(this.sharedInt32, 0, 2);
        Atomics.notify(this.sharedInt32, 0, 1);
      }

      this.isWaitingForStdin = false;
      return true;
    }

    // All other keys: delegate to LineEditor (arrows, backspace, delete, home/end, printable chars)
    this.lineEditor.feed(key);
    return true;
  }

  kill() {
    if (!this.isRunning) return;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.stdinHost) {
      this.stdinHost.sendEof();
    } else if (this.sharedInt32) {
      Atomics.store(this.sharedInt32, 0, -1);
      Atomics.notify(this.sharedInt32, 0, 1);
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
    this.lineEditor.reset();
    if (this.inputCoordinator) {
      this.inputCoordinator.reset();
    }
    if (this.audioReceiver && typeof this.audioReceiver.handleMessage === 'function') {
      try {
        this.audioReceiver.handleMessage({ type: 'audio_close' });
      } catch (_) {}
    }
    if (this.graphicsWindow && typeof this.graphicsWindow.clearActivity === 'function') {
      this.graphicsWindow.clearActivity();
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  unlockAudio() {
    if (this.audioReceiver && typeof this.audioReceiver.resume === 'function') {
      return this.audioReceiver.resume();
    }
    return Promise.resolve();
  }
}
