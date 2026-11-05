# Architecture Case Study: Dedicated Compiler Web Worker & Off-Thread Toolchain Execution

This document details the architectural rationale, threading constraints, and design decisions behind offloading the WebAssembly C/C++ compilation toolchain (`clang`, `wasm-ld`, `ar`, `make`) from the browser's main UI thread into a dedicated, persistent **Compiler Web Worker** (`src/workers/compiler.worker.js`).

---

## 1. Problem Statement: UI Freezing During Large Source Compilation

When compiling complex or large C/C++ source files inside `wasm-c-ide`—most noticeably [`examples/10_raylib_gui_audio.c`](../examples/10_raylib_gui_audio.c)—the browser interface experiences a complete freeze lasting several seconds:
1. **GUI Starvation**: Monaco editor tabs, action buttons, floating canvas/terminal windows, and window dragging become completely unresponsive to mouse clicks and keyboard events.
2. **Terminal Output Blocking**: Diagnostic messages (compiler warnings, verbose flags, linker output) are suppressed during compilation and flush only as a sudden burst once the command finishes.
3. **Uninterruptibility**: Pressing `Ctrl+C` in the terminal has no effect while the compiler is running because the thread is monopolized.

### Why Example 10 Triggers This Issue
Although `examples/10_raylib_gui_audio.c` is only ~460 lines of user code, it declares:
```c
#define RAYGUI_IMPLEMENTATION
#include "raygui.h"
```
[`raygui.h`](../public/sysroot/include/raylib/raygui.h) is an immediate-mode GUI library implemented as a single-header C file containing **5,758 lines of C code** (280 KB). When compiled with `RAYGUI_IMPLEMENTATION`, Clang parses, type-checks, generates LLVM Intermediate Representation (IR), and compiles over **7,500+ lines of intricate C code** (including `raylib.h`, math, and libc sysroot headers). Immediately after compilation, `wasm-ld` opens `libraylib.a` and `libc.a`, resolving symbol tables and relocations to produce `a.out`.

---

## 2. The Root Cause: Synchronous Execution on the Main Event Loop

In modern browsers, the main JavaScript execution context is single-threaded. It shares the same thread with the browser's rendering engine (DOM layouts, styling, paints, `requestAnimationFrame`) and event dispatching (mouse clicks, keypresses, resize events).

In earlier versions of `wasm-c-ide`, `WasmToolchain` ([`src/toolchain/wasm-clang.js`](../src/toolchain/wasm-clang.js)) was instantiated on the main browser thread via [`src/main.js`](../src/main.js). When `gcc` or `make` was invoked:
1. `shell.worker.js` parsed the command and dispatched an RPC message `callHost('exec_command', ...)` back to `src/main.js`.
2. `src/main.js` called `executeGccCommand({ toolchain: this.toolchain })`.
3. `WasmToolchain.compile()` invoked:
   ```javascript
   // src/toolchain/wasm-clang.js
   app.run() -> this.exports._start();
   ```
4. `_start()` is a **synchronous WebAssembly export**.

Because WebAssembly execution runs synchronously in JavaScript, executing billions of CPU instructions inside `_start()` completely blocks the main thread's event loop. Until `_start()` returns:
- The browser cannot dispatch DOM events (causing GUI unresponsiveness).
- The browser cannot repaint `xterm.js` canvas/DOM elements, even if Clang calls `this.terminal.write(str)` incrementally.

---

## 3. Comparative Analysis: Why User Programs Do Not Freeze the UI

A natural question arises: *Some example programs (such as 60 FPS Raylib graphics or interactive SQLite sessions) are also long-running WASM programs, yet they never freeze the UI. Why did compilation freeze the UI?*

The contrast lies entirely in where the execution occurs:

| Subsystem | Execution Location | Threading Model | Impact on UI |
|---|---|---|---|
| **User Binaries** (`./a.out`, `sqlite3.wasm`) | **Background Web Worker** ([`src/workers/runtime.worker.js`](../src/workers/runtime.worker.js)) | Dedicated background OS thread spawned via `RuntimeManager`. | **Zero freeze.** The main browser thread remains 100% idle and responsive at 60 FPS. |
| **Toolchain** (`gcc`, `clang`, `wasm-ld`, `ar`) | **Main Browser Thread** ([`src/main.js`](../src/main.js)) | Synchronous execution on the main JavaScript event loop. | **Total freeze.** Monopolizes CPU and blocks DOM rendering. |

---

## 4. Architectural Alternatives Considered

To move compilation off the main thread, three architectural approaches were evaluated:

### Alternative A: Merging Toolchain Execution into `shell.worker.js`
In this approach, `shell.worker.js` would instantiate `WasmToolchain` directly and run `gcc` without making RPC calls back to the host.

* **Flaw: Lack of Instant `Ctrl+C` Process Interruption**:
  WebAssembly in browsers does not support asynchronous POSIX signals (such as `SIGINT`). Once `_start()` is called inside a worker, that worker's event loop is blocked.
  If compilation runs inside `shell.worker.js`, incoming messages (like `type: 'interrupt'` on `Ctrl+C` or typing in xterm) **cannot be processed** until Clang finishes. The shell becomes unresponsive, and runaway compilations cannot be aborted.
* **Flaw: Memory Bloat in the Shell**:
  Compiling complex C code expands Clang's `WebAssembly.Memory` heap to **100 MB – 300 MB+**. Retaining this large linear memory permanently inside the interactive shell worker degrades the shell's memory efficiency.

### Alternative B: Executing the Toolchain via `runtime.worker.js`
In this approach, `llvm-box.wasm` would be treated as an ordinary user binary and executed using `runtimeManager.runBinary(...)`.

* **Flaw: Sysroot Overhead (~108 MB vs. < 1 MB)**:
  `runtime.worker.js` only receives a snapshot of `/workspace` (< 1 MB), which transfers in < 1 ms. However, Clang requires the entire standard C/C++ sysroot (`/usr/include`, `/include/wasm32-wasip1`, `/lib/clang/19/include`, `libc.a`, `libraylib.a`, etc.), which uncompresses to **~108 MB**. Serializing and copying 108 MB over `postMessage` on every compile command would introduce severe latency.
* **Flaw: Cold-Start Penalty on 30 MB Binary**:
  `runtime.worker.js` is ephemeral—it is spawned on-demand and destroyed upon process exit for clean user sandboxing. Re-compiling and re-instantiating the 30 MB `llvm-box.wasm` binary for every build would incur a 500 ms – 1.5 s penalty per command.
* **Flaw: Domain Mismatch**:
  `runtime.worker.js` is heavily customized for interactive graphics (WebGL ES 2.0, OffscreenCanvas 2D, `ImageBitmap`), audio (`createAudioReceiver`), and synchronous terminal stdin (`Atomics.wait`). A compiler is a headless batch pipeline that requires none of these subsystems.

---

## 5. The Chosen Solution: Dedicated Persistent Compiler Web Worker

The optimal design introduces a dedicated, persistent **Compiler Web Worker** ([`src/workers/compiler.worker.js`](../src/workers/compiler.worker.js)), governed by a host-side client controller ([`src/toolchain/compiler-client.js`](../src/toolchain/compiler-client.js)).

### Tri-Worker System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Main Browser Thread                           │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  Monaco Editor | xterm.js Terminal | Canvas Window | UI State  │   │
│   └──────┬─────────────────────────┬───────────────────────┬───────┘   │
│          │                         │                       │           │
│          │ User Input / RPC        │ Spawn / Frame / Stdin │ Compile   │
│          ▼                         ▼                       ▼           │
│   ┌──────────────┐          ┌──────────────┐       ┌───────────────┐   │
│   │ Shell Worker │          │Runtime Worker│       │Compiler Worker│   │
│   │(shell.worker)│          │(runtime.wrkr)│       │(compiler.wrkr)│   │
│   │              │          │              │       │               │   │
│   │ - POSIX CLI  │          │ - Sandboxed  │       │ - WasmToolchn │   │
│   │ - LineEditor │          │   user a.out │       │ - LLVM Clang  │   │
│   │ - History    │          │ - Atomics    │       │ - wasm-ld     │   │
│   │ - Tab-Compl. │          │   stdin wait │       │ - ar, make    │   │
│   │ - Pipelines  │          │ - WebGL &    │       │ - Pre-warmed  │   │
│   │ - Redirection│          │   Canvas-WASI│       │   Sysroot VFS │   │
│   └──────────────┘          └──────────────┘       └───────────────┘   │
│     Web Worker 1              Web Worker 2           Web Worker 3      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Key Design Invariants of the Compiler Worker

1. **Persistent Pre-Warmed Worker**:
   - `compiler.worker.js` is spawned during application startup.
   - It unpacks `sysroot.tar.gz` and pre-loads standard static libraries (`libraylib.a`, `libturtle.a`, `libsqlite3.a`) into its own internal VFS once.
   - It pre-compiles and warms up `llvm-box.wasm` (~30 MB) using IndexedDB binary caching, so all subsequent `gcc` and `make` invocations run with zero instantiation delay.
2. **Instant `Ctrl+C` Abort via `worker.terminate()`**:
   - Because the compiler worker is dedicated solely to toolchain execution, the host can instantly cancel an in-flight build by calling `worker.terminate()`.
   - The host prints `[Process interrupted]`, returns to the shell prompt, and transparently spawns a replacement compiler worker in the background.
3. **Real-Time Streaming Output**:
   - As Clang and LLD emit diagnostic messages, warnings, or errors, the compiler worker streams them via `postMessage({ type: 'stdout', id, data })`.
   - The main thread writes these chunks directly to `xterm.js`, allowing the user to view incremental build progress.
4. **Differential `/workspace` Synchronization**:
   - The host maintains the authoritative master VFS.
   - Before executing a compilation command, the host transmits only the modified or newly created files in `/workspace` (typically just the edited `.c` file, < 50 KB).
   - Upon completion, the worker returns only the newly created or modified artifacts (`*.o`, `a.out`, `*.a`) and deleted files, which the host commits to the master VFS.
5. **Node.js Fallback Compatibility**:
   - `compiler-client.js` detects whether it is running in a browser Web Worker environment or a Node.js testing environment.
   - In Node.js (where Web Workers are optional and DOM freezing does not apply), it executes `WasmToolchain` in-process, preserving 100% compatibility with all existing test suites.
