// Unit tests for SQLite 3 WASI Preview 1 integration (headers, static library, CLI execution)
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot, STANDARD_LIBS, USR_BIN_COMMANDS } from '../src/vfs/sysroot.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';
import { WasiHost, ProcExit } from '../src/vfs/wasi-host.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('--- Running SQLite 3 WASI Integration Unit Tests ---');

// Polyfill fetch for Node environment
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, ...args) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    return nativeFetch(url, ...args);
  }
  let clean = String(url).replace(/^\/?sysroot\//, 'public/sysroot/').replace(/^\//, '');
  if (clean.startsWith('sysroot/')) clean = 'public/' + clean;
  const resolved = path.resolve(projectRoot, clean);
  const data = fs.readFileSync(resolved);
  return {
    ok: true,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    text: async () => data.toString('utf-8')
  };
};

async function executeWasiProgram(wasmBytes, argv, vfs) {
  let output = '';
  let memoryInstance = null;
  const wasiHost = new WasiHost({
    vfs,
    cwd: '/workspace',
    argv,
    environ: { USER: 'ide', PWD: '/workspace' },
    getMemory: () => memoryInstance,
    stdout: (str) => { output += str; },
    stderr: (str) => { output += str; },
  });

  const importObject = wasiHost.createImportObject();
  const module = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(module, importObject);
  memoryInstance = instance.exports.memory;

  let exitCode = 0;
  try {
    if (typeof instance.exports._start === 'function') {
      instance.exports._start();
    }
  } catch (err) {
    if (err instanceof ProcExit || (err && typeof err.code === 'number')) {
      exitCode = err.code;
    } else {
      throw err;
    }
  }

  return { exitCode, output };
}

// 1. Verify VFS Mount of SQLite Headers, Library, and CLI
{
  const vfs = new VFS();
  mountSysroot(vfs);

  assert(vfs.exists('/usr/include/sqlite3.h'), '/usr/include/sqlite3.h must exist');
  assert(vfs.exists('/usr/include/sqlite3ext.h'), '/usr/include/sqlite3ext.h must exist');
  assert(vfs.exists('/usr/lib/libsqlite3.a'), '/usr/lib/libsqlite3.a stub must exist');
  assert(vfs.exists('/usr/bin/sqlite3'), '/usr/bin/sqlite3 command stub must exist');

  const hContent = vfs.readFile('/usr/include/sqlite3.h', true);
  assert(hContent.includes('sqlite3_open'), 'sqlite3.h must declare sqlite3_open');
  assert(hContent.includes('sqlite3_exec'), 'sqlite3.h must declare sqlite3_exec');
  assert(hContent.includes('SQLITE_VERSION'), 'sqlite3.h must define SQLITE_VERSION');

  assert(STANDARD_LIBS.includes('libsqlite3.a'), 'STANDARD_LIBS must include libsqlite3.a');
  assert(USR_BIN_COMMANDS.includes('sqlite3'), 'USR_BIN_COMMANDS must include sqlite3');

  console.log('✓ SQLite headers, static library, and CLI mounted in sysroot');
}

// 2. Verify Physical Asset Files & Magic Numbers
{
  const libPath = path.join(projectRoot, 'public', 'sysroot', 'wasm', 'libsqlite3.a');
  const cliPath = path.join(projectRoot, 'public', 'sysroot', 'wasm', 'sqlite3.wasm');
  const hPath = path.join(projectRoot, 'public', 'sysroot', 'include', 'sqlite', 'sqlite3.h');
  const extHPath = path.join(projectRoot, 'public', 'sysroot', 'include', 'sqlite', 'sqlite3ext.h');

  assert(fs.existsSync(libPath), 'libsqlite3.a must exist on disk');
  assert(fs.existsSync(cliPath), 'sqlite3.wasm must exist on disk');
  assert(fs.existsSync(hPath), 'sqlite3.h must exist on disk');
  assert(fs.existsSync(extHPath), 'sqlite3ext.h must exist on disk');

  const libStat = fs.statSync(libPath);
  const cliStat = fs.statSync(cliPath);
  assert(libStat.size > 1000000, `libsqlite3.a size (${libStat.size}) must be > 1MB`);
  assert(cliStat.size > 1000000, `sqlite3.wasm size (${cliStat.size}) must be > 1MB`);

  // Verify WebAssembly magic header in sqlite3.wasm
  const wasmBytes = fs.readFileSync(cliPath);
  assert.strictEqual(wasmBytes[0], 0x00, 'Wasm magic byte 0');
  assert.strictEqual(wasmBytes[1], 0x61, 'Wasm magic byte 1 (a)');
  assert.strictEqual(wasmBytes[2], 0x73, 'Wasm magic byte 2 (s)');
  assert.strictEqual(wasmBytes[3], 0x6d, 'Wasm magic byte 3 (m)');

  console.log('✓ SQLite physical binary and header assets verified on disk');
}

// 3. Verify SQLite CLI Execution with WasiHost
{
  const vfs = new VFS();
  mountSysroot(vfs);

  const cliPath = path.join(projectRoot, 'public', 'sysroot', 'wasm', 'sqlite3.wasm');
  const wasmBytes = fs.readFileSync(cliPath);

  const { exitCode, output } = await executeWasiProgram(
    wasmBytes,
    ['sqlite3', ':memory:', 'SELECT 100 + 23;'],
    vfs
  );

  assert.strictEqual(exitCode, 0, `sqlite3 CLI should exit with code 0, got ${exitCode}`);
  assert(output.includes('123'), `sqlite3 output should contain '123', got: ${output}`);

  console.log('✓ SQLite CLI execution (:memory: SQL evaluation) verified via WasiHost');
}

// 4. Verify C Program Compilation and Linkage with -lsqlite3
{
  console.log('[Compiling C test with -lsqlite3...]');
  const vfs = new VFS();
  mountSysroot(vfs);

  // Load physical libsqlite3.a into VFS
  const libPath = path.join(projectRoot, 'public', 'sysroot', 'wasm', 'libsqlite3.a');
  const libBytes = fs.readFileSync(libPath);
  vfs.writeFile('/usr/lib/libsqlite3.a', libBytes, Date.now(), true);
  vfs.writeFile('/lib/wasm32-wasip1/libsqlite3.a', libBytes, Date.now(), true);

  const cCode = `
#include <stdio.h>
#include <sqlite3.h>

int main(void) {
    sqlite3 *db = NULL;
    int rc = sqlite3_open(":memory:", &db);
    if (rc != SQLITE_OK) {
        printf("FAILED\\n");
        return 1;
    }
    printf("SQLITE_OK=%d,VER=%s\\n", SQLITE_OK, sqlite3_libversion());
    sqlite3_close(db);
    return 0;
}
`;
  vfs.writeFile('/workspace/main.c', cCode, Date.now(), true);

  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  const compCode = await tc.compile('/workspace/main.c', '/workspace/main.o', 'c');
  assert.strictEqual(compCode, 0, `Compilation of main.c failed with code ${compCode}`);

  const linkCode = await tc.link(['workspace/main.o'], 'workspace/a.out', ['-lsqlite3']);
  assert.strictEqual(linkCode, 0, `Linking with -lsqlite3 failed with code ${linkCode}`);

  assert(vfs.exists('/workspace/a.out'), 'a.out must be generated');
  const compiledBytes = vfs.readFile('/workspace/a.out', false);
  assert(compiledBytes.length > 0, 'a.out must not be empty');

  // 5. Execute compiled binary with WasiHost
  const { exitCode: runExitCode, output: runOutput } = await executeWasiProgram(
    compiledBytes,
    ['a.out'],
    vfs
  );

  assert.strictEqual(runExitCode, 0, `Compiled SQLite program exited with code ${runExitCode}`);
  assert(runOutput.includes('SQLITE_OK=0'), `Output must contain SQLITE_OK=0, got: ${runOutput}`);
  assert(runOutput.includes('VER=3.54.1'), `Output must contain VER=3.54.1, got: ${runOutput}`);

  console.log('✓ C program compilation, linking (-lsqlite3), and execution verified');
}

// 6. Verify Full 09_sqlite_database.c Example Compilation, Execution & CLI Inspection
{
  console.log('[Compiling and running 09_sqlite_database.c...]');
  const vfs = new VFS();
  mountSysroot(vfs);

  const libPath = path.join(projectRoot, 'public', 'sysroot', 'wasm', 'libsqlite3.a');
  const libBytes = fs.readFileSync(libPath);
  vfs.writeFile('/usr/lib/libsqlite3.a', libBytes, Date.now(), true);
  vfs.writeFile('/lib/wasm32-wasip1/libsqlite3.a', libBytes, Date.now(), true);

  const examplePath = path.join(projectRoot, 'examples', '09_sqlite_database.c');
  const exampleCode = fs.readFileSync(examplePath, 'utf-8');
  vfs.writeFile('/workspace/09_sqlite_database.c', exampleCode, Date.now(), true);

  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  const compCode = await tc.compile('/workspace/09_sqlite_database.c', '/workspace/demo.o', 'c');
  assert.strictEqual(compCode, 0, `Compilation of 09_sqlite_database.c failed with code ${compCode}`);

  const linkCode = await tc.link(['workspace/demo.o'], 'workspace/demo.out', ['-lsqlite3']);
  assert.strictEqual(linkCode, 0, `Linking of demo.o failed with code ${linkCode}`);

  const demoBinary = vfs.readFile('/workspace/demo.out', false);
  const { exitCode: runCode, output: runOut } = await executeWasiProgram(
    demoBinary,
    ['demo.out'],
    vfs
  );
  assert.strictEqual(runCode, 0, `demo.out exited with code ${runCode}`);
  assert(runOut.includes('Alice Chen'), 'Output must contain Alice Chen');
  assert(runOut.includes('Diana Prince'), 'Output must contain Diana Prince');
  assert(runOut.includes('Total students: 4'), 'Output must contain Total students: 4');
  assert(vfs.exists('/workspace/demo.db'), 'demo.db must be created in /workspace');

  // Verify created database with sqlite3 CLI
  const cliPath = path.join(projectRoot, 'public', 'sysroot', 'wasm', 'sqlite3.wasm');
  const cliWasm = fs.readFileSync(cliPath);
  const { exitCode: cliCode, output: cliOut } = await executeWasiProgram(
    cliWasm,
    ['sqlite3', 'demo.db', 'SELECT count(*), max(score) FROM learners;'],
    vfs
  );
  assert.strictEqual(cliCode, 0, `sqlite3 CLI query failed with code ${cliCode}`);
  assert(cliOut.includes('4') && cliOut.includes('99.0'), `sqlite3 output should contain 4 and 99.0, got: ${cliOut}`);

  console.log('✓ 09_sqlite_database.c execution and CLI query on generated demo.db verified');
}

// 7. Verify isatty(0), isatty(1), and isatty(2) return 1 under WasiHost
{
  console.log('[Verifying TTY detection via isatty() with WasiHost...]');
  const vfs = new VFS();
  mountSysroot(vfs);

  const isattyCode = `
#include <stdio.h>
#include <unistd.h>
#include <errno.h>

int main(void) {
    printf("isatty0=%d,isatty1=%d,isatty2=%d\\n", isatty(0), isatty(1), isatty(2));
    return 0;
}
`;
  vfs.writeFile('/workspace/test_isatty.c', isattyCode, Date.now(), true);

  const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
  await tc.init();

  const compCode = await tc.compile('/workspace/test_isatty.c', '/workspace/test_isatty.o', 'c');
  assert.strictEqual(compCode, 0, 'Compilation of test_isatty.c should succeed');

  const linkCode = await tc.link(['workspace/test_isatty.o'], 'workspace/test_isatty.out', []);
  assert.strictEqual(linkCode, 0, 'Linking of test_isatty.out should succeed');

  const isattyBin = vfs.readFile('/workspace/test_isatty.out', false);
  const { exitCode, output } = await executeWasiProgram(isattyBin, ['test_isatty.out'], vfs);
  assert.strictEqual(exitCode, 0, `test_isatty.out exited with ${exitCode}`);
  assert(output.includes('isatty0=1,isatty1=1,isatty2=1'), `Expected isatty to return 1 for 0,1,2, got: ${output}`);

  console.log('✓ WASI TTY detection (isatty for stdin, stdout, stderr) verified');
}

// 8. Verify SQLite CLI Interactive Shell & Prompt (sqlite3 :memory:)
{
  console.log('[Verifying SQLite CLI interactive shell mode...]');
  const vfs = new VFS();
  mountSysroot(vfs);

  const cliPath = path.join(projectRoot, 'public', 'sysroot', 'wasm', 'sqlite3.wasm');
  const cliWasm = fs.readFileSync(cliPath);

  const linesToFeed = [
    'CREATE TABLE t(val INTEGER);',
    'INSERT INTO t VALUES (42), (99);',
    'SELECT sum(val) FROM t;',
    '.quit'
  ];
  let lineIdx = 0;
  let currentBytes = null;
  let currentPos = 0;

  let interactiveOutput = '';
  let mem;
  const wasiHost = new WasiHost({
    vfs,
    cwd: '/workspace',
    argv: ['sqlite3', ':memory:'],
    environ: { USER: 'student', HOME: '/workspace', PWD: '/workspace' },
    getMemory: () => mem,
    stdout: (s) => { interactiveOutput += s; },
    stderr: (s) => { interactiveOutput += s; },
    stdin: (iovs, iovs_len, nread_out, host) => {
      if (!currentBytes || currentPos >= currentBytes.length) {
        if (lineIdx >= linesToFeed.length) {
          host.memU32()[nread_out >> 2] = 0;
          return 0; // EOF
        }
        const str = linesToFeed[lineIdx++] + '\n';
        currentBytes = new TextEncoder().encode(str);
        currentPos = 0;
      }

      let totalRead = 0;
      for (let i = 0; i < iovs_len; i++) {
        const ptr = host.memU32()[(iovs >> 2) + i * 2];
        const len = host.memU32()[(iovs >> 2) + i * 2 + 1];
        const available = currentBytes.length - currentPos;
        if (available > 0) {
          const toCopy = Math.min(len, available);
          host.memU8().set(currentBytes.subarray(currentPos, currentPos + toCopy), ptr);
          currentPos += toCopy;
          totalRead += toCopy;
          break;
        }
      }
      host.memU32()[nread_out >> 2] = totalRead;
      return 0;
    }
  });

  const imports = wasiHost.createImportObject();
  const module = await WebAssembly.compile(cliWasm);
  const instance = await WebAssembly.instantiate(module, imports);
  mem = instance.exports.memory;

  let exitCode = 0;
  try {
    instance.exports._start();
  } catch (err) {
    if (err instanceof ProcExit || (err && typeof err.code === 'number')) {
      exitCode = err.code;
    } else {
      throw err;
    }
  }

  assert.strictEqual(exitCode, 0, `Interactive sqlite3 should exit with code 0, got ${exitCode}`);
  assert(!interactiveOutput.includes('cannot find home directory'), `Should not contain home directory warning: ${interactiveOutput}`);
  assert(interactiveOutput.includes('SQLite version 3.54.1'), `Should display SQLite banner: ${interactiveOutput}`);
  assert(interactiveOutput.includes('SQLite') && interactiveOutput.includes('->'), `Should display interactive prompt: ${interactiveOutput}`);
  assert(interactiveOutput.includes('141'), `Should compute sum(val) = 141: ${interactiveOutput}`);

  console.log('✓ SQLite CLI interactive shell prompt and execution verified');
}

console.log('All SQLite 3 WASI Integration tests passed successfully!');
