// WebAssembly Clang and LLD Driver
// Encapsulates Clang, LLD, MemFS, and Sysroot execution inside the browser

import { Tar } from './tar.js';

class ProcExit extends Error {
  constructor(code) {
    super(`process exited with code ${code}.`);
    this.code = code;
  }
}

class Memory {
  constructor(memory) {
    this.memory = memory;
    this.buffer = this.memory.buffer;
    this.u8 = new Uint8Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
  }

  check() {
    if (this.buffer.byteLength === 0 || this.buffer !== this.memory.buffer) {
      this.buffer = this.memory.buffer;
      this.u8 = new Uint8Array(this.buffer);
      this.u32 = new Uint32Array(this.buffer);
    }
  }

  read8(o) { return this.u8[o]; }
  read32(o) { return this.u32[o >> 2]; }
  write8(o, v) { this.u8[o] = v; }
  write32(o, v) { this.u32[o >> 2] = v; }
  write64(o, vlo, vhi = 0) { this.write32(o, vlo); this.write32(o + 4, vhi); }

  readStr(o, len = -1) {
    let str = '';
    const end = len !== -1 ? o + len : this.u8.length;
    for (let i = o; i < end && this.u8[i] !== 0; ++i) {
      str += String.fromCharCode(this.u8[i]);
    }
    return str;
  }

  writeStr(o, str) {
    o += this.write(o, str);
    this.write8(o, 0);
    return str.length + 1;
  }

  write(o, buf) {
    if (buf instanceof ArrayBuffer) {
      return this.write(o, new Uint8Array(buf));
    } else if (typeof buf === 'string') {
      const encoded = new TextEncoder().encode(buf);
      return this.write(o, encoded);
    } else {
      this.check();
      const dst = new Uint8Array(this.buffer, o, buf.length);
      dst.set(buf);
      return buf.length;
    }
  }
}

const ESUCCESS = 0;

class MemFS {
  constructor(memfsBuffer, hostWrite = () => {}, instance = null) {
    this.hostWrite = hostWrite;
    this.hostMem_ = null;
    this.directories = new Set(['', '/', '.']);
    this.files = new Set();

    if (instance) {
      this.instance = instance;
    } else {
      const env = {
        abort: () => { throw new Error('MemFS abort'); },
        host_write: this.host_write.bind(this),
        host_read: this.host_read.bind(this),
        memfs_log: this.memfs_log.bind(this),
        copy_in: this.copy_in.bind(this),
        copy_out: this.copy_out.bind(this),
      };
      const module = new WebAssembly.Module(memfsBuffer);
      this.instance = new WebAssembly.Instance(module, { env });
    }
    this.exports = this.instance.exports;
    this.mem = new Memory(this.exports.memory);
    this.exports.init();
  }

  static async create(memfsBuffer, hostWrite = () => {}) {
    let memfsInstance;
    const env = {
      abort: () => { throw new Error('MemFS abort'); },
      host_write: (...args) => memfsInstance.host_write(...args),
      host_read: (...args) => memfsInstance.host_read(...args),
      memfs_log: (...args) => memfsInstance.memfs_log(...args),
      copy_in: (...args) => memfsInstance.copy_in(...args),
      copy_out: (...args) => memfsInstance.copy_out(...args),
    };

    const res = await WebAssembly.instantiate(memfsBuffer, { env });
    const instance = res instanceof WebAssembly.Instance ? res : (res.instance || res);
    memfsInstance = new MemFS(memfsBuffer, hostWrite, instance);
    return memfsInstance;
  }

  set hostMem(mem) {
    this.hostMem_ = mem;
  }

  ensureDirectory(path) {
    const clean = (path || '').replace(/^\/+|\/+$/g, '');
    if (!clean) return;
    const parts = clean.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.directories.has(current)) {
        this.addDirectory(current);
      }
    }
  }

  addDirectory(path) {
    const cleanPath = (path || '').replace(/^\/+|\/+$/g, '');
    if (!cleanPath || this.directories.has(cleanPath)) return;

    // Ensure parent directory exists first to prevent MemFS lookup.parent abort
    const lastSlash = cleanPath.lastIndexOf('/');
    if (lastSlash !== -1) {
      this.ensureDirectory(cleanPath.substring(0, lastSlash));
    }

    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), cleanPath);
    this.exports.AddDirectoryNode(cleanPath.length);
    this.directories.add(cleanPath);
  }

  addFile(path, contents) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    const lastSlash = cleanPath.lastIndexOf('/');
    if (lastSlash !== -1) {
      this.ensureDirectory(cleanPath.substring(0, lastSlash));
    }

    let data = contents;
    if (typeof contents === 'string') {
      data = new TextEncoder().encode(contents);
    }
    const length = data instanceof ArrayBuffer
      ? data.byteLength
      : data.length;
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), cleanPath);
    const inode = this.exports.AddFileNode(cleanPath.length, length);
    const addr = this.exports.GetFileNodeAddress(inode);
    this.mem.check();
    this.mem.write(addr, data);
    this.files.add(cleanPath);
  }

  hasFile(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    return this.files.has(cleanPath);
  }

  getFileContents(path) {
    try {
      const cleanPath = (path || '').replace(/^\/+/, '');
      this.mem.check();
      this.mem.write(this.exports.GetPathBuf(), cleanPath);
      const inode = this.exports.FindNode(cleanPath.length);
      if (!inode) return null;
      const addr = this.exports.GetFileNodeAddress(inode);
      const size = this.exports.GetFileNodeSize(inode);
      return new Uint8Array(this.mem.buffer.slice(addr, addr + size));
    } catch {
      // FindNode asserts lookup.node on missing files and traps with unreachable; catch cleanly
      return null;
    }
  }

  removeFile(path) {
    try {
      const cleanPath = (path || '').replace(/^\/+/, '');
      if (!cleanPath) return false;
      const prevHostMem = this.hostMem_;
      this.hostMem_ = null;
      try {
        this.mem.check();
        const pathBuf = this.exports.GetPathBuf();
        this.mem.write(pathBuf, cleanPath);
        const res = this.exports.path_unlink_file(3, pathBuf, cleanPath.length);
        this.files.delete(cleanPath);
        return res === ESUCCESS;
      } finally {
        this.hostMem_ = prevHostMem;
      }
    } catch {
      const cleanPath = (path || '').replace(/^\/+/, '');
      this.files.delete(cleanPath);
      return false;
    }
  }

  host_write(fd, iovs, iovs_len, nwritten_out) {
    this.hostMem_.check();
    let size = 0;
    let str = '';
    for (let i = 0; i < iovs_len; ++i) {
      const buf = this.hostMem_.read32(iovs);
      iovs += 4;
      const len = this.hostMem_.read32(iovs);
      iovs += 4;
      str += this.hostMem_.readStr(buf, len);
      size += len;
    }
    this.hostMem_.write32(nwritten_out, size);
    this.hostWrite(str);
    return ESUCCESS;
  }

  host_read(fd, iovs, iovs_len, nread) {
    this.hostMem_.check();
    this.hostMem_.write32(nread, 0);
    return ESUCCESS;
  }

  memfs_log(buf, len) {
    this.mem.check();
    console.log('[memfs]', this.mem.readStr(buf, len));
  }

  copy_out(clang_dst, memfs_src, size) {
    const targetMem = this.hostMem_ || this.mem;
    targetMem.check();
    const dst = new Uint8Array(targetMem.buffer, clang_dst, size);
    this.mem.check();
    const src = new Uint8Array(this.mem.buffer, memfs_src, size);
    dst.set(src);
  }

  copy_in(memfs_dst, clang_src, size) {
    this.mem.check();
    const dst = new Uint8Array(this.mem.buffer, memfs_dst, size);
    const sourceMem = this.hostMem_ || this.mem;
    sourceMem.check();
    const src = new Uint8Array(sourceMem.buffer, clang_src, size);
    dst.set(src);
  }
}

class AppInstance {
  constructor(memfs, name, ...args) {
    this.argv = [name, ...args];
    this.environ = { USER: 'student', PWD: '/workspace' };
    this.memfs = memfs;
    this.instance = null;
    this.exports = null;
    this.mem = null;
  }

  _buildImports() {
    const wasi_unstable = {
      proc_exit: (code) => { throw new ProcExit(code); },
      environ_sizes_get: (count_out, size_out) => {
        this.mem.check();
        let size = 0;
        const keys = Object.keys(this.environ);
        for (const k of keys) {
          size += k.length + this.environ[k].length + 2;
        }
        this.mem.write64(count_out, keys.length);
        this.mem.write64(size_out, size);
        return ESUCCESS;
      },
      environ_get: (ptrs, buf) => {
        this.mem.check();
        for (const k of Object.keys(this.environ)) {
          this.mem.write32(ptrs, buf);
          ptrs += 4;
          buf += this.mem.writeStr(buf, `${k}=${this.environ[k]}`);
        }
        this.mem.write32(ptrs, 0);
        return ESUCCESS;
      },
      args_sizes_get: (argc_out, size_out) => {
        this.mem.check();
        let size = 0;
        for (const a of this.argv) {
          size += a.length + 1;
        }
        this.mem.write64(argc_out, this.argv.length);
        this.mem.write64(size_out, size);
        return ESUCCESS;
      },
      args_get: (ptrs, buf) => {
        this.mem.check();
        for (const a of this.argv) {
          this.mem.write32(ptrs, buf);
          ptrs += 4;
          buf += this.mem.writeStr(buf, a);
        }
        this.mem.write32(ptrs, 0);
        return ESUCCESS;
      },
      random_get: (buf, len) => {
        this.mem.check();
        const data = new Uint8Array(this.mem.buffer, buf, len);
        crypto.getRandomValues(data);
        return ESUCCESS;
      },
      clock_time_get: () => ESUCCESS,
      poll_oneoff: () => ESUCCESS,
    };

    // Overlay memfs WASI filesystem operations
    Object.assign(wasi_unstable, this.memfs.exports);

    return {
      wasi_unstable,
      wasi_snapshot_preview1: wasi_unstable,
      env: {},
    };
  }

  _attachInstance(instance) {
    this.instance = instance;
    this.exports = this.instance.exports;
    this.mem = this.exports.memory ? new Memory(this.exports.memory) : null;
    if (this.mem) {
      this.memfs.hostMem = this.mem;
    }
  }

  static async create(module, memfs, name, ...args) {
    const app = new AppInstance(memfs, name, ...args);
    const imports = app._buildImports();
    const res = await WebAssembly.instantiate(module, imports);
    const instance = res instanceof WebAssembly.Instance ? res : (res.instance || res);
    app._attachInstance(instance);
    return app;
  }

  run() {
    try {
      if (typeof this.exports._start === 'function') {
        this.exports._start();
      }
      return 0;
    } catch (err) {
      if (err instanceof ProcExit) {
        return err.code;
      }
      throw err;
    }
  }
}

export class WasmToolchain {
  constructor(options = {}) {
    this.basePath = (options.basePath || '/sysroot/wasm').replace(/\/+$/, '');
    this.hostWrite = options.hostWrite || console.log;
    this.vfs = options.vfs || null;
    this.memfs = null;
    this.clangModule = null;
    this.lldModule = null;
    this.initialized = false;
    this.initPromise = null;
  }

  ensureDirectoryInMemfs(dirPath) {
    if (this.memfs) {
      this.memfs.ensureDirectory(dirPath);
    }
  }

  async init(onProgress = () => {}) {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      onProgress('Loading compiler components...');
      const [memfsBuf, sysrootTarBuf] = await Promise.all([
        fetch(`${this.basePath}/memfs.wasm`).then(r => r.arrayBuffer()),
        fetch(`${this.basePath}/sysroot.tar`).then(r => r.arrayBuffer()),
      ]);

      this.memfs = await MemFS.create(memfsBuf, this.hostWrite);

      // Ensure root workspace and system directories exist in MemFS
      this.memfs.ensureDirectory('workspace');
      this.memfs.ensureDirectory('workspace/src');
      this.memfs.ensureDirectory('workspace/include');
      this.memfs.ensureDirectory('workspace/build');
      this.memfs.ensureDirectory('usr');
      this.memfs.ensureDirectory('usr/lib');
      this.memfs.ensureDirectory('usr/bin');
      this.memfs.ensureDirectory('bin');

      onProgress('Unpacking standard library headers and runtime...');
      const tar = new Tar(sysrootTarBuf);
      const entries = tar.getEntries();
      for (const entry of entries) {
        if (entry.type === '5') {
          this.memfs.addDirectory(entry.filename);
        } else if (entry.contents) {
          this.memfs.addFile(entry.filename, entry.contents);

          // Mirror standard libraries to /usr/lib in MemFS and VFS
          if (entry.filename.startsWith('lib/wasm32-wasi/')) {
            const libName = entry.filename.substring('lib/wasm32-wasi/'.length);
            if (libName) {
              this.memfs.addFile(`usr/lib/${libName}`, entry.contents);
              if (this.vfs) {
                this.vfs.writeFile(`/usr/lib/${libName}`, entry.contents, Date.now(), true);
              }
            }
          }
        }
      }

      onProgress('Compiler ready.');
      this.initialized = true;
    })();

    await this.initPromise;
  }

  async _getClang() {
    if (!this.clangModule) {
      this.hostWrite('\x1b[33m[Loading Clang compiler module...]\x1b[0m\r\n');
      const buf = await fetch(`${this.basePath}/clang.wasm`).then(r => r.arrayBuffer());
      this.clangModule = await WebAssembly.compile(buf);
    }
    return this.clangModule;
  }

  async _getLld() {
    if (!this.lldModule) {
      this.hostWrite('\x1b[33m[Loading LLD linker module...]\x1b[0m\r\n');
      const buf = await fetch(`${this.basePath}/lld.wasm`).then(r => r.arrayBuffer());
      this.lldModule = await WebAssembly.compile(buf);
    }
    return this.lldModule;
  }

  async syncFileToMemfs(path, content) {
    if (!this.initialized) {
      await this.init();
    }
    const cleanPath = path.replace(/^\/+/, '');
    this.memfs.addFile(cleanPath, content);
  }

  getFileFromMemfs(path) {
    if (!this.memfs) return null;
    const cleanPath = path.replace(/^\/+/, '');
    return this.memfs.getFileContents(cleanPath);
  }

  hasFileInMemfs(path) {
    if (!this.memfs) return false;
    const cleanPath = path.replace(/^\/+/, '');
    return this.memfs.hasFile(cleanPath);
  }

  removeFileFromMemfs(path) {
    if (!this.memfs) return false;
    const cleanPath = path.replace(/^\/+/, '');
    return this.memfs.removeFile(cleanPath);
  }

  async compile(sourcePath, objPath, mode = 'c', customFlags = []) {
    await this.init();
    const clang = await this._getClang();

    const cleanSrc = sourcePath.replace(/^\/+/, '');
    const cleanObj = objPath.replace(/^\/+/, '');

    // Ensure output directory exists in MemFS before compilation
    const lastSlash = cleanObj.lastIndexOf('/');
    if (lastSlash !== -1) {
      this.memfs.ensureDirectory(cleanObj.substring(0, lastSlash));
    }

    const args = [
      '-cc1',
      '-emit-obj',
      '-disable-free',
      '-isysroot', '/',
      '-internal-isystem', '/include',
      '-internal-isystem', '/include/c++/v1',
      '-internal-isystem', '/lib/clang/8.0.1/include',
      '-I/workspace/include',
      '-I/workspace',
      '-ferror-limit', '19',
      '-fmessage-length', '80',
      '-fcolor-diagnostics',
      '-O2',
    ];

    if (mode === 'c') {
      // Pure C mode: Force C11 and strict pedantic errors
      args.push('-x', 'c', '-std=c11', '-pedantic-errors', '-Wall', '-Wextra');
    } else {
      // C++ mode: C++17
      args.push('-x', 'c++', '-std=c++17', '-Wall', '-Wextra');
    }

    args.push(...customFlags);
    args.push('-o', cleanObj, cleanSrc);

    try {
      const app = await AppInstance.create(clang, this.memfs, 'clang', ...args);
      const exitCode = app.run();
      return exitCode;
    } finally {
      this.memfs.hostMem = null;
    }
  }

  async link(objPaths, outputPath, customFlags = []) {
    await this.init();
    const lld = await this._getLld();

    const cleanObjs = objPaths.map(p => p.replace(/^\/+/, ''));
    const cleanOut = outputPath.replace(/^\/+/, '');

    // Ensure output directory exists in MemFS before linking
    const lastSlash = cleanOut.lastIndexOf('/');
    if (lastSlash !== -1) {
      this.memfs.ensureDirectory(cleanOut.substring(0, lastSlash));
    }

    const stackSize = 1024 * 1024;
    const libdir = 'lib/wasm32-wasi';
    const crt1 = `${libdir}/crt1.o`;

    const args = [
      '--no-threads',
      '--allow-undefined',
      '-z', `stack-size=${stackSize}`,
      `-L${libdir}`,
      `-Lusr/lib`,
      crt1,
      ...cleanObjs,
      '-lc',
      '-lc++',
      '-lc++abi',
      ...customFlags,
      '-o', cleanOut,
    ];

    try {
      const app = await AppInstance.create(lld, this.memfs, 'wasm-ld', ...args);
      const exitCode = app.run();
      return exitCode;
    } finally {
      this.memfs.hostMem = null;
    }
  }
}
