// Web Worker: Sandboxed Execution Runtime for compiled a.out
// Implements WASI syscalls and synchronous stdin using SharedArrayBuffer & Atomics.wait()

const STATE_IDLE = 0;
const STATE_WAITING = 1;
const STATE_READY = 2;
const STATE_EOF = -1;

const CONTROL_STATE_IDX = 0;
const CONTROL_LEN_IDX = 1;
const CONTROL_READ_POS_IDX = 2;

const DATA_OFFSET = 16; // Byte offset in SharedArrayBuffer for stdin input data

let sharedInt32 = null;
let sharedUint8 = null;

class ProcExit extends Error {
  constructor(code) {
    super(`Exited with code ${code}`);
    this.code = code;
  }
}

const ESUCCESS = 0;
const EBADF = 8;

function readStr(u8, offset, len) {
  let str = '';
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(u8[offset + i]);
  }
  return str;
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'run') {
    const { wasmBytes, sharedBuffer, argv = ['./a.out'], environ = {} } = msg;

    if (sharedBuffer) {
      sharedInt32 = new Int32Array(sharedBuffer);
      sharedUint8 = new Uint8Array(sharedBuffer);
    }

    try {
      await runWasm(wasmBytes, argv, environ);
      self.postMessage({ type: 'done', exitCode: 0 });
    } catch (err) {
      if (err instanceof ProcExit) {
        self.postMessage({ type: 'done', exitCode: err.code });
      } else {
        self.postMessage({ type: 'error', error: err.message, stack: err.stack });
      }
    }
  }
};

async function runWasm(wasmBytes, argv, environ) {
  let memoryInstance = null;

  function memU8() {
    return new Uint8Array(memoryInstance.buffer);
  }
  function memU32() {
    return new Uint32Array(memoryInstance.buffer);
  }

  // Blocking synchronous stdin handler using Atomics
  function readStdin(iovs, iovs_len, nread_out) {
    let totalRead = 0;

    for (let i = 0; i < iovs_len; i++) {
      const bufPtr = memU32()[(iovs >> 2) + i * 2];
      const bufLen = memU32()[(iovs >> 2) + i * 2 + 1];

      let available = 0;
      if (sharedInt32) {
        let curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
        let curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        available = curLen - curPos;
      }

      if (available <= 0 && sharedInt32) {
        // Notify host that we are blocked waiting for stdin input
        self.postMessage({ type: 'stdin_request' });

        // Set state to WAITING
        Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_WAITING);

        // Synchronously block worker until main thread issues Atomics.notify()
        Atomics.wait(sharedInt32, CONTROL_STATE_IDX, STATE_WAITING);

        const state = Atomics.load(sharedInt32, CONTROL_STATE_IDX);
        if (state === STATE_EOF) {
          break;
        }

        curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
        curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        available = curLen - curPos;
      }

      if (available > 0 && sharedInt32) {
        const curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
        const toCopy = Math.min(bufLen, available);
        const target = memU8().subarray(bufPtr, bufPtr + toCopy);
        const source = sharedUint8.subarray(DATA_OFFSET + curPos, DATA_OFFSET + curPos + toCopy);

        target.set(source);
        Atomics.add(sharedInt32, CONTROL_READ_POS_IDX, toCopy);
        totalRead += toCopy;
      }

      if (totalRead > 0) break;
    }

    memU32()[nread_out >> 2] = totalRead;
    return ESUCCESS;
  }

  const wasi = {
    proc_exit(code) {
      throw new ProcExit(code);
    },

    fd_write(fd, iovs, iovs_len, nwritten_out) {
      let totalWritten = 0;
      let text = '';

      for (let i = 0; i < iovs_len; i++) {
        const ptr = memU32()[(iovs >> 2) + i * 2];
        const len = memU32()[(iovs >> 2) + i * 2 + 1];
        text += readStr(memU8(), ptr, len);
        totalWritten += len;
      }

      memU32()[nwritten_out >> 2] = totalWritten;

      if (fd === 1 || fd === 2) {
        self.postMessage({ type: 'stdout', data: text });
        return ESUCCESS;
      }

      return EBADF;
    },

    fd_read(fd, iovs, iovs_len, nread_out) {
      if (fd === 0) {
        return readStdin(iovs, iovs_len, nread_out);
      }
      memU32()[nread_out >> 2] = 0;
      return EBADF;
    },

    fd_close() { return ESUCCESS; },
    fd_seek() { return ESUCCESS; },
    fd_fdstat_get(fd, stat_out) {
      memU8().fill(0, stat_out, stat_out + 24);
      return ESUCCESS;
    },
    fd_prestat_get() { return 8; }, // EBADF
    fd_prestat_dir_name() { return 8; },

    environ_sizes_get(count_out, size_out) {
      const keys = Object.keys(environ);
      let size = 0;
      for (const k of keys) {
        size += k.length + environ[k].length + 2;
      }
      memU32()[count_out >> 2] = keys.length;
      memU32()[size_out >> 2] = size;
      return ESUCCESS;
    },

    environ_get(ptrs, buf) {
      let b = buf;
      let p = ptrs >> 2;
      for (const k of Object.keys(environ)) {
        memU32()[p++] = b;
        const entry = `${k}=${environ[k]}\0`;
        for (let i = 0; i < entry.length; i++) {
          memU8()[b++] = entry.charCodeAt(i);
        }
      }
      return ESUCCESS;
    },

    args_sizes_get(argc_out, size_out) {
      let size = 0;
      for (const a of argv) {
        size += a.length + 1;
      }
      memU32()[argc_out >> 2] = argv.length;
      memU32()[size_out >> 2] = size;
      return ESUCCESS;
    },

    args_get(ptrs, buf) {
      let b = buf;
      let p = ptrs >> 2;
      for (const a of argv) {
        memU32()[p++] = b;
        for (let i = 0; i < a.length; i++) {
          memU8()[b++] = a.charCodeAt(i);
        }
        memU8()[b++] = 0;
      }
      return ESUCCESS;
    },

    clock_time_get(clock_id, precision, time_out) {
      const now = BigInt(Date.now()) * 1000000n;
      const view = new BigInt64Array(memoryInstance.buffer);
      view[time_out >> 3] = now;
      return ESUCCESS;
    },

    random_get(buf, len) {
      crypto.getRandomValues(memU8().subarray(buf, buf + len));
      return ESUCCESS;
    },

    poll_oneoff() { return ESUCCESS; },
  };

  const module = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi,
    wasi_unstable: wasi,
    env: wasi,
  });

  memoryInstance = instance.exports.memory;

  if (typeof instance.exports._start === 'function') {
    instance.exports._start();
  } else if (typeof instance.exports.main === 'function') {
    instance.exports.main();
  }
}
