// Real GNU Make WASI Integration and Educational Parser Compatibility Shim
// Powered by make-wasi (GNU Make 4.4.1 compiled for WASI Preview 1)

import { WasiHost, ProcExit, normalizePath } from '../vfs/wasi-host.js';
import { createMakeBridge } from 'make-wasi/host';
import { executeGccCommandSync } from './driver.js';
import { getWasmModule, saveWasmModule } from './wasm-cache.js';

let makeModule = null;
let makeModulePromise = null;

/**
 * Loads and compiles the make.wasm module (cached in memory and IndexedDB).
 */
export async function loadMakeBinary(basePath = '/sysroot/wasm', vfs = null) {
  if (makeModule) return makeModule;
  if (makeModulePromise) return makeModulePromise;

  makeModulePromise = (async () => {
    // 1. Try IndexedDB cache if available
    try {
      const cached = await getWasmModule('make-4.4.1');
      if (cached instanceof WebAssembly.Module) {
        makeModule = cached;
        return cached;
      }
    } catch (_) {}

    let arrayBuf = null;

    // 2. Try VFS /usr/bin/make
    if (!arrayBuf && vfs && typeof vfs.exists === 'function' && vfs.exists('/usr/bin/make')) {
      const vfsBytes = vfs.readFile('/usr/bin/make', false);
      if (
        vfsBytes &&
        vfsBytes.length > 8 &&
        vfsBytes[0] === 0x00 &&
        vfsBytes[1] === 0x61 &&
        vfsBytes[2] === 0x73 &&
        vfsBytes[3] === 0x6d
      ) {
        arrayBuf = vfsBytes.buffer.slice(vfsBytes.byteOffset, vfsBytes.byteOffset + vfsBytes.byteLength);
      }
    }

    // 3. Fetch from basePath (with subpath fallback if hosted under subfolder/GitHub Pages)
    if (!arrayBuf) {
      const urlsToTry = [`${basePath}/make.wasm`];
      if (typeof location !== 'undefined' && location.pathname && (basePath === '/sysroot/wasm' || basePath.startsWith('/sysroot/'))) {
        const parts = location.pathname.split('/').filter(Boolean);
        if (parts.length > 1) {
          const rootSubPath = '/' + parts[0];
          urlsToTry.push(`${rootSubPath}/sysroot/wasm/make.wasm`);
          const parentSubPath = '/' + parts.slice(0, -1).join('/');
          urlsToTry.push(`${parentSubPath}/sysroot/wasm/make.wasm`);
        }
      }

      let lastError = null;
      for (const url of urlsToTry) {
        try {
          const res = await fetch(url);
          if (res && (res.ok || typeof res.ok === 'undefined')) {
            arrayBuf = await res.arrayBuffer();
            if (arrayBuf && arrayBuf.byteLength > 0) break;
          } else {
            lastError = new Error(`Failed to load make.wasm from ${url}: ${res.status} ${res.statusText}`);
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (!arrayBuf) {
        throw lastError || new Error(`Failed to load make.wasm from ${urlsToTry[0]}`);
      }
    }

    const mod = await WebAssembly.compile(arrayBuf);
    makeModule = mod;
    try {
      saveWasmModule('make-4.4.1', arrayBuf).catch(() => {});
    } catch (_) {}
    return mod;
  })();

  try {
    return await makeModulePromise;
  } finally {
    makeModulePromise = null;
  }
}

/**
 * Educational Makefile Parser for backward compatibility and static analysis.
 */
export function parseMakefile(content) {
  const lines = (content || '').split('\n');
  const vars = new Map();
  const targets = new Map(); // targetName -> { prereqs: [], recipes: [] }
  let currentTarget = null;

  for (let rawLine of lines) {
    // Variable definition: VAR = VAL
    const varMatch = rawLine.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (varMatch && !rawLine.startsWith('\t')) {
      vars.set(varMatch[1], varMatch[2].trim());
      currentTarget = null;
      continue;
    }

    // Substitute variables $(VAR) across the line
    let expandedLine = rawLine;
    for (const [k, v] of vars.entries()) {
      expandedLine = expandedLine.split(`$(${k})`).join(v);
    }

    // Recipe line (starts with tab)
    if (rawLine.startsWith('\t')) {
      if (currentTarget) {
        let recipe = expandedLine.substring(1).trim();
        currentTarget.recipes.push(recipe);
      }
      continue;
    }

    // Target line: target: prereq1 prereq2 | order_only
    const targetMatch = expandedLine.match(/^([A-Za-z0-9_./%-]+)\s*:\s*(.*)$/);
    if (targetMatch) {
      const name = targetMatch[1].trim();
      let prereqStr = targetMatch[2].trim();

      const prereqs = prereqStr
        .split('|')[0] // discard order-only separator
        .split(/\s+/)
        .map((p) => p.trim())
        .filter(Boolean);

      const targetObj = { prereqs, recipes: [] };
      targets.set(name, targetObj);
      currentTarget = targetObj;
    }
  }

  return { vars, targets };
}

/**
 * Executes GNU Make via WebAssembly (make-wasi) against the in-memory VFS.
 */
export async function runMake({
  args = [],
  targetName = null,
  cwd = '/workspace',
  environ = {},
  vfs,
  toolchain = null,
  basePath = '/sysroot/wasm',
  write = console.log,
  mode = 'c',
  executeCommand = null,
}) {
  const normCwd = normalizePath(cwd || '/workspace');

  const makeArgs = ['make', '--no-print-directory'];
  if (!args.includes('-C') && !args.includes('--directory')) {
    makeArgs.push('-C', normCwd);
  }

  if (Array.isArray(args) && args.length > 0) {
    makeArgs.push(...args);
  } else if (targetName) {
    makeArgs.push(targetName);
  }

  const writeFn = (str) => {
    if (typeof write === 'function') {
      write(str.replace(/\r?\n/g, '\r\n'));
    }
  };

  const effectiveBasePath = (basePath && basePath !== '/sysroot/wasm')
    ? basePath
    : ((toolchain && toolchain.basePath) || basePath || '/sysroot/wasm');
  const mod = await loadMakeBinary(effectiveBasePath, vfs);

  // Initialize toolchain if provided so sync execution is ready
  if (toolchain) {
    if (typeof toolchain.init === 'function') {
      await toolchain.init();
    }
    if (typeof toolchain._getLlvmBox === 'function') {
      await toolchain._getLlvmBox();
    }
  }

  const wasiHost = new WasiHost({
    vfs,
    cwd: normCwd,
    argv: makeArgs,
    environ: { USER: 'student', HOME: '/workspace', PWD: normCwd, ...(environ || {}) },
    stdout: writeFn,
    stderr: writeFn,
  });

  const resolvePath = (p) => {
    if (!p) return normCwd;
    if (p.startsWith('/')) return normalizePath(p);
    return normalizePath(`${normCwd}/${p}`);
  };

  let makeInstance = null;
  const makeBridge = createMakeBridge({
    getMemory: () => (makeInstance ? makeInstance.exports.memory : null),
    cwd: normCwd,
    runRecipe: (cmdLine, { cwd: recipeCwd }) => {
      const trimmed = (cmdLine || '').trim();
      if (!trimmed) return 0;

      const activeCwd = recipeCwd || normCwd;

      // 1. Custom callback if provided
      if (typeof executeCommand === 'function') {
        try {
          const res = executeCommand(trimmed);
          if (typeof res === 'number') return res;
          if (res === true) return 0;
          if (res === false) return 1;
          if (res && typeof res.exitCode === 'number') return res.exitCode;
        } catch (_) {}
      }

      // 2. Built-in rm
      if (trimmed.startsWith('rm ') || trimmed === 'rm') {
        const parts = trimmed.split(/\s+/).slice(1).filter((p) => !p.startsWith('-'));
        for (const t of parts) {
          if (t.includes('*') || t.includes('?')) {
            const hasSlash = t.includes('/');
            const dirPart = hasSlash ? t.substring(0, t.lastIndexOf('/')) : '.';
            const pattern = hasSlash ? t.substring(t.lastIndexOf('/') + 1) : t;
            const targetDir = resolvePath(dirPart);
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
            if (vfs.exists(targetDir)) {
              try {
                const files = vfs.readDir(targetDir);
                for (const f of files) {
                  if (regex.test(f.name)) {
                    try { vfs.remove(normalizePath(`${targetDir}/${f.name}`), true, true); } catch {}
                  }
                }
              } catch {}
            }
          } else {
            const norm = resolvePath(t);
            if (vfs.exists(norm)) {
              try { vfs.remove(norm, true, true); } catch {}
            }
          }
        }
        return 0;
      }

      // 3. Built-in mkdir
      if (trimmed.startsWith('mkdir ') || trimmed === 'mkdir') {
        const parts = trimmed.split(/\s+/).slice(1).filter((p) => !p.startsWith('-'));
        for (const d of parts) {
          const norm = resolvePath(d);
          try {
            vfs.mkdir(norm, true, true);
            const node = vfs._resolve(norm);
            if (node) node.mtime = Date.now();
          } catch {}
        }
        return 0;
      }

      // 4. Built-in touch
      if (trimmed.startsWith('touch ')) {
        const parts = trimmed.split(/\s+/).slice(1).filter((p) => !p.startsWith('-'));
        for (const t of parts) {
          const norm = resolvePath(t);
          if (vfs.exists(norm)) {
            if (typeof vfs.setTimes === 'function') {
              vfs.setTimes(norm, 0, Date.now());
            } else {
              const node = vfs._resolve(norm);
              if (node) {
                node.mtime = Math.max(Date.now(), (node.mtime || 0) + 1);
              }
            }
          } else {
            vfs.writeFile(norm, '', Date.now(), true);
          }
        }
        return 0;
      }

      // 5. Built-in echo
      if (trimmed.startsWith('echo ') || trimmed === 'echo') {
        let echoText = trimmed.substring(4).trim();
        let redirectPath = null;
        let append = false;

        const gtIdx = echoText.indexOf('>');
        if (gtIdx !== -1) {
          if (echoText[gtIdx + 1] === '>') {
            append = true;
            redirectPath = echoText.substring(gtIdx + 2).trim();
            echoText = echoText.substring(0, gtIdx).trim();
          } else {
            redirectPath = echoText.substring(gtIdx + 1).trim();
            echoText = echoText.substring(0, gtIdx).trim();
          }
        }

        // Strip matching outer quotes
        if (
          (echoText.startsWith('"') && echoText.endsWith('"')) ||
          (echoText.startsWith("'") && echoText.endsWith("'"))
        ) {
          echoText = echoText.substring(1, echoText.length - 1);
        }

        if (redirectPath) {
          const norm = resolvePath(redirectPath);
          const fullContent = echoText + '\n';
          if (append && vfs.exists(norm)) {
            const existing = vfs.readFile(norm, true);
            vfs.writeFile(norm, existing + fullContent, Date.now(), true);
          } else {
            vfs.writeFile(norm, fullContent, Date.now(), true);
          }
        } else {
          writeFn(echoText + '\r\n');
        }
        return 0;
      }

      if (trimmed === 'true') return 0;
      if (trimmed === 'false') return 1;

      // 6. Toolchain commands: gcc, clang, g++, clang++, cc, c++
      const isCompiler = (
        trimmed.startsWith('gcc ') ||
        trimmed.startsWith('clang ') ||
        trimmed.startsWith('g++ ') ||
        trimmed.startsWith('clang++ ') ||
        trimmed.startsWith('cc ') ||
        trimmed.startsWith('c++ ') ||
        trimmed === 'gcc' ||
        trimmed === 'clang' ||
        trimmed === 'g++' ||
        trimmed === 'clang++' ||
        trimmed === 'cc' ||
        trimmed === 'c++'
      );

      if (isCompiler) {
        const subArgs = trimmed.split(/\s+/);
        const subCmd = subArgs.shift();
        const subMode = (subCmd === 'g++' || subCmd === 'clang++' || subCmd === 'c++') ? 'cpp' : mode;

        if (toolchain && typeof toolchain.compileSync === 'function') {
          return executeGccCommandSync({
            cmd: subCmd,
            args: subArgs,
            cwd: activeCwd,
            vfs,
            toolchain,
            mode: subMode,
            write: writeFn,
          });
        }
      }

      // 7. Toolchain archiver: ar
      if (trimmed.startsWith('ar ') || trimmed === 'ar') {
        const subArgs = trimmed.split(/\s+/);
        subArgs.shift();
        if (toolchain && typeof toolchain.runToolSync === 'function') {
          return toolchain.runToolSync('ar', subArgs, { cwd: activeCwd });
        }
      }

      // 8. Linker: wasm-ld
      if (trimmed.startsWith('wasm-ld ') || trimmed.startsWith('ld ')) {
        const subArgs = trimmed.split(/\s+/);
        const subCmd = subArgs.shift();
        if (toolchain && typeof toolchain.runToolSync === 'function') {
          return toolchain.runToolSync('wasm-ld', subArgs, { cwd: activeCwd });
        }
      }

      writeFn(`make: command not found: ${trimmed}\r\n`);
      return 127;
    },
    captureCommand: (cmdLine, { cwd: cmdCwd }) => {
      const trimmed = (cmdLine || '').trim();
      if (!trimmed) return '';

      if (trimmed.startsWith('echo ') || trimmed === 'echo') {
        let echoText = trimmed.substring(4).trim();
        if (
          (echoText.startsWith('"') && echoText.endsWith('"')) ||
          (echoText.startsWith("'") && echoText.endsWith("'"))
        ) {
          echoText = echoText.substring(1, echoText.length - 1);
        }
        return echoText;
      }

      return '';
    },
  });

  const importObj = wasiHost.createImportObject(makeBridge);
  makeInstance = new WebAssembly.Instance(mod, importObj);
  wasiHost.setMemory(() => (makeInstance ? makeInstance.exports.memory : null));

  try {
    makeInstance.exports._start();
    return 0;
  } catch (err) {
    if (err instanceof ProcExit) {
      return err.code;
    }
    writeFn(`\r\nmake error: ${err.message || String(err)}\r\n`);
    return 2;
  }
}
