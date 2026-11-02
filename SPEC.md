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
  - **`canvas-wasi`**: Pure C direct software framebuffer (`<graphics.h>`), HTML5 Canvas 2D vector primitives (`<graphics_canvas.h>`), floating/dockable graphics console UI (`GraphicsWindowUI`), and shared 512-byte `SharedArrayBuffer` input coordination (`InputCoordinator`).
  - **`raylib-wasi`**: Standalone Raylib 5.5 port and WebGL ES 2.0 host bridge, providing Wasm imports (`gl`, `raylib`) and zero-Emscripten `PLATFORM_CUSTOM` execution.
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
|  |    POSIX Shell Worker    |          |  Wasm Runtime (App + Raylib / Turtle)|  |
|  |  - History & Autocomplete|          |  - SharedArrayBuffer (Stdin & Input) |  |
|  |  - Directory Stack & Globs|         |  - Atomics.wait (Blocking IO & FPS)  |  |
|  |  - Pipelines & Redirects |          |  - OffscreenCanvas (WebGL/2D Context)|  |
|  +-------------+------------+          |  - Unified WasiHost (WASI Preview 1) |  |
|                | (executes commands)   +------------------+-------------------+  |
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

### 3.1 Unified WASI Preview 1 Host (`WasiHost`) Integration
- **Upstream Source of Truth**: The `WasiHost` engine and its standard WASI Preview 1 syscall implementations (`path_open`, `fd_read`, `fd_write`, `fd_filestat_get`, `fd_readdir`, etc.) are authoritatively specified and maintained in [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi) (`SPEC.md`).
- **Module Location & Lifecycle**: `src/vfs/wasi-host.js` is dynamically fetched from `clang-wasi` (`src/wasi-host.js`) on demand during project installation and setup via `scripts/download-sysroot.js`. It is gitignored to avoid repository divergence.
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
  - **Standard Output & Error (`stdout`, `stderr`)**: Directs character streams to xterm.js, or captures streams to memory buffers during pipeline stages (`|`) and file redirections (`>`, `>>`).
  - **Standard Input (`stdin`)**: Synchronizes with the main browser thread via `SharedArrayBuffer` and `Atomics.wait()` in worker threads for blocking interactive reads (`scanf`, `cin`, `getchar`), coupled with the host `LineEditor`. Supports immediate buffer feed for `<` input redirection.
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

### 3.3 Runtime & Interactive Standard I/O
- Target binaries run in `runtime.worker.js` using `WasiHost`.
- Standard input (`stdin`):
  - Handled via `SharedArrayBuffer` and `Atomics.wait()` on the worker thread for synchronous `scanf` / `cin` / `getchar` / `fgets`.
  - Seamless fallback to preloaded buffer for `<` redirection and pipeline chaining (`|`).
  - Integrated with the host-side `LineEditor` (`src/terminal/line-editor.js`):
    - When a user binary requests interactive stdin, all terminal keystrokes pass through `RuntimeManager.prototype.handleTerminalInput()`.
    - Enables full in-line editing (Left/Right arrows, Home/End, Backspace, Delete) and Up/Down arrow history recall for interactive console applications.
    - Contextual history isolation automatically binds to the running binary name (`argv[0]`, e.g. `'sqlite3'` or `'a.out'`), preventing cross-contamination with shell commands.
    - `Ctrl-D` (`\x04`): If the input buffer contains uncommitted text, flushes the buffer immediately without a trailing newline; if the buffer is empty, transmits `STATE_EOF` (`-1`) signaling EOF cleanly to `readStdin`.
    - `Enter` (`\r`, `\n`): Commits the line into history, writes the string with `\n` to `SharedArrayBuffer`, and issues `Atomics.notify()` to resume the worker thread.
- Real-time VFS sync:
  - File operations (`fopen`, `<fstream>`, `fwrite`, `remove`, `rename`) directly update `VFS` and emit real-time event notifications (`file_sync`, `file_delete`) to refresh Monaco editor tabs and the File Tree UI.

### 3.4 Decoupled Graphics Subsystems, Turtle Graphics & Direct Sysroot Bundling
- **`canvas-wasi`**: Pure C direct software framebuffer (`<graphics.h>`), Canvas 2D vector primitives (`<graphics_canvas.h>`), floating/dockable graphics console (`GraphicsWindowUI`), and 512-byte `SharedArrayBuffer` input coordination (`InputCoordinator`).
- **`raylib-wasi`**: Standalone Raylib 5.5 WASI runtime and WebGL ES 2.0 host bridge (`createRaylibHost`).
- **Uniform Virtual Headers & Permanent Sysroot Bundling**:
  - `scripts/download-sysroot.js` auto-generates virtual header JS modules: `src/vfs/turtle-headers.js` and `src/vfs/raylib-headers.js`.
  - `mountSysroot(vfs)` mounts all graphics headers (`graphics.h`, `graphics_canvas.h`, `turtle.h`, `turtle_backend_canvas_wasi.h`, `turtle_backend_raylib.h`, `raylib.h`, `raymath.h`, `rlgl.h`) permanently under `/usr/include/` on app startup.
  - `libraylib.a`, `libturtle_raylib.a`, `libturtle.a`, and `libturtle_canvas-wasi.a` are preloaded into `/usr/lib/` and `/lib/wasm32-wasip1/` out of the box, requiring zero network calls or dynamic fetching at runtime.
  - Project Settings eliminates the `Enable Raylib Graphics Support` checkbox; users specify `-lraylib` or `-lturtle_raylib -lraylib` directly in Linker Flags.
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

---

## 4. Verification & Testing Checklist

| Test Case | Expected Behavior |
|---|---|
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
