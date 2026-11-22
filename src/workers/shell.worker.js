// Web Worker: POSIX Shell Worker powered by web-ide-core/wasi/shell-worker and busybox-wasi

if (typeof self === 'undefined') {
  globalThis.self = globalThis;
  if (!globalThis.postMessage) {
    globalThis.postMessage = () => {};
  }
}

import { attachShellWorker } from 'web-ide-core/wasi/shell-worker';
import { VFS } from '../vfs/vfs.js';
import { mountSysroot, BIN_COMMANDS, SYSTEM_DIRS } from '../vfs/sysroot.js';
import { getWasmModule, saveWasmModule } from '../toolchain/wasm-cache.js';

export const TOOLCHAIN_COMMANDS = [
  'gcc',
  'g++',
  'clang',
  'clang++',
  'clang-cpp',
  'ld',
  'lld',
  'wasm-ld',
  'ld.lld',
  'make',
  'ar',
  'ranlib',
  'nm',
  'objdump',
  'size',
  'c++filt',
  'cxxfilt',
  'strings',
  'readelf',
  'strip',
  'sqlite3',
];

attachShellWorker({
  cacheKey: 'busybox-1.38.0-build1',
  wasmUrl: (basePath) => `${basePath}/busybox.wasm`,
  wasmCache: { getWasmModule, saveWasmModule },
  systemDirs: SYSTEM_DIRS,
  binCommands: BIN_COMMANDS,
  toolchainCommands: TOOLCHAIN_COMMANDS,
  vfsFactory: () => new VFS(),
  mountSysroot,
  cwd: '/workspace',
  workspaceRoot: '/workspace',
  envDefaults: {
    USER: 'student',
    HOME: '/workspace',
    PWD: '/workspace',
    PATH: '/bin:/usr/bin:/workspace',
  },
  welcomeBanner:
    '\x1b[1;36mWelcome to the In-Browser C/C++ Teaching IDE!\x1b[0m\r\n' +
    'Type \x1b[33mls\x1b[0m, \x1b[33mcat\x1b[0m, \x1b[33mcd\x1b[0m, \x1b[33mgcc\x1b[0m, \x1b[33msh\x1b[0m, \x1b[33mmake\x1b[0m, or use the toolbar buttons.\r\n\r\n',
});
