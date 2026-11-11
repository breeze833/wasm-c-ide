// WebAssembly Clang and LLD Driver
// Encapsulates Clang, LLD, and Sysroot execution directly backed by VFS via WasiHost

import { createSharedSysrootFromTar } from '../vfs/shared-sysroot.js';
import { WasiHost, ProcExit, normalizePath } from '../vfs/wasi-host.js';
import { WASM_HOST_IMPORTS } from '../vfs/sysroot.js';
import { getWasmModule, saveWasmModule } from './wasm-cache.js';

export { ProcExit };


export class AppInstance {
  constructor(wasiHost, name, ...args) {
    this.argv = [name, ...args];
    this.environ = wasiHost.environ || { USER: 'student', HOME: '/workspace', PWD: '/workspace' };
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

  static createSync(module, wasiHost, name, ...args) {
    const app = new AppInstance(wasiHost, name, ...args);
    const imports = app._buildImports();
    const instance = new WebAssembly.Instance(module, imports);
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
    this.llvmBoxPromise = null;
    this.initialized = false;
    this.initPromise = null;
  }

  async init(onProgress = () => {}) {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Ensure root workspace and system directories exist in VFS
      if (this.vfs) {
        this.vfs.mkdir('/workspace', true, true);
        this.vfs.mkdir('/workspace/src', true, true);
        this.vfs.mkdir('/workspace/include', true, true);
        this.vfs.mkdir('/workspace/build', true, true);
        this.vfs.mkdir('/dev', true, true);
      }

      if (this.vfs && this.vfs.sharedSysroot) {
        onProgress('Sysroot shared buffer attached.');
        this.initialized = true;
        return;
      }

      onProgress('Fetching standard library sysroot archive (sysroot.tar.gz)...');
      const fetchSysroot = async () => {
        try {
          const res = await fetch(`${this.basePath}/sysroot.tar.gz`);
          if (res) {
            const buf = await res.arrayBuffer();
            const u8 = new Uint8Array(buf);
            if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
              if (typeof DecompressionStream !== 'undefined') {
                onProgress('Decompressing sysroot archive (gzip, ~108MB)...');
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

      // Preload default runtime libraries into SharedSysroot concurrently
      onProgress('Preloading runtime libraries (libraylib, libturtle, libsqlite3)...');
      const preloadConfigs = [
        {
          file: 'libturtle.a',
          targets: [
            '/usr/lib/libturtle.a',
            '/usr/lib/libturtle_canvas-wasi.a',
            '/lib/wasm32-wasip1/libturtle.a',
            '/lib/wasm32-wasip1/libturtle_canvas-wasi.a',
            '/lib/wasm32-wasi/libturtle.a',
            '/lib/wasm32-wasi/libturtle_canvas-wasi.a',
          ],
        },
        {
          file: 'libraylib.a',
          targets: [
            '/usr/lib/libraylib.a',
            '/lib/wasm32-wasip1/libraylib.a',
            '/lib/wasm32-wasi/libraylib.a',
          ],
        },
        {
          file: 'libturtle_raylib.a',
          targets: [
            '/usr/lib/libturtle_raylib.a',
            '/lib/wasm32-wasip1/libturtle_raylib.a',
            '/lib/wasm32-wasi/libturtle_raylib.a',
          ],
        },
        {
          file: 'libsqlite3.a',
          targets: [
            '/usr/lib/libsqlite3.a',
            '/lib/wasm32-wasip1/libsqlite3.a',
            '/lib/wasm32-wasi/libsqlite3.a',
          ],
        },
      ];

      const additionalEntries = [];
      await Promise.all(
        preloadConfigs.map(async (cfg) => {
          try {
            const res = await fetch(`${this.basePath}/${cfg.file}`);
            if (res && (res.ok || typeof res.ok === 'undefined')) {
              const buf = await res.arrayBuffer();
              const u8 = new Uint8Array(buf);
              for (const target of cfg.targets) {
                additionalEntries.push({ path: target, content: u8, isDir: false });
              }
            }
          } catch {}
        })
      );

      onProgress('Unpacking sysroot headers and runtime into SharedSysroot...');
      const sharedSysrootBuffer = createSharedSysrootFromTar(sysrootTarBuf, { additionalEntries });
      if (this.vfs && typeof this.vfs.setSharedSysroot === 'function') {
        this.vfs.setSharedSysroot(sharedSysrootBuffer);
      }

      onProgress('VFS items populated.');
      this.initialized = true;
    })();

    await this.initPromise;
  }

  async _getLlvmBox(options = {}) {
    if (this.llvmBoxModule) return this.llvmBoxModule;
    if (this.llvmBoxPromise) return this.llvmBoxPromise;

    const silent = Boolean(options.silent);
    const CACHE_KEY = 'llvm-box-19.1.0';

    this.llvmBoxPromise = (async () => {
      // 1. Check IndexedDB persistent cache
      try {
        const cached = await getWasmModule(CACHE_KEY);
        if (cached) {
          this.llvmBoxModule = cached;
          return cached;
        }
      } catch {}

      // 2. Fetch from network & compile
      if (!silent && typeof this.hostWrite === 'function') {
        this.hostWrite('\x1b[33m[Loading LLVM toolchain module (llvm-box.wasm)...]\x1b[0m\r\n');
      }

      const wasmUrl = `${this.basePath}/llvm-box.wasm`;
      let compiled = null;
      let rawBuf = null;

      // Try streaming compilation while retrieving buffer for IndexedDB persistence
      if (typeof WebAssembly.compileStreaming === 'function') {
        try {
          const res = await fetch(wasmUrl);
          if (res && res.ok && typeof res.clone === 'function') {
            const clone = res.clone();
            const [mod, buf] = await Promise.all([
              WebAssembly.compileStreaming(res),
              clone.arrayBuffer(),
            ]);
            compiled = mod;
            rawBuf = buf;
          }
        } catch {
          // If streaming compilation fails (e.g. mock fetch in tests or incorrect Content-Type), fall back
        }
      }

      // Fallback to arrayBuffer compilation
      if (!compiled) {
        const res = await fetch(wasmUrl);
        rawBuf = await res.arrayBuffer();
        compiled = await WebAssembly.compile(rawBuf);
      }

      this.llvmBoxModule = compiled;

      // 3. Asynchronously persist ArrayBuffer to IndexedDB (universally supported across all browsers)
      if (rawBuf) {
        saveWasmModule(CACHE_KEY, rawBuf).catch(() => {});
      }

      return compiled;
    })();

    try {
      return await this.llvmBoxPromise;
    } finally {
      this.llvmBoxPromise = null;
    }
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
    const environ = { USER: 'student', HOME: '/workspace', PWD: cwd, ...(options.environ || {}) };

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd,
      argv: [toolName, ...toolArgs],
      environ,
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

  runToolSync(toolName, toolArgs = [], options = {}) {
    const llvmBox = this.llvmBoxModule;
    if (!llvmBox) {
      throw new Error('llvmBox module not initialized');
    }
    const cwd = options.cwd || '/workspace';
    const environ = { USER: 'student', HOME: '/workspace', PWD: cwd, ...(options.environ || {}) };

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd,
      argv: [toolName, ...toolArgs],
      environ,
      stdout: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
      stderr: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
    });

    try {
      const app = AppInstance.createSync(llvmBox, wasiHost, toolName, ...toolArgs);
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

  runClangSync(cmd, args = [], options = {}) {
    const clang = this.llvmBoxModule;
    if (!clang) {
      throw new Error('llvmBox module not initialized');
    }
    const cwd = options.cwd || '/workspace';
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
      const app = AppInstance.createSync(clang, wasiHost, binary, ...finalArgs);
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

  _buildCompileArgs(sourcePath, objPath, mode = 'c', customFlags = [], options = {}) {
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
    ];

    if (mode === 'cpp') {
      args.push(
        '-internal-isystem', '/include/wasm32-wasip1/c++/v1',
        '-internal-isystem', '/include/c++/v1',
      );
    }

    args.push(
      '-internal-isystem', '/lib/clang/19/include',
      '-internal-isystem', '/lib/clang/19.1.0/include',
      '-internal-isystem', '/include/wasm32-wasip1',
      '-internal-isystem', '/include',
      '-internal-isystem', '/usr/include',
      '-I', '/workspace/include',
      '-I', '/workspace',
      '-ferror-limit', '19',
      '-fmessage-length=80',
      '-fcolor-diagnostics',
    );

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
    return args;
  }

  async compile(sourcePath, objPath, mode = 'c', customFlags = [], options = {}) {
    await this.init();
    const clang = await this._getClang();
    const args = this._buildCompileArgs(sourcePath, objPath, mode, customFlags, options);
    const cwd = options.cwd || '/workspace';
    const environ = { USER: 'student', HOME: '/workspace', PWD: cwd, ...(options.environ || {}) };

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd,
      environ,
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

  compileSync(sourcePath, objPath, mode = 'c', customFlags = [], options = {}) {
    const clang = this.llvmBoxModule;
    if (!clang) {
      throw new Error('llvmBox module not initialized');
    }
    const args = this._buildCompileArgs(sourcePath, objPath, mode, customFlags, options);
    const cwd = options.cwd || '/workspace';
    const environ = { USER: 'student', HOME: '/workspace', PWD: cwd, ...(options.environ || {}) };

    const wasiHost = new WasiHost({
      vfs: this.vfs,
      cwd,
      environ,
      stdout: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
      stderr: (str) => {
        if (typeof this.hostWrite === 'function') this.hostWrite(str);
      },
    });

    try {
      const app = AppInstance.createSync(clang, wasiHost, 'clang', ...args);
      const exitCode = app.run();
      return exitCode;
    } finally {
      wasiHost.setMemory(null);
    }
  }

  _buildLinkArgs(objPaths, outputPath, customFlags = []) {
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

    // Ensure host imports whitelist file exists in VFS for wasm-ld --allow-undefined-file
    const hostImportsPath = '/usr/lib/wasm-host-imports.txt';
    if (this.vfs) {
      const hasFile = typeof this.vfs.exists === 'function'
        ? this.vfs.exists(hostImportsPath)
        : (typeof this.vfs.has === 'function' ? this.vfs.has(hostImportsPath) : false);
      if (!hasFile) {
        const textData = WASM_HOST_IMPORTS.join('\n') + '\n';
        try {
          if (typeof this.vfs.writeFile === 'function') {
            this.vfs.writeFile(hostImportsPath, textData, Date.now(), true);
          } else if (typeof this.vfs.set === 'function') {
            this.vfs.set(hostImportsPath, new TextEncoder().encode(textData));
          }
        } catch {}
      }
    }

    const explicitAllowUndefined = customFlags.includes('--allow-undefined') || customFlags.includes('-Wl,--allow-undefined');

    const args = [
      '-flavor', 'wasm',
    ];

    if (isShared) {
      args.push(
        '--shared',
        '--allow-undefined',
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
      if (explicitAllowUndefined) {
        args.push('--allow-undefined');
      } else {
        args.push(`--allow-undefined-file=${hostImportsPath}`);
      }
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
        ...customFlags.filter(f => f !== '--allow-undefined' && f !== '-Wl,--allow-undefined'),
        '-o', cleanOut,
      );
    }
    return args;
  }

  async link(objPaths, outputPath, customFlags = []) {
    await this.init();
    const lld = await this._getLld();
    const args = this._buildLinkArgs(objPaths, outputPath, customFlags);

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

  linkSync(objPaths, outputPath, customFlags = []) {
    const lld = this.llvmBoxModule;
    if (!lld) {
      throw new Error('llvmBox module not initialized');
    }
    const args = this._buildLinkArgs(objPaths, outputPath, customFlags);

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
      const app = AppInstance.createSync(lld, wasiHost, 'wasm-ld', ...args);
      const exitCode = app.run();
      return exitCode;
    } finally {
      wasiHost.setMemory(null);
    }
  }
}
