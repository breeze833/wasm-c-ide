# Software Specification: In-Browser C/C++ Teaching IDE with Unified VFS WASI Host & Zero-MemFS Architecture (Pure Static Wasm)

## 1. Project Overview & Objectives
The goal of this project is to build an installation-free, zero-backend, multi-file C/C++ programming development and learning environment that runs entirely client-side in modern web browsers via WebAssembly (Wasm).

This specification defines the architecture and design invariants of `wasm-c-ide`, featuring a zero-backend, multi-file C/C++ teaching IDE that completely eliminates `memfs.wasm` from the compilation toolchain and unifies all WASI Preview 1 (`wasi_snapshot_preview1`) host filesystem bindings across both the toolchain (`clang.wasm`, `lld.wasm`) and user binary runtime sandboxes (`runtime.worker.js`) into a single, high-performance, direct Virtual File System host (`src/vfs/wasi-host.js`). The IDE maintains a single, authoritative in-memory Virtual File System (`VFS`) serving as the single source of truth for the Monaco editor, file tree, shell worker, compiler, linker, archiver, and runtime execution.

### Key Objectives:
- **Zero Backend / Pure Static**: Hostable on static hosting services (e.g., GitHub Pages, Cloudflare Pages, static Nginx) with no server-side execution.
- **Single Source of Truth VFS**: Elimination of parallel in-memory filesystems. The compiler frontend (`clang.wasm`), linker (`lld.wasm`), runtime worker (`runtime.worker.js`), shell worker (`shell.worker.js`), and user interface all operate on the same unified `VFS`.
- **Zero-MemFS Toolchain**:
  - Eliminates `memfs.wasm` download, instantiation, and runtime overhead.
  - Eliminates all pre-compilation file synchronization and post-compilation artifact extraction bridges.
  - Eliminates historical C-level inode exhaustion, inode reuse, and buffer offset corruption bugs by relying on clean JavaScript `Map` and `Uint8Array` memory management.
  - Standard C/C++ sysroot headers and static runtime libraries (`sysroot.tar.gz`) unpack directly into `VFS` read-only system paths (`/usr/include`, `/include/wasm32-wasip1`, `/include/wasm32-wasip1/c++/v1`, `/lib/wasm32-wasip1`).
- **Comprehensive Standard C & C++ Library Headers**:
  - Full availability of standard C headers (`<stdio.h>`, `<stdlib.h>`, `<string.h>`, `<math.h>`, `<ctype.h>`, `<assert.h>`, `<stdint.h>`, `<stddef.h>`, `<stdbool.h>`, `<time.h>`, `<limits.h>`, `<float.h>`, `<inttypes.h>`, `<fcntl.h>`, `<sys/stat.h>`, `<dirent.h>`, etc.) and standard C++ headers (`<cstdio>`, `<cstdlib>`, `<cstring>`, `<cmath>`, `<cctype>`, `<cstddef>`, `<cstdint>`, `<cassert>`, `<ctime>`, `<climits>`, `<cfloat>`, `<cerrno>`, `<iostream>`, `<vector>`, `<string>`, `<fstream>`, `<algorithm>`, `<memory>`, `<map>`, `<set>`, etc.).
  - Zero missing header errors during teaching, with offline/in-memory virtual fallbacks mounted at `/usr/include/` on startup.
- **Unified WASI Preview 1 Host (`WasiHost`)**:
  - Single, modular JavaScript engine implementing the complete WASI Preview 1 specification (`wasi_snapshot_preview1`).
  - Supports capability-based preopened directories (`.` / `/workspace`, `/`).
  - Scatter/gather I/O (`fd_read`, `fd_write`) with direct zero-copy `Uint8Array.set` transfers into and out of WebAssembly linear memory.
  - In-code standard file I/O (`fopen`, `fread`, `fwrite`, `fseek`, `ftell`, `fclose`, `<fstream>`) and interactive standard I/O (`scanf`, `cin`, `getchar`) seamlessly coordinated.
- **Pedagogical Discipline**: Enforce strict standard C mode (`-std=c11 -pedantic-errors`), disallow automatic saving to cultivate deliberate save habits, and route all GUI actions into visible shell terminal commands.
- **Strict Standard Link-Time Symbol Resolution**: The linker enforces standard resolution of undefined symbols, immediately reporting missing libraries or unlinked object files as standard `wasm-ld: error: undefined symbol: <name>` diagnostics rather than deferring failures to opaque runtime crashes (exit code 1). Authorized host imports (`canvas-wasi`) are strictly whitelisted via `--allow-undefined-file=/usr/lib/wasm-host-imports.txt`.
- **Decoupled Dual-Module Graphics Subsystems**:
  - **`canvas-wasi`**: Pure C direct software framebuffer (`<graphics.h>`), HTML5 Canvas 2D vector primitives (`<graphics_canvas.h>`), floating/dockable graphics console UI (`GraphicsWindowUI`), and shared 512-byte `SharedArrayBuffer` input coordination (`InputCoordinator`), powered by `canvas-window`.
  - **`raylib-wasi`**: Standalone Raylib 5.5 port, WebGL ES 2.0 host bridge, and pure WASI Web Audio subsystem, providing Wasm imports (`gl`, `raylib`) and zero-Emscripten `PLATFORM_CUSTOM` execution. Includes `raylib.h`, `raymath.h`, `rlgl.h`, and `raygui.h`.
- **Turtle Graphics Subsystem (`libturtle`)**: Modular educational turtle graphics with dual backend support (Canvas-WASI and Raylib backends both permanently bundled into sysroot out-of-the-box).
- **SQLite 3 Embedded Database & CLI Subsystem (`sqlite-wasi`)**: Precompiled SQLite 3.54.1 WASI Preview 1 static library (`libsqlite3.a`), C headers (`sqlite3.h`, `sqlite3ext.h`), and standalone interactive CLI (`sqlite3.wasm` mounted at `/usr/bin/sqlite3`) bundled permanently into sysroot out-of-the-box, supporting SQL relational databases with real-time VFS persistence.
- **Unified Terminal Line Editor & Interactive Stdin Subsystem (`LineEditor`)**:
  - Zero-dependency prompt-safe line editor (`src/terminal/line-editor.js`) that unifies terminal input handling across the shell prompt (`ide:~$ `), interactive shell builtins (`cat`), and running WASI binaries (`sqlite3`, `scanf`, `fgets`).
  - Supports full in-line cursor movement (Left/Right arrows, Home/End, Ctrl+A/E), text editing (Backspace, Delete, Ctrl+K, Ctrl+U), and Up/Down arrow history recall with uncommitted scratch edit preservation.
  - Prompt-safe relative cursor redrawing ensures external/process prompts (such as `sqlite> `) are never overwritten or corrupted during history navigation.
  - Contextual history isolation maintains distinct history rings for shell commands versus application-level queries (e.g. `sqlite3`).
  - Strict preservation of `Ctrl-C` interrupt, `Ctrl-D` EOF handling, and Tab completion.
- **Toolchain Startup Acceleration & IndexedDB Binary Persistence**:
  - Eliminates slow remote downloads and compilation freezes on repeated IDE visits.
  - Streaming compilation (`WebAssembly.compileStreaming`) compiles bytecode concurrently as network chunks stream over the wire.
  - Universal binary caching: Persists raw 56 MB `ArrayBuffer` binaries inside IndexedDB (`wasm-c-ide-wasm-cache` -> `wasm_modules`), completely bypassing browser deprecation of `WebAssembly.Module` structured cloning (`DataCloneError`) across Firefox, Chrome, and Safari.
  - Subsequent launches retrieve the pre-downloaded binary from local disk in **<100ms** with zero network transfer.
  - Background pre-warming initiates silently on app startup so tools are warm before the user compiles.
  - Service Worker streaming: Large WebAssembly binaries (`llvm-box.wasm`) bypass Service Worker `CacheStorage` stream cloning, eliminating worker memory exhaustion and timeout-induced `AbortError` (`"The operation was aborted."`).

---

## 2. System Architecture
```
+-----------------------------------------------------------------------------------------+
|                                        Browser UI                                       |
|  +---------------------------+  +------------------------------------+  +------------+  |
|  | Multi-tab Code Editor     |  | Project Settings & Build Action Bar|  | Graphical  |  |
|  | (Monaco Editor & Zoom +/-)|  | (Save/Compile/Build/Run/Canvas/PWA)|  | Console    |  |
|  +-------------+-------------+  +-----------------+------------------+  | (Floating/ |  |
|                |                                  | (Transparent        |  Pop-out   |  |
|                v (Explicit Save / Dirty Marker)   v  pushd/cd/popd cmd) |  Canvas via|  |
|  +-------------+----------------------------------+------------------+  | canvas-    |  |
|  |               xterm.js Virtual Terminal & Zoom (+/-)              |  | wasi UI)   |  |
|  +------------------------------------+------------------------------+  +-----+------+  |
|                                       | (Keystrokes & ANSI Escapes)           |         |
|                       +---------------v---------------+                       |         |
|                       |   Unified LineEditor Engine   |                       |         |
|                       | (History, Cursor Nav, Editing)|                       |         |
|                       +-------+---------------+-------+                       |         |
+-------------------------------|---------------|-------------------------------|---------+
                                |               |                               | (Zero-copy
+-------------------------------v---------------v-------------------------------v--+ ImageBitmap)
|                         Web Worker Execution Sandboxes                           |
|                                                                                  |
|  +--------------------------+          +--------------------------------------+  |
|  |  BusyBox WASI Shell (ash)|          |  Wasm Runtime (App + Raylib / Turtle)|  |
|  |  - busybox.wasm 1.38.0   |          |  - SharedArrayBuffer (Stdin & Input) |  |
|  |  - POSIX Scripting & Ash |          |  - Atomics.wait (Blocking IO & FPS)  |  |
|  |  - Real Unix Coreutils   |          |  - OffscreenCanvas (WebGL/2D Context)|  |
|  |  - wasi_host_spawn Bridge|          |  - Unified WasiHost (WASI Preview 1) |  |
|  +-------------+------------+          +------------------+-------------------+  |
|                | (executes commands)                      |                      |
|                v                                          |                      |
|  +--------------------------------------------------------+                      |
|  |  LLVM 19 Single-Binary Toolchain (Direct VFS Host)                               |
|  |  - llvm-box.wasm 19.1.0 (clang, clang++, wasm-ld, ar, nm, size, objdump, etc.)    |
|  |  - WebAssembly.compileStreaming & IndexedDB Binary Persistence (wasm-cache.js)  |
|  |  - Unified WasiHost (Direct VFS I/O, Zero MemFS)                               |
|  +------------------------------------+------------------------------------------+
|                                       |
|                                       v
|  +-------------------------------------------------------------------------------+
|  | Virtual File System (VFS - Single Source of Truth)                            |
|  | - /workspace (Read-Write, IndexedDB Sync, .zip Export/Import)                |
|  | - /dev (Virtual Character Devices: /dev/null, /dev/zero)                     |
|  | - /usr/include & /include/wasm32-wasip1 (C/C++, graphics, turtle, raylib)     |
|  | - /usr/lib & /lib/wasm32-wasip1 (libc, libc++, compiler-rt, libturtle, raylib)|
|  | - /bin & /usr/bin (POSIX and Toolchain Binaries: gcc, g++, ar, make, etc.)   |
|  +-------------------------------------------------------------------------------+
+----------------------------------------------------------------------------------+
| Offline Engine: Unified PWA Service Worker (COOP/COEP) + IndexedDB Wasm Cache    |
+----------------------------------------------------------------------------------+
```

---

## 3. Detailed Component Specifications

### 3.1 Unified Platform Host (`WasiHost`) Integration & Architecture
- **Platform Host Ownership**: `wasm-c-ide` directly owns `src/vfs/wasi-host.js` as its first-class, version-controlled Platform Host runtime. Rather than dynamically downloading host bridge code from upstream component repositories at setup time, `wasm-c-ide` acts as the system platform integrator, composing and multiplexing the reference host contracts provided by each upstream component:
  1. **Standard WASI Preview 1 Core (`wasi_snapshot_preview1`)**: Baseline POSIX filesystem, preopens, stream I/O, clocks, and synchronous `poll_oneoff` timer sleeping (aligned with the reference specification from [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi)).
  2. **BusyBox Host Bridge (`env`)**: In-memory `MemoryPipe` FIFO buffer management with write-reference counting, descriptor duplication (`__host_pipe`, `__host_dup`, `__host_dup2`), terminal geometry bridging (`__host_winsize`, `__host_winch`), execution cancellation (`__host_interrupt`), and command dispatching (`__host_builtin_*`, `wasi_host_spawn`) (aligned with [`breeze833/busybox-wasi`](https://github.com/breeze833/busybox-wasi)).
  3. **Graphics & Audio Bridges (`canvas`, `gl`, `raylib`, `audio`)**: Multiplexes HTML5 Canvas 2D vector primitives and software framebuffers from [`breeze833/canvas-wasi`](https://github.com/breeze833/canvas-wasi) (v0.1.4) and WebGL ES 2.0 / Web Audio decoding from [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi).
- **Asset Download Separation**: `scripts/download-sysroot.js` downloads only precompiled binary assets (`llvm-box.wasm`, `sysroot.tar.gz`, `busybox.wasm`, `libraylib.a`, `libsqlite3.a`, `sqlite3.wasm`). JavaScript host runtime code is maintained directly within `src/vfs/wasi-host.js` and tracked in Git.
- **Direct VFS Binding**:
  - `WasiHost` binds directly to `wasm-c-ide`'s in-memory `VFS` instance (`src/vfs/vfs.js`).
  - Eliminates `memfs.wasm` and intermediate memory copying: all file operations operate directly on JavaScript `Uint8Array` buffers and the unified `Map` hierarchy shared by the Monaco editor, file tree sidebar, and terminal workers.
- **Dual Preopen Operational Modes**:
  1. **Toolchain Mode (`wasm-clang.js` & `driver.js`)**:
     - Preopens descriptor 3 (`name: '.'`, `path: '/workspace'`) and descriptor 4 (`name: '/'`, `path: '/'`).
     - Enables `llvm-box.wasm` (`clang`, `wasm-ld`, `llvm-ar`) to resolve user sources in `/workspace` alongside sysroot headers and runtime libraries in `/usr/include`, `/usr/lib`, `/include/wasm32-wasip1`, and `/lib/wasm32-wasip1`.
     - Supports dynamic inode mapping (`_getInode`) and non-zero device identifiers (`st_dev = 1n`) ensuring Clang header guards and inclusion tracking work reliably without circular loops.
  2. **Runtime Sandbox Mode (`runtime.worker.js`)**:
     - Preopens descriptor 3 (`name: '.'`, `path: '/workspace'`) exclusively.
     - Confines user application execution (`a.out`, `sqlite3`, etc.) to `/workspace`, preventing user code from mutating sysroot directories or system binaries.
- **Terminal & Stream Synchronization**:
  - **Standard Output & Error (`stdout`, `stderr`)**: Directs character streams directly to `xterm.js`. All stream redirection (`>`, `>>`, `2>`, `2>&1`) and pipeline chaining (`|`) are handled natively inside the `busybox.wasm` shell via standard WASI file descriptors, eliminating custom JavaScript stream-capturing layers.
  - **Standard Input (`stdin`)**: Synchronizes with the main browser thread via `SharedArrayBuffer` and `Atomics.wait()` in worker threads for blocking interactive reads (`scanf`, `cin`, `getchar`), coupled with the host `LineEditor`. For `<` redirection and shell pipelines, `ash` attaches the source file descriptor or in-memory pipe directly to `fd 0`.
  - **Bidirectional File Sync (`onFileSync`, `onFileDelete`)**: WasiHost lifecycle hooks stream file modification and unlinking events to `VFS`, immediately synchronizing dirty states with Monaco tabs and updating `FileTreeUI`.

### 3.2 Toolchain & Sysroot Integration (Zero-MemFS Single Binary)
- **Unified Toolchain Module (`llvm-box.wasm`)**:
  - Upstream LLVM 19.1.0 multicall binary from `breeze833/clang-wasi`.
  - Executes Clang compiler (`clang`, `clang++`, `clang-cpp`), LLD linker (`wasm-ld`, `lld`, `ld.lld`, `ld`), and LLVM utilities (`ar`, `ranlib`, `nm`, `objdump`, `size`, `cxxfilt`, `strings`, `readelf`, `strip`) through a single WebAssembly module instance.
  - Executed directly against `WasiHost` backed by `VFS`.
  - No `memfs.wasm` dependency and zero duplicate binary downloads (~110MB saved). Zero copy-in / copy-out overhead.
- **Toolchain Startup Lifecycle & Persistent Binary Cache (`wasm-cache.js`)**:
  - `src/toolchain/wasm-cache.js` provides an IndexedDB persistence layer (`wasm-c-ide-wasm-cache` database, `wasm_modules` object store).
  - Stores the raw 56 MB `ArrayBuffer` under cache key `'llvm-box-19.1.0'`.
  - **Overcoming Browser Engine Restrictions**: Modern browser engines (Firefox Gecko and Chromium V8) deprecated and removed structured cloning of `WebAssembly.Module` instances into IndexedDB, rejecting it with `DataCloneError`. The IDE therefore stores the raw `ArrayBuffer`, which is universally structured-cloneable across all browsers without restrictions.
  - **Subsequent Session Performance**: On repeat visits or tab reloads, `_getLlvmBox()` queries IndexedDB, reading the binary from local disk in **~50ms** and compiling it locally via `WebAssembly.compile()`, bypassing network transfer completely with **0 bytes downloaded**.
- **Streaming Compilation & Parallel Buffer Capture**:
  - On initial download, `_getLlvmBox()` concurrently compiles incoming network chunks via `WebAssembly.compileStreaming(res)` while teeing the response stream via `clone.arrayBuffer()` to simultaneously capture the `ArrayBuffer` for IndexedDB persistence without double-downloading.
  - Robust fallback: If `compileStreaming` fails (e.g. non-standard MIME type or test environment), cleanly falls back to `fetch().then(r => r.arrayBuffer())` and `WebAssembly.compile()`.
- **Silent Background Pre-Warming**:
  - `src/main.js` initiates `toolchain._getLlvmBox({ silent: true })` immediately after sysroot headers finish unpacking in the background. While the user reads code or edits files, the compiler is fetched and compiled without printing to or disrupting the terminal prompt.
- **Sysroot Mount (`sysroot.tar.gz`) & Header Hierarchy**:
  - Downloaded on demand and unpacked directly into `VFS`.
  - **Standard C / POSIX Headers**: Musl C headers reside under `/include/wasm32-wasip1/` and are mirrored directly to `/usr/include/` and `/include/`.
  - **Standard C++ Headers (`libc++`)**: The complete suite of LLVM `libc++` headers resides under `/include/wasm32-wasip1/c++/v1/` (`iostream`, `vector`, `string`, `cstdio`, `cstdlib`, `cmath`, `cstring`, `algorithm`, `memory`, `map`, `set`, etc.).
  - **Target-Independent Placeholder**: `/include/c++/v1/` is maintained as an empty directory placeholder according to the upstream `wasi-sdk` multi-target specification.
  - **Compiler Built-in Headers**: Clang built-in headers reside under `/lib/clang/19/include/`.
  - **In-Memory Virtual Fallback Headers (`sysroot.js`)**: `STANDARD_C_HEADERS` and `STANDARD_CPP_HEADERS` mount into `/usr/include/` immediately at app bootstrap, ensuring immediate Monaco editor syntax completions and offline fallback compilation even before `sysroot.tar.gz` is retrieved.
  - **Static Libraries**: Mounted under `/usr/lib` and `/lib/wasm32-wasip1`: `crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libclang_rt.builtins.a`, `libm.a`, `libpthread.a`, `libturtle.a`, `libturtle_canvas-wasi.a`, `libturtle_raylib.a`, `libraylib.a`, `libsqlite3.a`.
- **Compiler Frontend Search Priority & Zero-Shadowing Invariant (`wasm-clang.js`)**:
  - In C++ mode (`mode === 'cpp'`), `compile()` invokes `-cc1` with strictly ordered system search paths:
    1. `-internal-isystem /include/wasm32-wasip1/c++/v1` (primary libc++ headers)
    2. `-internal-isystem /include/c++/v1` (target-independent fallback placeholder)
    3. `-internal-isystem /lib/clang/19/include` (compiler builtins)
    4. `-internal-isystem /include/wasm32-wasip1` (Musl C standard library)
    5. `-internal-isystem /include`
    6. `-internal-isystem /usr/include`
  - **Zero-Shadowing `#include_next` Invariant**: `libc++` wrapper headers (e.g. `<cctype>`, `<cstring>`, `<cerrno>`) include their C counterparts using `#include_next`. Maintaining `/include/c++/v1` as an empty directory and preventing tar extraction from duplicating `c++/` subdirectories into `/include/c++` or `/usr/include/c++` ensures that `#include_next` passes cleanly through to Musl's C headers without tripping duplicate header guards, preventing unresolved identifiers like `errno`, `toupper`, and `memcpy`.
- **Driver Simplification (`driver.js`)**:
  - `executeGccCommand` coordinates command arguments, invokes Clang / LLD through `WasiHost`, and immediately accesses generated `.o`, `.s`, `.i`, or `a.out` binaries directly in `VFS`.
  - All legacy MemFS unlinking workarounds, 0-byte truncation invariants, and stale-file diffing logic are removed.
- **Strict Symbol Resolution & Host Import Whitelist**:
  - Blanket `--allow-undefined` is removed for executable targets.
  - `wasm-ld` invokes with `--allow-undefined-file=/usr/lib/wasm-host-imports.txt`, whitelisting only the 37 host functions declared in `<graphics.h>` and `<graphics_canvas.h>`.
  - Any reference to an unlinked function (e.g. omitting `-lraylib`, `-lturtle`, missing multi-file object files, or calling nonexistent C functions) halts immediately at link time with standard linker diagnostics (`wasm-ld: error: <file>.o: undefined symbol: <name>`).
  - WebAssembly shared objects (`.so`) retain `--allow-undefined` to support dynamic symbol resolution.
  - Compiler driver parses `--allow-undefined` and `-Wl,--allow-undefined` into linker flags, permitting explicit user overrides.

### 3.2.1 Dedicated Compiler Web Worker (`compiler.worker.js` & `compiler-client.js`)
- **Off-Thread Toolchain Execution**:
  - The LLVM Clang compiler (`clang`, `clang++`), LLD linker (`wasm-ld`), archiver (`ar`), and build engine (`make`) run entirely inside a dedicated background Web Worker (`src/workers/compiler.worker.js`), managed on the main thread via `CompilerClient` (`src/toolchain/compiler-client.js`).
  - Completely eliminates main-thread CPU starvation and UI freezes during large file compilation (such as `raygui.h` in `examples/10_raylib_gui_audio.c`).
  - Maintains 60 FPS responsiveness across Monaco editor tabs, floating canvas and terminal windows, and toolbar buttons during long compilations.
- **Persistent Pre-Warmed Worker**:
  - Unlike ephemeral user execution workers, `compiler.worker.js` remains persistent across build commands.
  - Fetches and decompresses `sysroot.tar.gz` and preloads static runtime archives (`libraylib.a`, `libturtle.a`, `libsqlite3.a`) into its internal VFS once during application bootstrap.
  - Pre-warms and retains the 30 MB `llvm-box.wasm` binary in memory via IndexedDB `wasm-cache.js`, achieving zero-instantiation compilation latency on all builds.
- **Incremental & Streaming Diagnostics**:
  - Compiler diagnostics, warnings, and verbose toolchain output stream in real-time from the compiler worker to the main thread via `postMessage({ type: 'stdout', id, data })`, updating `xterm.js` incrementally without batch buffering.
- **Instant `Ctrl+C` Abort Guarantee**:
  - When the user presses `Ctrl+C` or clicks the UI Stop button during compilation, the host immediately invokes `worker.terminate()`.
  - Aborts in-flight compilations instantaneously without waiting for Wasm execution loops to yield, returning cleanly to the shell prompt and re-spawning a replacement compiler worker in the background.
- **Differential `/workspace` VFS Synchronization**:
  - Prior to compilation, the host transmits only modified or newly created files in `/workspace` to the compiler worker.
  - On build completion, the compiler worker transmits newly created artifacts (`*.o`, `a.out`, `*.a`) and deleted files back to the host, updating the master `VFS` and triggering `FileTreeUI` refreshes.
- **Node.js Environment Fallback**:
  - `CompilerClient` transparently detects Node.js environments (such as unit test suites) and executes `WasmToolchain` in-process, preserving full test suite compatibility.

### 3.2.2 Real GNU Make WASI Integration (`make-wasi`)
- **Retirement of Educational Parser**:
  - Replaces the legacy JavaScript regex-based Makefile runner (`src/toolchain/make.js`) with genuine GNU Make 4.4.1 compiled for WASI Preview 1 (`public/sysroot/wasm/make.wasm`) from upstream package [`breeze833/make-wasi`](https://github.com/breeze833/make-wasi).
  - Delivers complete standard GNU Make capabilities:
    - Automatic variables: `$@`, `$<`, `$^`, `$*`, `$(@D)`, `$(@F)`.
    - Pattern rules: `build/%.o: src/%.c`.
    - Built-in functions: `$(patsubst ...)`, `$(filter ...)`, `$(wildcard ...)`, `$(dir ...)`.
    - Conditionals: `ifeq`, `ifneq`, `ifdef`, `ifndef`, `else`, `endif`.
    - Order-only prerequisites: `target: prereqs | order_only_dirs`.
    - Directives: `include <file>`.
    - Command flags: `-n` (dry run), `-k` (keep going), `-f FILE`, `-C DIR`, `-s` (silent), `-B` (always make).
- **Synchronous Recipe Dispatch Bridge (`wasi_run_recipe`)**:
  - GNU Make executes recipes via host import `env.wasi_run_recipe(cmdline, envp)`.
  - In `compiler.worker.js` (and `compiler-client.js` fallback), `makeBridge` delegates recipe lines to:
    - Filesystem built-ins (`mkdir -p`, `rm -rf`, `touch`, `cp`, `mv`, `echo`).
    - Toolchain compiler commands (`gcc`, `g++`, `clang`, `clang++`, `ar`, `wasm-ld`) executed synchronously via `executeGccCommandSync` and `AppInstance.createSync` against `llvmBoxModule`.
  - GNU Make `$(shell <cmd>)` expansions are evaluated synchronously via `env.wasi_capture_command`.
- **Accurate Nanosecond VFS Timestamp Evaluation & Touch Integration**:
  - `VFS` implements `setTimes(path, atim, mtim)` with monotonic forward advancement, and `WasiHost` overrides `path_filestat_set_times` and `fd_filestat_set_times` so shell commands like `touch` update mtimes on existing files without clobbering directories.
  - Differential workspace synchronizations across `shell.worker.js`, `compiler.worker.js`, and host `main.js` preserve `{ content, mtime }`, preventing reset of file mtimes during cross-worker dispatch.
  - `WasiHost` overrides `path_filestat_get` and `fd_filestat_get` to report genuine VFS modification timestamps (`node.mtime * 1000000n`).
  - Guarantees genuine incremental compilation: targets are evaluated against prerequisite timestamps, skipping up-to-date targets and rebuilding only modified units.
- **Sysroot Mounting**:
  - `/usr/bin/make` is pre-mounted into VFS via `mountSysrootUtilities` in `src/vfs/sysroot.js`.
  - `scripts/download-sysroot.js` downloads `make.wasm` from GitHub releases into `public/sysroot/wasm/make.wasm`.

### 3.3 Runtime & Interactive Standard I/O
- Target binaries run in `runtime.worker.js` using `WasiHost`.
- Standard input (`stdin`):
  - Handled via `SharedArrayBuffer` and `Atomics.wait()` on the worker thread for synchronous `scanf` / `cin` / `getchar` / `fgets`.
  - When invoked from the shell with `<` redirection or within a pipeline (`|`), input is routed by `ash` directly via standard WASI file descriptors.
  - Integrated with the host-side `LineEditor` (`src/terminal/line-editor.js`):
    - When a user binary requests interactive stdin, all terminal keystrokes pass through `RuntimeManager.prototype.handleTerminalInput()`.
    - Enables full in-line editing (Left/Right arrows, Home/End, Backspace, Delete) and Up/Down arrow history recall for interactive console applications.
    - Contextual history isolation automatically binds to the running binary name (`argv[0]`, e.g. `'sqlite3'` or `'a.out'`), preventing cross-contamination with shell commands.
    - `Ctrl-D` (`\x04`): If the input buffer contains uncommitted text, flushes the buffer immediately without a trailing newline; if the buffer is empty, transmits `STATE_EOF` (`-1`) signaling EOF cleanly to `readStdin`.
    - `Enter` (`\r`, `\n`): Commits the line into history, writes the string with `\n` to `SharedArrayBuffer`, and issues `Atomics.notify()` to resume the worker thread.
- Real-time VFS sync:
  - File operations (`fopen`, `<fstream>`, `fwrite`, `remove`, `rename`) directly update `VFS` and emit real-time event notifications (`file_sync`, `file_delete`) to refresh Monaco editor tabs and the File Tree UI.

### 3.4 Decoupled Graphics Subsystems, Turtle Graphics & Direct Sysroot Bundling
- **`canvas-wasi`**: Pure C direct software framebuffer (`<graphics.h>`), Canvas 2D vector primitives (`<graphics_canvas.h>`), floating/dockable graphics console (`GraphicsWindowUI`), and 512-byte `SharedArrayBuffer` input coordination (`InputCoordinator`), powered by `canvas-window`.
- **`raylib-wasi`**: Standalone Raylib 5.5 WASI runtime, WebGL ES 2.0 host bridge, and pure WASI Web Audio subsystem (`createRaylibHost`, `createAudioReceiver`).
- **Uniform Virtual Headers & Permanent Sysroot Bundling**:
  - `scripts/download-sysroot.js` auto-generates virtual header JS modules: `src/vfs/turtle-headers.js` and `src/vfs/raylib-headers.js`.
  - `mountSysroot(vfs)` mounts all graphics and GUI headers (`graphics.h`, `graphics_canvas.h`, `turtle.h`, `turtle_backend_canvas_wasi.h`, `turtle_backend_raylib.h`, `raylib.h`, `raymath.h`, `rlgl.h`, `raygui.h`) permanently under `/usr/include/` on app startup.
  - `libraylib.a`, `libturtle_raylib.a`, `libturtle.a`, and `libturtle_canvas-wasi.a` are preloaded into `/usr/lib/` and `/lib/wasm32-wasip1/` out of the box, requiring zero network calls or dynamic fetching at runtime.
  - Project Settings eliminates the `Enable Raylib Graphics Support` checkbox; users specify `-lraylib` or `-lturtle_raylib -lraylib` directly in Linker Flags.
- **Web Audio Subsystem & Main-Thread Proxying**: Pure WASI audio decoders and playback (`InitAudioDevice`, `Sound`, `Wave`, `Music`, `AudioStream`) executed without POSIX threads. The runtime worker proxies audio messages (`audio_init`, `audio_play`, `audio_stream_feed`, etc.) to the main thread `createAudioReceiver`, which manages browser `AudioContext` lifecycle and audio output.
- **`libturtle`**: Modular educational turtle graphics with Canvas-WASI and Raylib backends.
  - **Link-Time Backend Resolution**: High-level initialization expands via `#define turtle_begin(ctx) (<backend>_turtle_init(ctx) && turtle_begin_core())` to guarantee link failure if code is linked against the incorrect backend archive.
  - **Automated Hermetic In-Tree Compilation**: `scripts/download-sysroot.js` clones `libturtle` into `build/libturtle` and compiles both backends (`canvas-wasi` and `raylib`) for `wasm32-wasi` directly via the in-tree `llvm-box.wasm` toolchain (`WasmToolchain`) and archives them via `buildArchive` (`ar.js`), eliminating host toolchain dependencies.
- **Zero-Copy Frame Transfer**: Synchronous `transferToImageBitmap()` in Web Worker transferred via `postMessage({ type: 'frame', bitmap }, [bitmap])` to `ImageBitmapRenderingContext`.

### 3.5 Service Worker & Large Asset Delivery Optimization (`coi-serviceworker.js`)
- **Cross-Origin Isolation**: Injects `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to enable `SharedArrayBuffer` in modern browsers.
- **Large Asset Streaming Bypass**:
  - For large WebAssembly binaries (`llvm-box.wasm` ~56 MB), the Service Worker fetch handler explicitly bypasses `networkResponse.clone()` and `cache.put()`.
  - **Eliminating Abort Errors**: Buffering and cloning 56 MB streams inside a Service Worker fetch event frequently triggers stream buffer locks, high memory usage, and browser worker keepalive timeouts (30-60s), resulting in `DOMException: The operation was aborted.` (`AbortError`).
  - Bypassing `CacheStorage` cloning allows the network response to stream directly through to the client with COOP/COEP headers, while persistent caching is handled deterministically by the client-side IndexedDB binary cache.

### 3.6 Detached Floating Terminal Mode, ANSI VT100 Screen Control & Synchronous Sleep
- **Detached Floating Terminal Mode**:
  - Allows detaching the docked bottom terminal into a floating, draggable window with preset dimensions (80x24 standard VT100 geometry, cycling to 100x30 and 120x36).
  - Title bar dragging with viewport edge boundary clamping.
  - Sizing badge with interactive click-to-detach and click-to-cycle presets.
  - Window control actions: dynamic minimize/maximize toggling with proper icons (`_` underscore and `□` square).
  - Active focus tracking with distinct green glow outline (`box-shadow: 0 0 0 2px #22c55e, 0 16px 40px rgba(0,0,0,0.6)`).
  - Keyboard shortcut: `Ctrl+Shift+D` (or `Cmd+Shift+D`) to toggle between docked and floating modes.
- **ANSI VT100 Screen Control & UTF-8 Text Decoding**:
  - `WasiHost.prototype.readStr` in `src/vfs/wasi-host.js` decodes text streams using `TextDecoder('utf-8')` instead of single-byte concatenation.
  - Guarantees multi-byte UTF-8 sequences, box-drawing characters (`─`, `│`, `┌`, `┐`, `└`, `┘`, `┼`), and international characters render crisply in `xterm.js`.
  - Bundled example `08_ansi_terminal.c` demonstrating VT100 screen control, direct cursor positioning (`\033[%d;%dH`), colors, and animated progress bars.
- **Synchronous Timer Sleeping in WASI (`poll_oneoff`)**:
  - Implements clock timer subscription parsing (`WASI_EVENTTYPE_CLOCK`) in `WasiHost.prototype.poll_oneoff`.
  - Converts nanosecond timeouts to millisecond durations and sleeps synchronously via `Atomics.wait()` on `SharedArrayBuffer` when cross-origin isolated.
  - Powers standard POSIX `nanosleep(&ts, NULL)`, `usleep()`, `sleep()`, and turtle `delay_ms()` accurately without 100% CPU busy looping.

### 3.7 Collapsible (Slim Rail) & Resizable Workspace Sidebar
- **Dynamic Horizontal Resizing**:
  - Draggable vertical divider (`#sidebar-resizer`, 5px) positioned between the sidebar and editor with `col-resize` cursor and active accent highlight.
  - Dragging dynamically resizes the sidebar between `160px` and `window.innerWidth - 300px` (clamped to max `600px`), immediately triggering `EditorManager.prototype.layout()`.
  - Double-clicking the resizer handle resets the sidebar to its default `240px` width.
- **Collapsible Slim Rail**:
  - Collapsing reduces the sidebar to a `36px` slim vertical rail (`.sidebar.collapsed`) with the toggle button flipping to expand (`»`) and vertical label **`WORKSPACE`** (`writing-mode: vertical-rl; transform: rotate(180deg)`).
  - Clicking either the toggle button or the vertical strip expands the sidebar back to its previously chosen width.
  - While collapsed, `#sidebar-resizer` is automatically hidden (`display: none`).
- **Keyboard Shortcut**: `Ctrl+B` / `Cmd+B` toggles the sidebar between collapsed and expanded states (bound globally and within Monaco editor).
- **Session Persistence**: Both custom sidebar width (`wasm_c_ide_sidebar_width`) and collapsed state (`wasm_c_ide_sidebar_collapsed`) are persisted in `localStorage`.

### 3.8 Project Settings Modal & Configurable Run Execution
- **Decoupled Settings Modal Actions**:
  - **Save Button**: Persists configuration state (language mode, build system, include directories, compiler warning flags, linker flags, and custom run command) to application state and `localStorage` without modifying existing files in `/workspace`.
  - **Generate Build Script Button**: Scans source files in `/workspace` and generates or updates `/workspace/build.sh` and `/workspace/Makefile` reflecting configured compiler and linker flags.
- **Configurable Run Command**:
  - Adds the **Run Command** field (`#setting-run-cmd`) within the Project Settings modal for user customization of the command launched when clicking the toolbar **Run** button (`#btn-run`).
  - **Default Value**: `pushd . && cd /workspace && ./a.out; popd` (transparently preserves directory stack while running the target binary in `/workspace`).
  - **Session Persistence**: The custom run command is saved to `localStorage` under `wasm_c_ide_run_command` across browser sessions.
  - **Fallback Safeguard**: If left empty, automatically defaults back to `pushd . && cd /workspace && ./a.out; popd` to prevent blank command execution errors.
- **Passive System Upgrade & Toolchain Refresh (`#modal-upgrade-btn`)**:
  - Adds the **Update System** button (`#modal-upgrade-btn`) inside `.modal-header-actions` in the top-right corner of the Project Settings modal header, visually separated from the footer's **Save** and **Generate Build Script** buttons to eliminate accidental clicks.
  - **Double-Confirmation Barrier**: Clicking the button opens `#upgrade-confirm-overlay`, requiring explicit user confirmation before any action is taken.
  - **Selective Cache Purge Invariant (`upgradeSystemFiles()`)**: Purges `wasm-c-ide-wasm-cache` (`clearWasmCache()` wiping `llvm-box.wasm`) and Service Worker `CacheStorage` (`caches.delete(...)` wiping `sysroot.tar.gz` and static archives) and updates Service Worker registrations.
  - **Workspace Protection Invariant**: Strictly preserves `wasm_c_ide_db` (`workspace_files`) and `localStorage` so user code, directory structure, and preferences are 100% safeguarded against loss or overwriting.
  - Automatically invokes `window.location.reload()`, streaming fresh compiler tools and libraries from the server upon startup.

### 3.9 SQLite 3 WASI Embedded Database & CLI Subsystem (`sqlite-wasi`)
- **Remote Package Integration**:
  - Direct integration with upstream release package [`breeze833/sqlite-wasi`](https://github.com/breeze833/sqlite-wasi) (`v3.54.1`).
  - Fetched dynamically on-demand during project setup via `scripts/download-sysroot.js` without manual submodule or git tracking.
- **Sysroot Mount & Compilation Linkage**:
  - Standard headers `sqlite3.h` and `sqlite3ext.h` are permanently mounted under `/usr/include/` on startup.
  - Static library `libsqlite3.a` is mounted under `/usr/lib/` and `/lib/wasm32-wasip1/`.
  - User programs compile and link cleanly using standard `-lsqlite3` without additional flags or host bridges.
- **Standalone CLI Binary (`/usr/bin/sqlite3`)**:
  - `sqlite3.wasm` is mounted directly into `/usr/bin/sqlite3` in the in-memory `VFS`.
  - Registered in shell commands (`which sqlite3` resolves to `/usr/bin/sqlite3`).
  - Invoked directly in the xterm terminal: `sqlite3 [database-file] [sql]`.
  - Seamlessly interoperates with shell pipelines and input/output stream redirections (`<`, `>`, `>>`, `|`).
  - File operations on database files (`demo.db`) inside `/workspace` synchronize in real-time to the host VFS and File Tree UI.
  - **Interactive Shell Line-Editing & Arrow Keys Support**:
    - Standard SQLite `shell.c` falls back to `fgets()` under WASI Preview 1 due to the lack of POSIX `<termios.h>` raw terminal control. `wasm-c-ide` overcomes this by providing transparent host-side line-editing and history recall via `LineEditor`.
    - Users can press Up/Down arrows to recall previous SQL queries and Left/Right arrows, Home, End, Backspace, and Delete to edit in place without corrupting or overwriting the `sqlite> ` prompt.

### 3.10 Unified Terminal Line Editor & Prompt-Safe Stdin Subsystem (`LineEditor`)
- **Module Location**: `src/terminal/line-editor.js`
- **Scope & Architectural Role**:
  - Serves as the single, authoritative terminal line-editing engine for all interactive text input across `wasm-c-ide`.
  - Mediates between raw `xterm.js` keystrokes and both execution domains:
    1. **Shell Worker (`shell.worker.js`)**: Interactive POSIX shell prompt (`ide:~$ `) and interactive built-in stdin (`cat`).
    2. **Runtime Manager (`runtime.js`)**: Interactive standard input for running WebAssembly binaries (`sqlite3`, `scanf`, `fgets`, `cin`).
- **Syntax-Agnostic Invariant**:
  - `LineEditor` functions strictly as a user-facing interactive text navigation, editing, and history recall engine.
  - It does not tokenize, parse, split, or evaluate shell commands, quotes, command-chaining operators (`&&`, `||`, `;`), or stream redirections (`>`, `>>`, `<`, `|`).
  - Upon pressing `Enter`, the raw command-line string is transmitted verbatim to the `busybox.wasm` shell worker, ensuring complete syntactic fidelity to POSIX shell standards.
- **Prompt-Safe Relative Redrawing Algorithm**:
  - In CLI applications (such as SQLite's interactive shell `sqlite> `), the process writes its prompt directly to `stdout`. The host does not know the prompt length in advance.
  - `LineEditor` maintains cursor tracking strictly relative to the user's input line:
    - **Cursor back-stepping**: When navigating history or clearing text, the editor moves the cursor back by exactly `cursor` columns (`\b.repeat(cursor)`), landing precisely after the application prompt.
    - **Suffix clearing**: Emits `\x1b[K` to clear from the cursor to the end of the line, leaving the preceding application prompt completely intact.
    - **Buffer rewriting**: Writes the newly recalled history string or edited buffer, and repositions the cursor.
- **Keybinding & Navigation Matrix**:
  - **Horizontal Navigation**: Left Arrow (`\x1b[D`), Right Arrow (`\x1b[C`), Home (`\x1b[H`, `\x1b[1~`, `\x01` / `Ctrl+A`), End (`\x1b[F`, `\x1b[4~`, `\x05` / `Ctrl+E`).
  - **Text Deletion & Line Manipulation**: Backspace (`\x7f`, `\x08`), Delete (`\x1b[3~`), Kill to end-of-line (`\x0b` / `Ctrl+K`), Clear whole line (`\x15` / `Ctrl+U`).
  - **History Recall & Scratchpad Preservation**:
    - Up Arrow (`\x1b[A`): Navigates backward through history. When first moving up from an uncommitted line, saves the current buffer to a scratchpad (`savedScratch`).
    - Down Arrow (`\x1b[B`): Navigates forward through history. When returning to the bottom of the stack, restores the uncommitted scratchpad.
  - **Contextual History Isolation**: History stacks are namespaced by context (`'shell'`, `'sqlite3'`, `'default'`). Shell commands (`gcc`, `make`, `ls`) and SQL queries (`SELECT ...;`, `.tables`) remain cleanly segregated.
- **Signal & Control Key Invariants**:
  - **`Ctrl-C` (`\x03`)**: Bypasses line buffer insertion and directly triggers process / command interruption via `TerminalManager.prototype.onInterrupt` and `handleStopExecution()`.
  - **`Ctrl-D` (`\x04`)**:
    - If the line buffer is non-empty, flushes the partial buffer immediately without a trailing newline.
    - If the line buffer is empty, signals `STATE_EOF` (`-1`) to `readStdin` to cleanly close interactive CLI tools (e.g. `sqlite3`, `cat`) or prints `exit` at the shell prompt.
  - **`Tab` (`\t`)**: Passed to pluggable completion hooks (powering file and command completion in the shell worker).

### 3.11 Startup Loading Indication & VFS Population Lifecycle
- **Real-Time Informational Boot Feedback in Xterm**:
  - `TerminalManager` initializes early during `App.prototype.init()` so the xterm terminal viewport immediately displays streaming boot progress.
  - Informational startup messages are output sequentially:
    1. `[System] Initializing WebAssembly C/C++ environment...`
    2. `[*] Mounting virtual filesystem headers...` (`mountSysroot`)
    3. `[*] Loading workspace from storage...` (`loadWorkspace`)
    4. `[*] Preparing C/C++ standard library sysroot...` (`toolchain.init`)
    5. `[*] Fetching standard library sysroot archive (sysroot.tar.gz)...`
    6. `[*] Unpacking sysroot headers and runtime (<count> items)...`
    7. `[*] Preloading runtime libraries (libraylib, libturtle, libsqlite3)...`
    8. `[✓] System ready.`
- **Deferred Shell Prompt & Keystroke Guarding**:
  - The welcome banner (`Welcome to the In-Browser C/C++ Teaching IDE!`) and the interactive shell prompt (`ide:~$ `) are strictly deferred until all VFS items are populated.
  - The application tracks `this.isReady`: keystrokes and keyboard interrupts entered into the terminal during startup are discarded before VFS population finishes to prevent prompt corruption or commands running on an incomplete sysroot.
  - Precompiled runtime libraries (`libraylib.a`, `libturtle.a`, `libturtle_raylib.a`, `libsqlite3.a`) are fetched concurrently via `Promise.all` in `WasmToolchain.prototype.init()`, while prebuilt standalone CLI utilities (`sqlite3.wasm`) are mounted directly onto master `VFS` via `mountSysrootUtilities()`, keeping the compiler worker free of user program binaries.
- **Local Development Server Production Emulation (`emulate-production-sysroot`)**:
  - Vite's default development server compresses static files and attaches `Content-Encoding: gzip` on `.tar.gz` files while serving them with `Cache-Control: no-cache`, causing browser-side decompressive double-handling and slow re-fetching during local manual testing.
  - The custom `emulate-production-sysroot` Vite plugin intercepts `/sysroot/wasm/` requests in both `server` and `preview` modes, streams files as raw binary `application/octet-stream` without `Content-Encoding: gzip`, and sets `Cache-Control: public, max-age=31536000, immutable` alongside CORS and COOP/COEP headers, matching production caching and streaming behavior.

### 3.12 BusyBox WASI POSIX Shell & Host Process Dispatch Engine (`busybox-wasi`)
- **Remote Package Integration & Sysroot Asset**:
  - Directly integrates with upstream release package [`breeze833/busybox-wasi`](https://github.com/breeze833/busybox-wasi) (`v1.38.0`).
  - Fetched dynamically on-demand during project installation via `scripts/download-sysroot.js` and placed at `/sysroot/wasm/busybox.wasm`.
  - Cached permanently in IndexedDB via `wasm-cache.js` (`busybox-1.38.0`), ensuring zero-latency startup on subsequent sessions.
- **True POSIX Shell Scripting via `ash`**:
  - Completely replaces legacy JavaScript regex parsing and handwritten coreutils emulation in `shell.worker.js`.
  - Delivers complete standard POSIX shell scripting features:
    - Control structures: `for`, `while`, `until`, `if-then-else`, `case`.
    - Functions, local variables, environment exports (`export VAR=val`), parameter expansions (`${VAR:-def}`), and arithmetic expansions (`$((...))`).
    - In-process subshells `$(...)`, pipelines (`|`), and file redirections (`>`, `>>`, `<`).
    - Real compiled Unix coreutils: `grep`, `egrep`, `fgrep`, `sed`, `awk`, `find`, `sort`, `uniq`, `cut`, `tr`, `wc`, `head`, `tail`, `cat`, `cmp`, `diff`, `cp`, `mv`, `rm`, `mkdir`, `rmdir`, `touch`, `tar`, `gzip`, `gunzip`, `expr`, `bc`, `dc`, `date`, `sleep`, `which`.
- **The `make` Exception & Host Process Dispatch Bridge (`wasi_host_spawn`)**:
  - `ash` distinguishes between compiled internal applets and external commands.
  - When an external command is invoked, `ash` delegates execution to the host bridge via WebAssembly import:
    ```c
    __attribute__((__import_module__("env"), __import_name__("wasi_host_spawn")))
    int wasi_host_spawn(const char *cmd, const char *const *argv, const char *const *envp);
    ```
  - The host bridge intercepts `wasi_host_spawn` and dispatches according to command classification:
    1. **Build Engine (`make [targets...]`)**:
       - Handled as a transparent pseudo-external command: executes the JavaScript build engine `runMake()` (`src/toolchain/make.js`) directly against the in-memory `VFS`.
       - Evaluates Makefile rules, prerequisites, and file staleness (`mtime`), executing recipes through the toolchain and returning status code `0` (success) or `2` (failure) back to `ash`.
    2. **Compiler Toolchain (`gcc`, `clang`, `g++`, `clang++`, `wasm-ld`, `ar`, `nm`, `size`, `objdump`, `strings`)**:
       - Dispatched to `compiler.worker.js` via `CompilerClient.prototype.executeCommand`.
    3. **User Binaries (`./a.out`, `*.out`, `/workspace/*`)**:
       - Routed transparently via `__host_exec` bridge to `runtime.worker.js` via `RuntimeManager.prototype.runBinary`.
    4. **Prebuilt Binaries (`sqlite3`)**:
       - Dispatched to `runtime.worker.js` executing `/usr/bin/sqlite3.wasm`.
    5. **Execution Profiling (`time <cmd>`)**:
       - Dispatches command while profiling high-resolution elapsed time (`performance.now()`), outputting POSIX `real/user/sys` timing statistics.
    6. **Terminal Actions (`clear`, `exit`)**:
       - Emits clear-screen VT100 escapes to `xterm.js` or resets the terminal session.
  - Returns the exact exit code back into `ash`, cleanly preserving shell chaining operators (`make && ./a.out`, `make clean || true`).
- **Directory Stack (`pushd`, `popd`, `dirs`) & Subshell State Preservation**:
  - Implements POSIX-compliant shell functions for `pushd`, `popd`, and `dirs` backed by in-memory host synchronization (`__host_update_dstack`), with zero filesystem file creation.
  - Integrates with `MemoryPipe` write-reference-counting in `WasiHost`, guaranteeing that file descriptor duplications (`dup`, `dup2`) across subshell command substitutions `$(...)` and pipelines (`|`) do not prematurely close active reader pipes.
- **Sysroot Binary Stubs & Applet Publishing Invariant**:
  - `mountSysroot()` mounts all BusyBox multicall applets into `/bin/` (e.g. `cat`, `ls`, `head`, `tail`, `grep`, `awk`, `sed`, `find`, `sort`, `uniq`, `diff`, `wc`, `tar`, `tr`, etc.) and toolchain executables into `/usr/bin/` with WebAssembly binary headers (`\0asm`).
  - Ensures all supported Unix core utilities are fully discoverable via `ls /bin` and resolved accurately by `which <cmd>`, while preventing BusyBox `ash` from parsing them as shell scripts.
- **Single Source of Truth for Redirection & Pipelines**:
  - All stream redirections (`>`, `>>`, `<`, `2>`, `2>&1`) and inter-process pipelines (`|`) are handled **exclusively inside `ash` (`busybox.wasm`)** using standard WASI file descriptors and in-memory pipes.
  - When `ash` executes an external command via `wasi_host_spawn` (such as `make > build.log 2>&1`), `ash` has already redirected the standard file descriptors before invoking the host bridge. The host simply reads from or writes to the provided WASI descriptor, completely eliminating the legacy JavaScript regex parsing, token splitting, and manual stream buffering previously located in `shell.worker.js`.
- **Interactive Dual-Layer Terminal UX (`LineEditor` Integration)**:
  - Preserves the fast, prompt-safe `LineEditor` at the frontend (`xterm.js`):
    - Instant 60 FPS cursor positioning (Left/Right, Home/End, Backspace, Delete).
    - Up/Down history recall and scratchpad preservation.
    - Contextual history isolation and Tab autocompletion querying `VFS`.
  - When Enter is pressed, the complete command line is evaluated by `busybox.wasm sh -c "<cmd>"`.
  - Updates the active working directory (`cwd`) between `ash` and the IDE UI upon `cd`, ensuring the prompt (`ide:~/subfolder$ `) and file tree navigation remain synchronized.

---

## 4. Verification & Testing Checklist

| Test Case | Expected Behavior |
|---|---|
| **BusyBox POSIX Shell Scripting** | Interactive loops (`for`, `while`), conditionals (`if-then-else`), arithmetic `$((...))`, and subshells `$(...)` execute accurately with full POSIX semantics in xterm. |
| **Real Coreutils Execution** | `grep`, `sed`, `awk`, `find`, `sort`, `uniq`, `diff`, `tar`, `wc`, `head`, `tail` execute real BusyBox applets against `/workspace` files with correct standard flags and output; all 70+ applets are published in VFS `/bin` and discoverable via `ls /bin` and `which`. |
| **GNU Make WASI Execution** | Running `make` or `make clean` inside `ash` delegates to `runMake()` via `wasi_host_spawn`, executing genuine `make.wasm` to evaluate Makefile rules, automatic variables (`$@`, `$<`, `$^`), order-only prereqs (`|`), pattern rules (`%.o: %.c`), conditionals (`ifeq`), and includes; builds selectively according to mtime staleness and returns accurate exit codes back to `ash`. |
| **Chained Execution (`make && ./a.out`)** | Command chains linking `make` and user executables (`make && ./a.out`) execute sequentially, halting if `make` fails and running the binary if `make` succeeds. |
| **VFS Bidirectional Synchronization** | Shell file commands (`touch`, `mkdir`, `rm`, redirects `>`) immediately update the in-memory VFS and reflect in the sidebar file tree. |
| **Standard C/C++ Headers Compilation** | Programs including `<cstdio>`, `<cstdlib>`, `<cstring>`, `<cmath>`, `<cctype>`, `<cassert>`, `<iostream>`, `<vector>`, `<string>`, `<algorithm>`, and `<memory>` compile, link, and execute cleanly with `g++` and `clang++` without missing header or unresolved symbol errors. |
| **Direct VFS Clang Compilation** | `llvm-box.wasm` (`clang`) compiles C source files reading directly from VFS `/workspace` without MemFS. |
| **Direct VFS LLD Linkage** | `llvm-box.wasm` (`wasm-ld`) links object files and static archives directly from VFS `/lib/wasm32-wasip1` without MemFS. |
| **Strict Linker Symbol Resolution** | Referencing undefined symbols without linking required libraries causes `wasm-ld` to fail at link time with `undefined symbol: <name>`; whitelisted host imports link without errors. |
| **Zero-MemFS Asset Download** | `scripts/download-sysroot.js` runs without downloading or referencing `memfs.wasm`. |
| **Direct Binary Generation** | Compiling `main.c` generates `build/main.o` and `a.out` directly in VFS without copy-out delay. |
| **Header Probing Performance** | Clang `#include` resolution against 4,300+ sysroot headers executes swiftly via VFS path lookup. |
| **In-Code Standard File I/O** | `fopen`, `fread`, `fwrite`, `fseek`, `fclose`, and `std::fstream` operate seamlessly via unified `WasiHost`. |
| **Interactive `scanf` & `Ctrl-D` EOF** | Runtime worker standard input blocks via `SharedArrayBuffer` until Enter; `Ctrl-D` sends EOF cleanly. |
| **Pipelines & Redirections** | Command pipelines (`|`) and stream redirections (`<`, `>`, `>>`) execute deterministically across stages. |
| **Virtual Character Devices (`/dev/null`, `/dev/zero`)** | Shell stream redirections (`> /dev/null`, `< /dev/null`, `/dev/zero`) operate without allocating physical VFS storage; `ls /dev` lists virtual character devices `null` and `zero`. |
| **Static Archiver (`ar rcs`)** | Built-in `ar` creates archives directly in VFS; `wasm-ld` links against them without errors. |
| **Permanent Sysroot Bundling** | Raylib 5.5, Raylib turtle, and SQLite development files (`raylib.h`, `turtle.h`, `sqlite3.h`, `libraylib.a`, `libturtle.a`, `libsqlite3.a`) mount in sysroot by default. |
| **Canvas & Raylib Graphics** | Generic framebuffer, 2D vector canvas, and Raylib interactive graphics render at ~60 FPS via zero-copy `ImageBitmap`. |
| **Turtle Graphics Subsystem** | Both `canvas-wasi` and Raylib turtle backends compile and render progressive animations out-of-the-box. |
| **SQLite 3 C Compilation & Linking** | Programs including `<sqlite3.h>` compile and link cleanly with `-lsqlite3`, performing transactions with VFS persistence. |
| **SQLite 3 CLI Execution** | `sqlite3` command executes in terminal against `:memory:` or `/workspace/*.db` with interactive queries and stream redirection. |
| **Wasm Binary IndexedDB Caching** | First run saves 56MB `ArrayBuffer` to IndexedDB `wasm_modules`; subsequent sessions retrieve from local disk in <100ms with 0 network bytes. |
| **Cross-Browser DataCloneError Prevention** | Storing raw `ArrayBuffer` in IndexedDB succeeds across Firefox and Chrome without `DataCloneError`. |
| **Streaming Compilation & Fallback** | `WebAssembly.compileStreaming` compiles chunks concurrently with download; falls back gracefully to `arrayBuffer()`. |
| **Service Worker Large Asset Delivery** | `llvm-box.wasm` streams directly through Service Worker with COOP/COEP headers without buffer locks or timeout aborts (`The operation was aborted.`). |
| **Silent Background Pre-Warming** | Background toolchain warmup completes silently without printing to or disrupting the active xterm terminal prompt. |
| **Detached Floating Terminal Mode** | Floating window snaps to 80x24 standard VT100 dimensions, cycles through presets (100x30, 120x36), supports title dragging with viewport clamping, dynamic minimize/maximize icons (`_` and `□`), and active green glow focus. |
| **ANSI VT100 & UTF-8 Screen Control** | Programs using ANSI VT100 control sequences and UTF-8 multi-byte characters (box borders, cursor positioning, colors) render crisply in `xterm.js`. |
| **Synchronous Timer Sleeping** | WASI `poll_oneoff` accurately parses clock events and sleeps synchronously via `Atomics.wait` on `SharedArrayBuffer` without busy looping. |
| **Collapsible & Resizable Sidebar** | Sidebar freely resizes with smooth col-resize dragging, collapses to 36px slim vertical rail with vertical WORKSPACE label, responds to Ctrl+B, and persists width and collapsed state in localStorage. |
| **Configurable Run Command** | Project Settings modal configures custom run command with default `pushd . && cd /workspace && ./a.out; popd`, persists in `localStorage`, and injects into xterm on clicking `#btn-run`. |
| **Unified LineEditor In-Line Navigation** | Left/Right arrows, Home/End, Backspace, Delete, Ctrl+A/E, and Ctrl+K/U operate with accurate cursor positioning without prompt corruption across shell and user binaries. |
| **Arrow Key History Recall** | Up/Down arrows recall command history and restore uncommitted scratch edits across both shell and runtime. |
| **Contextual History Isolation** | Shell command history (`gcc`, `ls`) and application query history (`sqlite3`: SQL statements) maintain separate history stacks. |
| **Interactive SQLite3 Shell Line-Editing** | In `sqlite3` CLI, Up/Down arrows recall previous queries and Left/Right arrows move cursor in place without overwriting or erasing the `sqlite> ` prompt. |
| **Ctrl-D and Ctrl-C Invariants** | `Ctrl-C` immediately halts running binaries or interrupts the shell, while `Ctrl-D` cleanly terminates interactive sessions (`sqlite3`, `cat`) or sends EOF without input corruption. |
| **Passive System Upgrade & Workspace Preservation** | Clicking `#modal-upgrade-btn` in Project Settings header displays confirmation dialog; confirming purges compiler wasm-cache and Service Worker CacheStorage, triggers page reload, and keeps `/workspace` user files intact. |
| **Startup Loading Indication & Deferred Prompt** | Startup streams informational loading and progress messages into the xterm terminal area during VFS preparation (sysroot fetching, decompression, unpacking, library preloading); input is guarded during boot, and the welcome message and interactive shell prompt appear only after all VFS items are fully populated. |
