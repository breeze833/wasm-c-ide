// WebAssembly Clang and LLD Driver
// Integrates clang-wasi toolchain with browser IndexedDB persistent cache and SharedSysroot

import { WasmToolchain as BaseWasmToolchain, AppInstance, ProcExit, normalizePath } from 'clang-wasi/toolchain';
import { createSharedSysrootFromTar } from '../vfs/shared-sysroot.js';
import { getWasmModule, saveWasmModule } from './wasm-cache.js';

export { AppInstance, ProcExit, normalizePath };

export class WasmToolchain extends BaseWasmToolchain {
  constructor(options = {}) {
    super(options);
  }

  async init(onProgress = () => {}) {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Ensure root workspace and system directories exist in VFS
      if (this.vfs) {
        if (typeof this.vfs.mkdir === 'function') {
          try { this.vfs.mkdir('/workspace', true, true); } catch {}
          try { this.vfs.mkdir('/workspace/src', true, true); } catch {}
          try { this.vfs.mkdir('/workspace/include', true, true); } catch {}
          try { this.vfs.mkdir('/workspace/build', true, true); } catch {}
          try { this.vfs.mkdir('/dev', true, true); } catch {}
        }
      }

      if (this.vfs && this.vfs.sharedSysroot) {
        onProgress('Sysroot shared buffer attached.');
        if (!this.llvmBoxModule) {
          this.llvmBoxModule = await this._getLlvmBox({ silent: true });
        }
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
              if (typeof process !== 'undefined' && process.versions && process.versions.node) {
                const zlib = await import('node:zlib');
                const decomp = zlib.gunzipSync(u8);
                return decomp.buffer.slice(decomp.byteOffset, decomp.byteOffset + decomp.byteLength);
              }
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
      if (!this.llvmBoxModule) {
        this.llvmBoxModule = await this._getLlvmBox({ silent: true });
      }
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

      // In Node.js environment, fallback to direct filesystem read if fetch fails
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const localPaths = [
            path.resolve('public/sysroot/wasm/llvm-box.wasm'),
            path.resolve('dist/llvm-box.wasm'),
            path.resolve(this.basePath.replace(/^\/+/, ''), 'llvm-box.wasm'),
          ];
          for (const p of localPaths) {
            if (fs.existsSync(p)) {
              const buf = fs.readFileSync(p);
              const mod = await WebAssembly.compile(buf);
              this.llvmBoxModule = mod;
              return mod;
            }
          }
        } catch (_) {}
      }

      const wasmUrl = `${this.basePath}/llvm-box.wasm`;
      let compiled = null;
      let rawBuf = null;

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
        } catch {}
      }

      if (!compiled) {
        const res = await fetch(wasmUrl);
        rawBuf = await res.arrayBuffer();
        compiled = await WebAssembly.compile(rawBuf);
      }

      this.llvmBoxModule = compiled;

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

  _buildCompileArgs(sourcePath, objPath, mode = 'c', customFlags = [], options = {}) {
    const resolve = (p) => {
      if (!p || p === '-') return p;
      if (p.startsWith('/')) return p;
      if (p.startsWith('workspace/')) return `/${p}`;
      const cwd = options.cwd || '/workspace';
      return `${cwd}/${p}`.replace(/\/+/g, '/');
    };
    return super._buildCompileArgs(resolve(sourcePath), resolve(objPath), mode, customFlags, options);
  }

  _buildLinkArgs(objPaths, outputPath, customFlags = []) {
    const resolve = (p) => {
      if (!p || p === '-') return p;
      if (p.startsWith('/')) return p;
      if (p.startsWith('workspace/')) return `/${p}`;
      return `/workspace/${p}`.replace(/\/+/g, '/');
    };
    return super._buildLinkArgs(objPaths.map(resolve), resolve(outputPath), customFlags);
  }

  async syncFile(path, content) {
    if (!this.initialized) {
      await this.init();
    }
    const cleanPath = (path || '').replace(/^\/+/, '');
    if (this.vfs && typeof this.vfs.writeFile === 'function') {
      this.vfs.writeFile('/' + cleanPath, content, Date.now(), true);
    } else {
      super.syncFile(path, content);
    }
  }

  getFile(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    if (this.vfs && typeof this.vfs.exists === 'function') {
      if (this.vfs.exists('/' + cleanPath)) return this.vfs.readFile('/' + cleanPath, false);
      if (this.vfs.exists('/workspace/' + cleanPath)) return this.vfs.readFile('/workspace/' + cleanPath, false);
      if (this.vfs.exists(path)) return this.vfs.readFile(path, false);
    }
    return super.getFile(path);
  }

  removeFile(path) {
    const cleanPath = normalizePath(path);
    if (this.vfs && typeof this.vfs.exists === 'function' && this.vfs.exists(cleanPath)) {
      try { this.vfs.remove(cleanPath, false, true); } catch {}
      return true;
    }
    return false;
  }
}
