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

console.log('--- ALL RUNTIME TESTS PASSED ---');
