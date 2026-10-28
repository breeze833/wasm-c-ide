// WebAssembly Clang and LLD Driver
// Encapsulates Clang, LLD, and Sysroot execution directly backed by VFS via WasiHost

import { Tar } from './tar.js';
import { WasiHost, ProcExit, ESUCCESS, normalizePath } from '../vfs/wasi-host.js';

export { ProcExit };


export class AppInstance {
  constructor(wasiHost, name, ...args) {
    this.argv = [name, ...args];
    this.environ = { USER: 'student', PWD: '/workspace' };
    this.wasiHost = wasiHost;
    this.wasiHost.argv = this.argv;
    this.wasiHost.environ = this.environ;
    this.instance = null;
    this.exports = null;
  }

  _buildImports() {
    this.wasiHost.setMemory(() => (this.instance ? this.instance.exports.memory : null));
    const wasi = this.wasiHost.getImports();
    return {
      wasi_snapshot_preview1: wasi,
      wasi_unstable: wasi,
      env: new Proxy({}, {
        get(t, p) {
          if (p in t) return t[p];
          return () => 0;
        }
      }),
    };
  }

  static async create(module, wasiHost, name, ...args) {
    const app = new AppInstance(wasiHost, name, ...args);
    const imports = app._buildImports();
    const res = await WebAssembly.instantiate(module, imports);
    const instance = res instanceof WebAssembly.Instance ? res : (res.instance || res);
    app.instance = instance;
    app.exports = instance.exports;
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
    this.llvmBoxModule = null;
    this.initialized = false;
    this.initPromise = null;
  }

  async init(onProgress = () => {}) {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const fetchSysroot = async () => {
        try {
          const res = await fetch(`${this.basePath}/sysroot.tar.gz`);
          if (res) {
            const buf = await res.arrayBuffer();
            const u8 = new Uint8Array(buf);
            if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
              if (typeof DecompressionStream !== 'undefined') {
                const stream = new Response(u8).body.pipeThrough(new DecompressionStream('gzip'));
                return await new Response(stream).arrayBuffer();
              }
            }
            return buf;
          }
        } catch {}
        return await fetch(`${this.basePath}/sysroot.tar`).then(r => r.arrayBuffer());
      };

      const sysrootTarBuf = await fetchSysroot();

      // Ensure root workspace and system directories exist in VFS
      if (this.vfs) {
        this.vfs.mkdir('/workspace', true, true);
        this.vfs.mkdir('/workspace/src', true, true);
        this.vfs.mkdir('/workspace/include', true, true);
        this.vfs.mkdir('/workspace/build', true, true);
        this.vfs.mkdir('/usr', true, true);
        this.vfs.mkdir('/usr/lib', true, true);
        this.vfs.mkdir('/usr/include', true, true);
        this.vfs.mkdir('/usr/bin', true, true);
        this.vfs.mkdir('/bin', true, true);
        this.vfs.mkdir('/include', true, true);
        this.vfs.mkdir('/lib', true, true);
      }

      onProgress('Unpacking standard library headers and runtime...');
      const tar = new Tar(sysrootTarBuf);
      const entries = tar.getEntries();
      for (const entry of entries) {
        const cleanName = (entry.filename || '').replace(/^\.?\/+/, '');
        if (!cleanName) continue;
        if (entry.type === '5') {
          if (this.vfs) this.vfs.mkdir('/' + cleanName, true, true);
        } else if (entry.contents) {
          if (this.vfs) {
            this.vfs.writeFile('/' + cleanName, entry.contents, Date.now(), true);

            // Mirror standard libraries to /usr/lib and /lib/wasm32-wasi in VFS
            if (cleanName.startsWith('lib/wasm32-wasip1/')) {
              const libName = cleanName.substring('lib/wasm32-wasip1/'.length);
              if (libName) {
                this.vfs.writeFile(`/usr/lib/${libName}`, entry.contents, Date.now(), true);
                this.vfs.writeFile(`/lib/wasm32-wasi/${libName}`, entry.contents, Date.now(), true);
              }
            } else if (cleanName.startsWith('lib/wasm32-wasi/')) {
              const libName = cleanName.substring('lib/wasm32-wasi/'.length);
              if (libName) {
                this.vfs.writeFile(`/usr/lib/${libName}`, entry.contents, Date.now(), true);
                this.vfs.writeFile(`/lib/wasm32-wasip1/${libName}`, entry.contents, Date.now(), true);
              }
            }
          }
        }
      }

      // Resolve and unpack symlinks (entry.type === '2')
      for (const entry of entries) {
        if (entry.type === '2' && entry.linkname && this.vfs) {
          const cleanName = (entry.filename || '').replace(/^\.?\/+/, '');
          if (!cleanName) continue;
          const lastSlash = cleanName.lastIndexOf('/');
          const parentDir = lastSlash !== -1 ? cleanName.substring(0, lastSlash) : '';
          let targetPath = entry.linkname.replace(/^\.?\/+/, '');
          if (parentDir && !entry.linkname.startsWith('/')) {
            targetPath = `${parentDir}/${targetPath}`;
          }
          const cleanTarget = '/' + targetPath.replace(/^\/+/, '');
          if (this.vfs.exists(cleanTarget)) {
            const stat = this.vfs.stat(cleanTarget);
            if (stat && stat.isDir) {
              this.vfs.mkdir('/' + cleanName, true, true);
            } else {
              const contents = this.vfs.readFile(cleanTarget, false);
              if (contents) {
                this.vfs.writeFile('/' + cleanName, contents, Date.now(), true);
              }
            }
          }
        }
      }

      // Preload default libturtle.a into VFS
      try {
        const turtleRes = await fetch(`${this.basePath}/libturtle.a`);
        if (turtleRes && turtleRes.ok) {
          const turtleBuf = await turtleRes.arrayBuffer();
          const turtleU8 = new Uint8Array(turtleBuf);
          if (this.vfs) {
            this.vfs.writeFile('/usr/lib/libturtle.a', turtleU8, Date.now(), true);
            this.vfs.writeFile('/usr/lib/libturtle_canvas-wasi.a', turtleU8, Date.now(), true);
            this.vfs.writeFile('/lib/wasm32-wasip1/libturtle.a', turtleU8, Date.now(), true);
            this.vfs.writeFile('/lib/wasm32-wasip1/libturtle_canvas-wasi.a', turtleU8, Date.now(), true);
            this.vfs.writeFile('/lib/wasm32-wasi/libturtle.a', turtleU8, Date.now(), true);
            this.vfs.writeFile('/lib/wasm32-wasi/libturtle_canvas-wasi.a', turtleU8, Date.now(), true);
          }
        }
      } catch {}

      onProgress('Compiler ready.');
      this.initialized = true;
    })();

    await this.initPromise;
  }

  async _getLlvmBox() {
    if (!this.llvmBoxModule) {
      this.hostWrite('\x1b[33m[Loading LLVM toolchain module (llvm-box.wasm)...]\x1b[0m\r\n');
      const buf = await fetch(`${this.basePath}/llvm-box.wasm`).then(r => r.arrayBuffer());
      this.llvmBoxModule = await WebAssembly.compile(buf);
    }
    return this.llvmBoxModule;
  }

  async _getClang() {
    return this._getLlvmBox();
  }

  async _getLld() {
    return this._getLlvmBox();
  }

  async runTool(toolName, toolArgs = [], options = {}) {
    await this.init();
    const llvmBox = await this._getLlvmBox();
    const cwd = options.cwd || '/workspace';

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd,
      argv: [toolName, ...toolArgs],
      stdout: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
      stderr: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
    });

    try {
      const app = await AppInstance.create(llvmBox, wasiHost, toolName, ...toolArgs);
      return app.run();
    } finally {
      wasiHost.setMemory(null);
    }
  }

  async runClang(cmd, args = [], options = {}) {
    await this.init();
    const clang = await this._getClang();
    const cwd = options.cwd || '/workspace';

    // Map gcc/g++ to official Clang multicall subcommands
    const binary = (cmd === 'g++' || cmd === 'clang++') ? 'clang++' : 'clang';

    const finalArgs = [];
    if (!args.some(a => a.startsWith('--target'))) {
      finalArgs.push('--target=wasm32-wasip1');
    }
    if (!args.some(a => a.startsWith('--sysroot'))) {
      finalArgs.push('--sysroot=/');
    }
    finalArgs.push(...args);

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd,
      argv: [binary, ...finalArgs],
      stdout: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
      stderr: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
    });

    try {
      const app = await AppInstance.create(clang, wasiHost, binary, ...finalArgs);
      return app.run();
    } finally {
      wasiHost.setMemory(null);
    }
  }

  async runLld(cmd = 'wasm-ld', args = [], options = {}) {
    await this.init();
    // Default to wasm-ld for Wasm target environment
    const binary = (cmd === 'wasm-ld' || cmd === 'ld' || cmd === 'lld' || cmd === 'ld.lld') ? 'wasm-ld' : cmd;
    return this.runTool(binary, args, options);
  }

  async syncFile(path, content) {
    if (!this.initialized) {
      await this.init();
    }
    const cleanPath = (path || '').replace(/^\/+/, '');
    if (this.vfs && typeof this.vfs.writeFile === 'function') {
      this.vfs.writeFile('/' + cleanPath, content, Date.now(), true);
    }
  }

  getFile(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    if (this.vfs && typeof this.vfs.exists === 'function') {
      if (this.vfs.exists('/' + cleanPath)) return this.vfs.readFile('/' + cleanPath, false);
      if (this.vfs.exists('/workspace/' + cleanPath)) return this.vfs.readFile('/workspace/' + cleanPath, false);
      if (this.vfs.exists(path)) return this.vfs.readFile(path, false);
    }
    return null;
  }

  hasFile(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    if (this.vfs && typeof this.vfs.exists === 'function') {
      return this.vfs.exists('/' + cleanPath) || this.vfs.exists('/workspace/' + cleanPath) || this.vfs.exists(path);
    }
    return false;
  }

  removeFile(path) {
    const cleanPath = normalizePath(path);
    if (this.vfs && typeof this.vfs.exists === 'function' && this.vfs.exists(cleanPath)) {
      try { this.vfs.remove(cleanPath, false, true); } catch {}
      return true;
    }
    return false;
  }

  async compile(sourcePath, objPath, mode = 'c', customFlags = [], options = {}) {
    await this.init();
    const clang = await this._getClang();

    const cleanSrc = sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;
    const cleanObj = objPath === '-' ? '-' : (objPath.startsWith('/') ? objPath : `/${objPath}`);

    if (cleanObj !== '-' && this.vfs) {
      const lastSlash = cleanObj.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = cleanObj.substring(0, lastSlash);
        if (!this.vfs.exists(dir)) {
          try { this.vfs.mkdir(dir, true, true); } catch {}
        }
      }
    }

    const stage = options.stage || 'compile'; // 'preprocess' (-E), 'assembly' (-S), 'compile' (-emit-obj)
    const stageFlag = stage === 'preprocess' ? '-E' : (stage === 'assembly' ? '-S' : '-emit-obj');

    const args = [
      '-cc1',
      '-triple', 'wasm32-unknown-wasi',
      stageFlag,
      '-disable-free',
      '-isysroot', '/',
      '-internal-isystem', '/include',
      '-internal-isystem', '/include/wasm32-wasip1',
      '-internal-isystem', '/usr/include',
      '-internal-isystem', '/lib/clang/19/include',
      '-internal-isystem', '/lib/clang/19.1.0/include',
      '-internal-isystem', '/lib/clang/8.0.1/include',
      '-I', '/workspace/include',
      '-I', '/workspace',
      '-ferror-limit', '19',
      '-fmessage-length=80',
      '-fcolor-diagnostics',
    ];

    // Filter and map PIC flags
    const processedFlags = [];
    let isPic = false;
    for (const flag of customFlags) {
      if (flag === '-fPIC' || flag === '-fpic' || flag === '-fPIE' || flag === '-fpie') {
        isPic = true;
      } else if (flag.startsWith('-I') && flag.length > 2) {
        processedFlags.push('-I', flag.substring(2));
      } else {
        processedFlags.push(flag);
      }
    }
    if (isPic) {
      args.push('-mrelocation-model', 'pic', '-pic-level', '2');
    }

    const hasOptFlag = processedFlags.some(f => /^-O[0-3sz]?$/.test(f));
    if (!hasOptFlag) {
      args.push('-O2');
    }

    if (mode === 'c') {
      args.push('-x', 'c', '-std=c11', '-pedantic-errors', '-Wall', '-Wextra');
    } else {
      args.push('-x', 'c++', '-std=c++17', '-Wall', '-Wextra');
    }

    args.push(...processedFlags);
    args.push('-o', cleanObj, cleanSrc);

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd: '/workspace',
      stdout: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
      stderr: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
    });

    try {
      const app = await AppInstance.create(clang, wasiHost, 'clang', ...args);
      const exitCode = app.run();
      return exitCode;
    } finally {
      wasiHost.setMemory(null);
    }
  }

  async link(objPaths, outputPath, customFlags = []) {
    await this.init();
    const lld = await this._getLld();

    const cleanObjs = objPaths.map(p => (p.startsWith('/') ? p : `/${p}`));
    const cleanOut = outputPath.startsWith('/') ? outputPath : `/${outputPath}`;

    if (this.vfs) {
      const lastSlash = cleanOut.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = cleanOut.substring(0, lastSlash);
        if (!this.vfs.exists(dir)) {
          try { this.vfs.mkdir(dir, true, true); } catch {}
        }
      }
    }

    const isShared = customFlags.includes('-shared') || customFlags.includes('--shared') || cleanOut.endsWith('.so');

    const stackSize = 1024 * 1024;
    const libdir = (this.vfs && this.vfs.exists('/lib/wasm32-wasip1/crt1.o'))
      ? '/lib/wasm32-wasip1'
      : '/lib/wasm32-wasi';
    const crt1 = `${libdir}/crt1.o`;

    const args = [
      '-flavor', 'wasm',
      '--allow-undefined',
    ];

    if (isShared) {
      args.push(
        '--shared',
        `-L${libdir}`,
        `-L/lib/wasm32-wasip1`,
        `-L/lib/wasm32-wasi`,
        `-L/lib/clang/19/lib/wasm32-unknown-wasip1`,
        `-L/lib/clang/19/lib/wasm32-unknown-wasi`,
        `-L/usr/lib`,
        ...cleanObjs,
        '-lc',
        '-lclang_rt.builtins',
        ...customFlags.filter(f => f !== '-shared' && f !== '--shared'),
        '-o', cleanOut,
      );
    } else {
      args.push(
        '-z', `stack-size=${stackSize}`,
        `-L${libdir}`,
        `-L/lib/wasm32-wasip1`,
        `-L/lib/wasm32-wasi`,
        `-L/lib/clang/19/lib/wasm32-unknown-wasip1`,
        `-L/lib/clang/19/lib/wasm32-unknown-wasi`,
        `-L/usr/lib`,
        crt1,
        ...cleanObjs,
        '-lc',
        '-lclang_rt.builtins',
        '-lc++',
        '-lc++abi',
        ...customFlags,
        '-o', cleanOut,
      );
    }

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd: '/workspace',
      stdout: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
      stderr: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
    });

    try {
      const app = await AppInstance.create(lld, wasiHost, 'wasm-ld', ...args);
      const exitCode = app.run();
      return exitCode;
    } finally {
      wasiHost.setMemory(null);
    }
  }
}
