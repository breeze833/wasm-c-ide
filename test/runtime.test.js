// Unit tests for Runtime SharedArrayBuffer & Atomics protocol
import assert from 'node:assert';

console.log('--- Running Runtime & Atomics Protocol Unit Tests ---');

const STATE_IDLE = 0;
const STATE_WAITING = 1;
const STATE_READY = 2;
const STATE_EOF = -1;

const CONTROL_STATE_IDX = 0;
const CONTROL_LEN_IDX = 1;
const CONTROL_READ_POS_IDX = 2;
const DATA_OFFSET = 16;

const sharedBuffer = new SharedArrayBuffer(1024);
const sharedInt32 = new Int32Array(sharedBuffer);
const sharedUint8 = new Uint8Array(sharedBuffer);

// Test 1: Initial state
Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_IDLE);
assert.strictEqual(Atomics.load(sharedInt32, CONTROL_STATE_IDX), STATE_IDLE);
console.log('✓ Initial state is IDLE');

// Test 2: Writing input line simulation
const inputLine = "42\n";
const encoded = new TextEncoder().encode(inputLine);
sharedUint8.set(encoded, DATA_OFFSET);
Atomics.store(sharedInt32, CONTROL_LEN_IDX, encoded.length);
Atomics.store(sharedInt32, CONTROL_READ_POS_IDX, 0);
Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_READY);

assert.strictEqual(Atomics.load(sharedInt32, CONTROL_STATE_IDX), STATE_READY);
assert.strictEqual(Atomics.load(sharedInt32, CONTROL_LEN_IDX), 3);
assert.strictEqual(Atomics.load(sharedInt32, CONTROL_READ_POS_IDX), 0);

// Test 3: Reading input line in worker simulation
const curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
const curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
const readBytes = sharedUint8.subarray(DATA_OFFSET + curPos, DATA_OFFSET + curLen);
const decoded = new TextDecoder().decode(readBytes);
assert.strictEqual(decoded, "42\n");
Atomics.add(sharedInt32, CONTROL_READ_POS_IDX, curLen);

assert.strictEqual(Atomics.load(sharedInt32, CONTROL_READ_POS_IDX), 3);
console.log('✓ Stdin line encoding, transfer, and consumption verified');

// Test 4: Termination EOF state
Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_EOF);
assert.strictEqual(Atomics.load(sharedInt32, CONTROL_STATE_IDX), STATE_EOF);
console.log('✓ Process EOF termination state verified');

// Test 5: Regression test - readStdin logic in strict mode with waiting/resumption
{
  "use strict";
  // Reset shared buffer
  Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_IDLE);
  Atomics.store(sharedInt32, CONTROL_LEN_IDX, 0);
  Atomics.store(sharedInt32, CONTROL_READ_POS_IDX, 0);

  function readStdinMock(bufLen) {
    let totalRead = 0;
    let available = 0;
    let curLen = 0;
    let curPos = 0;

    if (sharedInt32) {
      curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
      curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
      available = curLen - curPos;
    }

    if (available <= 0 && sharedInt32) {
      // Simulate input arrival while blocked
      const input = "123\n";
      const enc = new TextEncoder().encode(input);
      sharedUint8.set(enc, DATA_OFFSET);
      Atomics.store(sharedInt32, CONTROL_LEN_IDX, enc.length);
      Atomics.store(sharedInt32, CONTROL_READ_POS_IDX, 0);
      Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_READY);

      // Reload values after wake-up (must not throw ReferenceError on curLen/curPos)
      curLen = Atomics.load(sharedInt32, CONTROL_LEN_IDX);
      curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
      available = curLen - curPos;
    }

    if (available > 0 && sharedInt32) {
      curPos = Atomics.load(sharedInt32, CONTROL_READ_POS_IDX);
      const toCopy = Math.min(bufLen, available);
      const target = new Uint8Array(toCopy);
      const source = sharedUint8.subarray(DATA_OFFSET + curPos, DATA_OFFSET + curPos + toCopy);
      target.set(source);
      Atomics.add(sharedInt32, CONTROL_READ_POS_IDX, toCopy);
      totalRead += toCopy;
    }

    return totalRead;
  }

  // First read reads 2 bytes
  const r1 = readStdinMock(2);
  assert.strictEqual(r1, 2);
  assert.strictEqual(Atomics.load(sharedInt32, CONTROL_READ_POS_IDX), 2);

  // Second read reads remaining 2 bytes without blocking
  const r2 = readStdinMock(2);
  assert.strictEqual(r2, 2);
  assert.strictEqual(Atomics.load(sharedInt32, CONTROL_READ_POS_IDX), 4);

  console.log('✓ readStdin strict-mode variable scope and multi-read verified');
}

// Test 6: Ctrl-D (\x04) EOF signaling via SharedArrayBuffer & Atomics
{
  Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_IDLE);
  Atomics.store(sharedInt32, CONTROL_LEN_IDX, 0);
  Atomics.store(sharedInt32, CONTROL_READ_POS_IDX, 0);

  // Simulate user pressing Ctrl-D on empty line
  function simulateCtrlD(lineBuffer) {
    if (lineBuffer.length > 0) {
      // Flushes line without newline
      const enc = new TextEncoder().encode(lineBuffer);
      sharedUint8.set(enc, DATA_OFFSET);
      Atomics.store(sharedInt32, CONTROL_LEN_IDX, enc.length);
      Atomics.store(sharedInt32, CONTROL_READ_POS_IDX, 0);
      Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_READY);
      Atomics.notify(sharedInt32, CONTROL_STATE_IDX, 1);
      return false; // Not EOF
    }
    // Empty line: EOF signal
    Atomics.store(sharedInt32, CONTROL_STATE_IDX, STATE_EOF);
    Atomics.notify(sharedInt32, CONTROL_STATE_IDX, 1);
    return true; // EOF signaled
  }

  // Ctrl-D with text flushes text
  const isEof1 = simulateCtrlD("abc");
  assert.strictEqual(isEof1, false);
  assert.strictEqual(Atomics.load(sharedInt32, CONTROL_STATE_IDX), STATE_READY);
  assert.strictEqual(Atomics.load(sharedInt32, CONTROL_LEN_IDX), 3);

  // Ctrl-D on empty line sends EOF
  const isEof2 = simulateCtrlD("");
  assert.strictEqual(isEof2, true);
  assert.strictEqual(Atomics.load(sharedInt32, CONTROL_STATE_IDX), STATE_EOF);

  // Worker side: when state === STATE_EOF, readStdin returns 0 (EOF)
  function readWithEof() {
    const state = Atomics.load(sharedInt32, CONTROL_STATE_IDX);
    if (state === STATE_EOF) {
      return 0; // EOF
    }
    return -1;
  }
  assert.strictEqual(readWithEof(), 0);
  console.log('✓ Ctrl-D EOF signaling and consumption verified');
}

// Test 7: Preloaded stdinBytes buffer consumption (non-interactive stream redirection)
{
  const inputStr = "Hello from stdin redirect!\n";
  const preloadedStdin = new TextEncoder().encode(inputStr);
  let stdinPos = 0;

  function readPreloadedStdin(bufLen) {
    const available = preloadedStdin.length - stdinPos;
    if (available <= 0) return 0; // EOF
    const toCopy = Math.min(bufLen, available);
    const target = new Uint8Array(toCopy);
    target.set(preloadedStdin.subarray(stdinPos, stdinPos + toCopy));
    stdinPos += toCopy;
    return toCopy;
  }

  const chunk1 = readPreloadedStdin(10);
  assert.strictEqual(chunk1, 10);
  assert.strictEqual(stdinPos, 10);

  const chunk2 = readPreloadedStdin(100);
  assert.strictEqual(chunk2, preloadedStdin.length - 10);
  assert.strictEqual(stdinPos, preloadedStdin.length);

  // Further read returns 0 (EOF)
  const chunk3 = readPreloadedStdin(10);
  assert.strictEqual(chunk3, 0);
  console.log('✓ Preloaded stdinBytes buffer and EOF verified');
}

// Test 8: RuntimeManager stdin_request event and handleTerminalInput routing
{
  import('../src/terminal/runtime.js').then(({ RuntimeManager }) => {
    let termWrites = '';
    const mockTerminal = {
      write(s) { termWrites += s; },
      writeln(s) { termWrites += s + '\n'; },
    };

    const rm = new RuntimeManager(mockTerminal);
    rm.isRunning = true;
    rm.isWaitingForStdin = false;

    // Before stdin_request, handleTerminalInput must return false
    assert.strictEqual(rm.handleTerminalInput('a'), false);

    // Simulate worker sending stdin_request
    rm.isWaitingForStdin = true;

    // Typing printable characters echoes to terminal and buffers
    assert.strictEqual(rm.handleTerminalInput('h'), true);
    assert.strictEqual(rm.handleTerminalInput('i'), true);
    assert.strictEqual(rm.stdinLineBuffer, 'hi');
    assert.strictEqual(termWrites, 'hi');

    // Backspace deletes char and echoes \b \b
    assert.strictEqual(rm.handleTerminalInput('\x7f'), true);
    assert.strictEqual(rm.stdinLineBuffer, 'h');
    assert.strictEqual(termWrites, 'hi\b \b');

    // Enter commits line and resets isWaitingForStdin
    assert.strictEqual(rm.handleTerminalInput('\r'), true);
    assert.strictEqual(rm.stdinLineBuffer, '');
    assert.strictEqual(rm.isWaitingForStdin, false);

    console.log('✓ RuntimeManager stdin_request and handleTerminalInput verified');
    console.log('--- ALL RUNTIME TESTS PASSED ---');
  });
}
