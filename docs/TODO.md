# Planned Improvements & Technical Debt (TODO)

This document tracks identified architectural improvements, technical debt, and pending refactoring tasks for `wasm-c-ide`.

---

## 1. Unify Shell Stdin Protocol via `stdin-wasi`

### Current State
In [`src/workers/shell.worker.js`](../src/workers/shell.worker.js#L99-L158), interactive shell applets (`cat > file`, `read`, heredocs) utilize a hand-rolled 60-line synchronous standard input reader (`readStdin`):
- Uses `Atomics.wait()` and `Atomics.notify()` over a multiplexed `SharedArrayBuffer`.
- Coordinates with [`src/main.js`](../src/main.js#L860-L950) via custom offsets:
  ```javascript
  const STDIN_STATE_IDX = 4;
  const STDIN_LEN_IDX = 5;
  const STDIN_READ_POS_IDX = 6;
  const STDIN_DATA_OFFSET = 32;
  ```
- Duplicates the standard input coordination and scatter-gather `iovec` algorithm that is now formalized and externalized in [`stdin-wasi`](https://github.com/breeze833/stdin-wasi).

### Why the Duplication Exists
The shell worker currently shares a single 512-byte `SharedArrayBuffer` with BusyBox host process execution (`CONTROL_IDX = 0`, `RESULT_IDX = 1`). To avoid collisions with the process lifecycle protocol, the shell stdin control block was placed at 32-bit indices 4, 5, 6 with data payload starting at byte offset 32.

### Proposed Solutions

#### Option A: Configurable Control & Data Offsets in `stdin-wasi`
- Extend `StdinHost` and `createStdinReader` in `stdin-wasi` to accept:
  - `controlOffset`: 32-bit word offset for state, len, read_pos (default `0`).
  - `dataOffset`: Byte offset for payload (default `16`).
- Once released in `stdin-wasi`, update `src/main.js` and `src/workers/shell.worker.js` to instantiate `StdinHost` and `createStdinReader` with `{ controlOffset: 4, dataOffset: 32 }`.

#### Option B: Dedicated Shell Stdin `SharedArrayBuffer`
- Allocate a dedicated standard 8 KB `SharedArrayBuffer` for shell standard input, separating it from the 512-byte BusyBox process spawn buffer.
- Allows using standard `new StdinHost({ bufferSize: 8192 })` in `main.js` and `createStdinReader({ sharedBuffer })` in `shell.worker.js` with zero modifications to `stdin-wasi`.

### Impact & Benefits
- Eliminates ~60 lines of low-level `Atomics` and scatter-gather loops in `src/workers/shell.worker.js`.
- Eliminates ~40 lines of manual atomic writes in `src/main.js`.
- Unifies shell and user binary standard input behavior under a single, tested package (`stdin-wasi`).
