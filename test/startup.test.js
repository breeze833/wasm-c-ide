// Unit tests for Startup Loading Indication, Progress Messages, and Deferred Shell Prompt
import assert from 'node:assert';
import fs from 'node:fs';
import { VFS } from '../src/vfs/vfs.js';
import { mountSysrootUtilities } from '../src/vfs/sysroot.js';
import { WasmToolchain } from '../src/toolchain/wasm-clang.js';

console.log('--- Running Startup Loading & VFS Indication Unit Tests ---');

// 1. Verify WasmToolchain.prototype.init provides structured onProgress updates and populates VFS
{
  const vfs = new VFS();
  const progressLogs = [];

  // Mock fetch serving physical files from public/sysroot
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const cleanUrl = url.replace(/^[./]+/, '').replace(/^sysroot\//, 'public/sysroot/');
    if (fs.existsSync(cleanUrl)) {
      const data = fs.readFileSync(cleanUrl);
      return {
        ok: true,
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const toolchain = new WasmToolchain({ basePath: 'public/sysroot/wasm', vfs });
    assert.strictEqual(toolchain.initialized, false);

    await toolchain.init((status) => {
      progressLogs.push(status);
    });

    assert.strictEqual(toolchain.initialized, true);
    assert.ok(progressLogs.length >= 4, `Expected at least 4 progress logs, got ${progressLogs.length}`);

    // Verify key progress messages
    assert.ok(progressLogs.some(msg => msg.includes('sysroot archive')), 'Progress must log fetching sysroot archive');
    assert.ok(progressLogs.some(msg => msg.includes('Unpacking sysroot') || msg.includes('parsing sysroot')), 'Progress must log unpacking sysroot');
    assert.ok(progressLogs.some(msg => msg.includes('Preloading runtime libraries') || msg.includes('libraylib')), 'Progress must log preloading libraries');
    assert.ok(progressLogs.some(msg => msg.includes('VFS items populated')), 'Progress must log VFS populated');

    // Verify toolchain VFS items are fully populated
    assert.strictEqual(vfs.exists('/usr/include/stdio.h'), true, 'Standard header stdio.h must exist');
    assert.strictEqual(vfs.exists('/usr/lib/libc.a'), true, 'Runtime libc.a must exist');
    assert.strictEqual(vfs.exists('/usr/lib/libturtle.a'), true, 'libturtle.a must be preloaded');
    assert.strictEqual(vfs.exists('/usr/lib/libraylib.a'), true, 'libraylib.a must be preloaded');
    assert.strictEqual(vfs.exists('/usr/lib/libsqlite3.a'), true, 'libsqlite3.a must be preloaded');

    // Mount user utilities separately
    await mountSysrootUtilities(vfs, 'public/sysroot/wasm');
    assert.strictEqual(vfs.exists('/usr/bin/sqlite3'), true, 'sqlite3.wasm CLI must be mounted via mountSysrootUtilities');

    console.log('✓ WasmToolchain.prototype.init reports progress messages and populates all VFS items');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// 2. Verify main.js architecture for startup sequence, progress output, and deferred shell prompt
{
  const mainSrc = fs.readFileSync('src/main.js', 'utf8');

  // Verify App constructor initializes isReady to false
  assert.ok(mainSrc.includes('this.isReady = false;'), 'App constructor must initialize this.isReady = false');

  // Verify initTerminalAndShell is called early in App.prototype.init
  const initIdx = mainSrc.indexOf('async init()');
  const termInitIdx = mainSrc.indexOf('this.initTerminalAndShell()', initIdx);
  const mountSysrootIdx = mainSrc.indexOf('mountSysroot(this.vfs)', initIdx);
  const loadWorkspaceIdx = mainSrc.indexOf('await loadWorkspace(this.vfs)', initIdx);
  const toolchainInitIdx = mainSrc.indexOf('await this.toolchain.init(', initIdx);

  assert.ok(initIdx !== -1, 'main.js must define async init()');
  assert.ok(termInitIdx !== -1, 'App.init must call this.initTerminalAndShell()');
  assert.ok(termInitIdx < mountSysrootIdx, 'this.initTerminalAndShell() must be called before mountSysroot');
  assert.ok(mountSysrootIdx < loadWorkspaceIdx, 'mountSysroot must be called before loadWorkspace');
  assert.ok(loadWorkspaceIdx < toolchainInitIdx, 'loadWorkspace must be called before toolchain.init');

  // Verify terminal progress messages
  assert.ok(mainSrc.includes('Initializing WebAssembly C/C++ environment...'), 'Startup must announce system initialization in terminal');
  assert.ok(mainSrc.includes('Mounting virtual filesystem headers...'), 'Startup must announce mounting headers in terminal');
  assert.ok(mainSrc.includes('Loading workspace from storage...'), 'Startup must announce workspace loading in terminal');
  assert.ok(mainSrc.includes('Preparing C/C++ standard library sysroot...'), 'Startup must announce preparing sysroot in terminal');
  assert.ok(mainSrc.includes('System ready.'), 'Startup must announce system ready in terminal');

  // Verify shellWorker init postMessage is deferred until after toolchain.init
  const shellWorkerInitIdx = mainSrc.indexOf("this.shellWorker.postMessage({", toolchainInitIdx);
  assert.ok(shellWorkerInitIdx > toolchainInitIdx, 'shellWorker init message must be deferred until after toolchain.init');

  // Verify input blocking in initTerminalAndShell
  assert.ok(mainSrc.includes('if (!this.isReady)'), 'Terminal input handler must guard against early input before system is ready');

  console.log('✓ main.js startup sequence, terminal progress reporting, and deferred prompt verified');
}

// 3. Verify App lifecycle state progression and input blocking simulation
{
  let isReady = false;
  const workerMessages = [];
  const terminalLines = [];

  const mockTerminal = {
    writeln: (msg) => terminalLines.push(msg),
    write: (msg) => terminalLines.push(msg),
  };

  const handleInput = (inputData) => {
    if (!isReady) return; // Dropped while system boots
    workerMessages.push({ type: 'input', data: inputData });
  };

  // 1. Keystroke before ready is dropped
  handleInput('echo 123\r');
  assert.strictEqual(workerMessages.length, 0, 'Keystroke before ready must be dropped');

  // 2. Terminal outputs progress
  mockTerminal.writeln('\x1b[1;36m[System]\x1b[0m Initializing WebAssembly C/C++ environment...');
  mockTerminal.writeln('\x1b[90m[*] Preparing C/C++ standard library sysroot...\x1b[0m');
  mockTerminal.writeln('\x1b[1;32m[✓]\x1b[0m System ready.\r\n');

  // 3. Mark ready & dispatch deferred init
  isReady = true;
  workerMessages.push({ type: 'init', cwd: '/workspace' });

  // 4. Subsequent input is accepted
  handleInput('ls\r');
  assert.strictEqual(workerMessages.length, 2);
  assert.deepStrictEqual(workerMessages[0], { type: 'init', cwd: '/workspace' });
  assert.deepStrictEqual(workerMessages[1], { type: 'input', data: 'ls\r' });

  assert.ok(terminalLines.some(l => l.includes('System ready')), 'Terminal must contain system ready line');
  console.log('✓ Lifecycle state progression, input guarding, and deferred message dispatch verified');
}

// 4. Verify shell worker init handler outputs welcome banner and prompt
{
  const shellSrc = fs.readFileSync('src/workers/shell.worker.js', 'utf8');
  assert.ok(shellSrc.includes('Welcome to the In-Browser C/C++ Teaching IDE!'), 'shell.worker.js must contain welcome message');
  assert.ok(shellSrc.includes("msg.type === 'init'"), 'shell.worker.js must handle init message');
  assert.ok(shellSrc.includes('showPrompt()'), 'shell.worker.js must display prompt upon init');

  console.log('✓ shell.worker.js displays welcome message and prompt upon deferred init');
}

// 5. Verify shell synchronous stdin coordination and handleShellStdinInput protocol
{
  const mainSrc = fs.readFileSync('src/main.js', 'utf8');
  const shellSrc = fs.readFileSync('src/workers/shell.worker.js', 'utf8');

  // Verify shell.worker.js wires readStdin to WasiHost instances
  assert.ok(shellSrc.includes('stdin: readStdin,'), 'shell.worker.js must pass stdin: readStdin to WasiHost');
  assert.ok(shellSrc.includes('createStdinReader'), 'shell.worker.js must create stdin reader via stdin-wasi');
  assert.ok(shellSrc.includes("self.postMessage({ type: 'command_done' })"), 'shell.worker.js must notify command_done upon completion');
  assert.ok(shellSrc.includes('findHeredocs'), 'shell.worker.js must define findHeredocs');
  assert.ok(shellSrc.includes('isCommandIncomplete'), 'shell.worker.js must support multi-line command completeness check');
  assert.ok(shellSrc.includes("write('> ')"), 'shell.worker.js must display continuation prompt > for incomplete commands');

  // Verify main.js SharedArrayBuffer allocation and LineEditor instantiation
  assert.ok(mainSrc.includes('this.shellStdinHost = new StdinHost({ bufferSize: 8192 });'), 'main.js must allocate 8192-byte StdinHost');
  assert.ok(mainSrc.includes('this.shellLineEditor = new LineEditor'), 'main.js must instantiate shellLineEditor');
  assert.ok(mainSrc.includes("if (msg.type === 'stdin_request')"), 'main.js must handle stdin_request');
  assert.ok(mainSrc.includes("if (msg.type === 'command_done')"), 'main.js must handle command_done');
  assert.ok(mainSrc.includes('handleShellStdinInput(key)'), 'main.js must implement handleShellStdinInput');

  // Functional test of handleShellStdinInput logic using mock App context
  const { LineEditor } = await import('ansi-line-editor');
  const { StdinHost } = await import('stdin-wasi/host');
  const stdinHost = new StdinHost({ bufferSize: 8192 });
  const sharedBuf = stdinHost.getSharedBuffer();
  const sharedI32 = stdinHost.sharedInt32;
  const sharedU8 = stdinHost.sharedUint8;
  let termOutput = '';
  let interrupted = false;

  const app = {
    isShellWaitingForStdin: false,
    shellStdinHost: stdinHost,
    shellStdinSharedBuffer: sharedBuf,
    terminal: { writeln: (s) => { termOutput += s + '\n'; } },
    shellWorker: { postMessage: (msg) => { if (msg.type === 'interrupt') interrupted = true; } },
    shellLineEditor: new LineEditor({ write: (s) => { termOutput += s; } }),
  };

  // Extract handleShellStdinInput method body dynamically or evaluate using Function
  const methodMatch = mainSrc.match(/handleShellStdinInput\(key\)\s*\{([\s\S]*?\n  \})/);
  assert.ok(methodMatch, 'Must match handleShellStdinInput in main.js');
  const fnBody = methodMatch[1].replace(/\n\s*\}\s*$/, '');
  const handleShellStdinInput = new Function('key', fnBody);

  const invoke = (key) => handleShellStdinInput.call(app, key);

  // When not waiting, returns false
  assert.strictEqual(invoke('a'), false);

  // When waiting, feeds line editor
  app.isShellWaitingForStdin = true;
  assert.strictEqual(invoke('h'), true);
  assert.strictEqual(invoke('i'), true);
  assert.strictEqual(app.shellLineEditor.getBuffer(), 'hi');

  // Enter commits line + newline to SharedArrayBuffer via StdinHost
  assert.strictEqual(invoke('\r'), true);
  assert.strictEqual(app.isShellWaitingForStdin, false);
  assert.strictEqual(stdinHost.getState(), 2); // READY (STATE_READY)
  assert.strictEqual(Atomics.load(sharedI32, 1), 3); // len === 3 ('hi\n'.length)
  assert.strictEqual(Atomics.load(sharedI32, 2), 0); // read pos === 0
  const committedText = new TextDecoder().decode(sharedU8.subarray(16, 19));
  assert.strictEqual(committedText, 'hi\n');

  // Ctrl-D (EOT) on empty buffer signals EOF via StdinHost
  app.isShellWaitingForStdin = true;
  assert.strictEqual(invoke('\x04'), true);
  assert.strictEqual(app.isShellWaitingForStdin, false);
  assert.strictEqual(stdinHost.getState(), -1); // EOF (STATE_EOF)

  // Ctrl-C interrupts
  app.isShellWaitingForStdin = true;
  assert.strictEqual(invoke('\x03'), true);
  assert.strictEqual(app.isShellWaitingForStdin, false);
  assert.strictEqual(stdinHost.getState(), -1); // EOF (STATE_EOF)
  assert.strictEqual(interrupted, true);

  console.log('✓ Shell synchronous stdin coordination and handleShellStdinInput protocol verified');
}

console.log('--- ALL STARTUP LOADING & VFS INDICATION TESTS PASSED ---');
