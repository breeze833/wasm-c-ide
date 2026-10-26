// Unit and Integration tests for In-Code File I/O (fopen, fread, fwrite, fseek, ftell, fclose, remove, rename, C++ fstream)
import assert from 'node:assert';
import fs from 'node:fs';
import { executeGccCommand } from '../src/toolchain/driver.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysroot } from '../src/vfs/sysroot.js';
import { runWasm } from '../src/workers/runtime.worker.js';

console.log('--- Running In-Code File I/O (fopen) Unit & Integration Tests ---');

// Mock fetch for Node test environment
globalThis.fetch = async (url) => {
  const filePath = url.replace(/^\/?sysroot\//, 'public/sysroot/');
  const data = fs.readFileSync(filePath);
  return {
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
};

// Mock self.postMessage for worker messaging in Node
let capturedStdout = '';
const postedMessages = [];
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}
globalThis.self.postMessage = (msg) => {
  postedMessages.push(msg);
  if (msg && msg.type === 'stdout') {
    capturedStdout += msg.data;
  }
};

const vfs = new VFS();
mountSysroot(vfs);
const tc = new WasmToolchain({ basePath: '/sysroot/wasm', vfs });
await tc.init();

// Helper to compile C/C++ code to a.out in VFS
async function compileCode(sourceName, sourceCode, isCpp = false) {
  const code = sourceCode.endsWith('\n') ? sourceCode : (sourceCode + '\n');
  vfs.writeFile(`/workspace/${sourceName}`, code);
  let compileLog = '';
  const exitCode = await executeGccCommand({
    cmd: isCpp ? 'g++' : 'gcc',
    args: [sourceName, '-o', 'a.out'],
    cwd: '/workspace',
    vfs,
    toolchain: tc,
    mode: isCpp ? 'cpp' : 'c',
    write: (s) => { compileLog += s; }
  });
  assert.strictEqual(exitCode, 0, `Compilation of ${sourceName} failed: ${compileLog}`);
  return vfs.readFile('/workspace/a.out', false);
}

// Helper to run compiled binary with file map
async function runBinaryWithFiles(wasmBytes, initialFiles = {}) {
  capturedStdout = '';
  postedMessages.length = 0;
  try {
    const res = await runWasm(wasmBytes, ['./a.out'], { USER: 'student', PWD: '/workspace' }, null, null, initialFiles);
    return {
      exitCode: 0,
      changedFiles: res.changedFiles,
      deletedFiles: res.deletedFiles,
      stdout: capturedStdout
    };
  } catch (err) {
    if (err.message && err.message.startsWith('Exited with code')) {
      return {
        exitCode: err.code,
        changedFiles: err.changedFiles,
        deletedFiles: err.deletedFiles,
        stdout: capturedStdout
      };
    }
    throw err;
  }
}

// Test 1: Text file creation and write ("w")
{
  const src = [
    '#include <stdio.h>',
    'int main(void) {',
    '    FILE *f = fopen("output.txt", "w");',
    '    if (!f) return 1;',
    '    fputs("Hello, WebAssembly File I/O!\\n", f);',
    '    fputs("Line 2: 12345\\n", f);',
    '    fclose(f);',
    '    return 0;',
    '}'
  ].join('\n');

  const wasmBytes = await compileCode('test_write.c', src);
  const result = await runBinaryWithFiles(wasmBytes, {});

  assert.strictEqual(result.exitCode, 0, `Process exited with code ${result.exitCode}`);
  assert.ok(result.changedFiles.has('/workspace/output.txt'), 'output.txt must be in changedFiles');

  const content = new TextDecoder().decode(result.changedFiles.get('/workspace/output.txt'));
  assert.strictEqual(content, "Hello, WebAssembly File I/O!\nLine 2: 12345\n");
  console.log('✓ fopen("output.txt", "w") and fputs verified');
}

// Test 2: Text file reading ("r") and EOF detection
{
  const src = [
    '#include <stdio.h>',
    '#include <string.h>',
    'int main(void) {',
    '    FILE *f = fopen("input.txt", "r");',
    '    if (!f) return 1;',
    '    char buf[128];',
    '    int lines = 0;',
    '    while (fgets(buf, sizeof(buf), f)) {',
    '        lines++;',
    '        printf("L%d: %s", lines, buf);',
    '    }',
    '    fclose(f);',
    '    return lines == 2 ? 0 : 2;',
    '}'
  ].join('\n');

  const wasmBytes = await compileCode('test_read.c', src);
  const initialFiles = {
    '/workspace/input.txt': new TextEncoder().encode("First line\nSecond line\n")
  };
  const result = await runBinaryWithFiles(wasmBytes, initialFiles);

  assert.strictEqual(result.exitCode, 0, `Process exited with code ${result.exitCode}, stdout: ${result.stdout}`);
  assert.ok(result.stdout.includes('L1: First line\n'));
  assert.ok(result.stdout.includes('L2: Second line\n'));
  console.log('✓ fopen("input.txt", "r") and fgets with EOF verified');
}

// Test 3: Text file append mode ("a")
{
  const src = [
    '#include <stdio.h>',
    'int main(void) {',
    '    FILE *f = fopen("log.txt", "a");',
    '    if (!f) return 1;',
    '    fputs("Appended line\\n", f);',
    '    fclose(f);',
    '    return 0;',
    '}'
  ].join('\n');

  const wasmBytes = await compileCode('test_append.c', src);
  const initialFiles = {
    '/workspace/log.txt': new TextEncoder().encode("Initial line\n")
  };
  const result = await runBinaryWithFiles(wasmBytes, initialFiles);

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.changedFiles.has('/workspace/log.txt'));

  const content = new TextDecoder().decode(result.changedFiles.get('/workspace/log.txt'));
  assert.strictEqual(content, "Initial line\nAppended line\n");
  console.log('✓ fopen("log.txt", "a") append mode verified');
}

// Test 4: Binary read and write ("wb" and "rb")
{
  const writeSrc = [
    '#include <stdio.h>',
    '#include <stdint.h>',
    'int main(void) {',
    '    FILE *f = fopen("data.bin", "wb");',
    '    if (!f) return 1;',
    '    uint8_t bytes[8] = { 0x00, 0xFF, 0x42, 0x7E, 0x00, 0x1A, 0xCC, 0xDD };',
    '    size_t written = fwrite(bytes, 1, sizeof(bytes), f);',
    '    fclose(f);',
    '    return written == 8 ? 0 : 2;',
    '}'
  ].join('\n');

  const readSrc = [
    '#include <stdio.h>',
    '#include <stdint.h>',
    'int main(void) {',
    '    FILE *f = fopen("data.bin", "rb");',
    '    if (!f) return 1;',
    '    uint8_t buf[8];',
    '    size_t n = fread(buf, 1, 8, f);',
    '    fclose(f);',
    '    if (n != 8) return 2;',
    '    if (buf[0] == 0x00 && buf[1] == 0xFF && buf[2] == 0x42 && buf[3] == 0x7E &&',
    '        buf[4] == 0x00 && buf[5] == 0x1A && buf[6] == 0xCC && buf[7] == 0xDD) {',
    '        return 0;',
    '    }',
    '    return 3;',
    '}'
  ].join('\n');

  const writeWasm = await compileCode('test_bin_write.c', writeSrc);
  const writeRes = await runBinaryWithFiles(writeWasm, {});
  assert.strictEqual(writeRes.exitCode, 0);
  assert.ok(writeRes.changedFiles.has('/workspace/data.bin'));

  const binData = writeRes.changedFiles.get('/workspace/data.bin');
  assert.deepStrictEqual(Array.from(binData), [0x00, 0xFF, 0x42, 0x7E, 0x00, 0x1A, 0xCC, 0xDD]);

  const readWasm = await compileCode('test_bin_read.c', readSrc);
  const readRes = await runBinaryWithFiles(readWasm, { '/workspace/data.bin': binData });
  assert.strictEqual(readRes.exitCode, 0, `Binary read validation failed with exitCode ${readRes.exitCode}`);
  console.log('✓ Binary modes fopen("data.bin", "wb") and ("rb") with fwrite/fread verified');
}

// Test 5: In-place update mode ("r+") and seeking (fseek / ftell / rewind)
{
  const src = [
    '#include <stdio.h>',
    'int main(void) {',
    '    FILE *f = fopen("update.txt", "r+");',
    '    if (!f) return 1;',
    '    if (fseek(f, 2, SEEK_SET) != 0) return 2;',
    '    if (ftell(f) != 2) return 3;',
    '    fputs("99", f);',
    '    if (ftell(f) != 4) return 4;',
    '    if (fseek(f, 0, SEEK_END) != 0) return 5;',
    '    if (ftell(f) != 6) return 6;',
    '    fputs("Z", f);',
    '    fclose(f);',
    '    return 0;',
    '}'
  ].join('\n');

  const wasmBytes = await compileCode('test_seek.c', src);
  const initialFiles = {
    '/workspace/update.txt': new TextEncoder().encode("ABCDEF")
  };
  const result = await runBinaryWithFiles(wasmBytes, initialFiles);

  assert.strictEqual(result.exitCode, 0, `Process exited with code ${result.exitCode}`);
  const content = new TextDecoder().decode(result.changedFiles.get('/workspace/update.txt'));
  assert.strictEqual(content, "AB99EFZ");
  console.log('✓ Read-write mode ("r+") with fseek (SEEK_SET, SEEK_END) and ftell verified');
}

// Test 6: File removal (remove) and renaming (rename)
{
  const src = [
    '#include <stdio.h>',
    'int main(void) {',
    '    if (remove("delete_me.txt") != 0) return 1;',
    '    if (rename("old_name.txt", "new_name.txt") != 0) return 2;',
    '    return 0;',
    '}'
  ].join('\n');

  const wasmBytes = await compileCode('test_file_ops.c', src);
  const initialFiles = {
    '/workspace/delete_me.txt': new TextEncoder().encode("goodbye"),
    '/workspace/old_name.txt': new TextEncoder().encode("renamed content")
  };
  const result = await runBinaryWithFiles(wasmBytes, initialFiles);

  assert.strictEqual(result.exitCode, 0, `Process exited with code ${result.exitCode}`);
  assert.ok(result.deletedFiles.has('/workspace/delete_me.txt'), 'delete_me.txt must be in deletedFiles');
  assert.ok(result.deletedFiles.has('/workspace/old_name.txt'), 'old_name.txt must be in deletedFiles');
  assert.ok(result.changedFiles.has('/workspace/new_name.txt'), 'new_name.txt must be in changedFiles');
  assert.strictEqual(new TextDecoder().decode(result.changedFiles.get('/workspace/new_name.txt')), "renamed content");
  console.log('✓ remove() and rename() verified');
}

// Test 7: Subdirectory path access ("sub/nested.txt")
{
  const src = [
    '#include <stdio.h>',
    'int main(void) {',
    '    FILE *f = fopen("sub/nested.txt", "w");',
    '    if (!f) return 1;',
    '    fputs("Nested directory file\\n", f);',
    '    fclose(f);',
    '    return 0;',
    '}'
  ].join('\n');

  const wasmBytes = await compileCode('test_subdir.c', src);
  const result = await runBinaryWithFiles(wasmBytes, {});

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.changedFiles.has('/workspace/sub/nested.txt'), 'sub/nested.txt must exist in changedFiles');
  const content = new TextDecoder().decode(result.changedFiles.get('/workspace/sub/nested.txt'));
  assert.strictEqual(content, "Nested directory file\n");
  console.log('✓ Subdirectory file access ("sub/nested.txt") verified');
}

// Test 8: C++ <fstream> (std::ofstream & std::ifstream)
{
  const src = [
    '#include <iostream>',
    '#include <fstream>',
    '#include <string>',
    'int main() {',
    '    {',
    '        std::ofstream out("cpp_data.txt");',
    '        if (!out.is_open()) return 1;',
    '        out << "Hello from C++ fstream!" << std::endl;',
    '        out << 42 << " " << 3.14159 << std::endl;',
    '    }',
    '    {',
    '        std::ifstream in("cpp_data.txt");',
    '        if (!in.is_open()) return 2;',
    '        std::string line1;',
    '        std::getline(in, line1);',
    '        int a;',
    '        double b;',
    '        in >> a >> b;',
    '        if (line1 == "Hello from C++ fstream!" && a == 42) {',
    '            return 0;',
    '        }',
    '    }',
    '    return 3;',
    '}'
  ].join('\n');

  const wasmBytes = await compileCode('test_fstream.cpp', src, true);
  const result = await runBinaryWithFiles(wasmBytes, {});

  assert.strictEqual(result.exitCode, 0, `C++ fstream test exited with code ${result.exitCode}`);
  assert.ok(result.changedFiles.has('/workspace/cpp_data.txt'), 'cpp_data.txt must be in changedFiles');
  const content = new TextDecoder().decode(result.changedFiles.get('/workspace/cpp_data.txt'));
  assert.ok(content.includes('Hello from C++ fstream!'));
  assert.ok(content.includes('42 3.14159'));
  console.log('✓ C++ <fstream> (std::ofstream & std::ifstream) verified');
}

console.log('--- ALL IN-CODE FILE I/O TESTS PASSED ---');
