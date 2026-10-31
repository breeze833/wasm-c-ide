# Software Specification v5: In-Browser C/C++ Teaching IDE with Unified VFS WASI Host & Zero-MemFS Architecture (Pure Static Wasm)

## 1. Project Overview & Objectives
The goal of this project is to build an installation-free, zero-backend, multi-file C/C++ programming development and learning environment that runs entirely client-side in modern web browsers via WebAssembly (Wasm).

SPECv5 extends SPECv4 by completely eliminating `memfs.wasm` from the compilation toolchain and unifying all WASI Preview 1 (`wasi_snapshot_preview1`) host filesystem bindings across both the toolchain (`clang.wasm`, `lld.wasm`) and the user binary runtime sandbox (`runtime.worker.js`) into a single, high-performance, direct Virtual File System host (`src/vfs/wasi-host.js`). In SPECv5, the IDE maintains a single, authoritative in-memory Virtual File System (`VFS`) that serves as the single source of truth for the Monaco editor, file tree, shell worker, compiler, linker, archiver, and runtime execution.

### Key Objectives:
- **Zero Backend / Pure Static**: Hostable on static hosting services (e.g., GitHub Pages, Cloudflare Pages, static Nginx) with no server-side execution.
- **Single Source of Truth VFS**: Elimination of parallel in-memory filesystems. The compiler frontend (`clang.wasm`), linker (`lld.wasm`), runtime worker (`runtime.worker.js`), shell worker (`shell.worker.js`), and user interface all operate on the same unified `VFS`.
- **Zero-MemFS Toolchain**:
  - Eliminates `memfs.wasm` download, instantiation, and runtime overhead.
  - Eliminates all pre-compilation file synchronization and post-compilation artifact extraction bridges.
  - Eliminates historical C-level inode exhaustion, inode reuse, and buffer offset corruption bugs by relying on clean JavaScript `Map` and `Uint8Array` memory management.
  - Standard C/C++ sysroot headers and static runtime libraries (`sysroot.tar.gz`) unpack directly into `VFS` read-only system paths (`/usr/include`, `/include/wasm32-wasip1`, `/lib/wasm32-wasip1`).
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
- **Turtle Graphics Subsystem (`libturtle`)**: Dual backend support (Canvas-WASI backend enabled by default; Raylib backend enabled dynamically via Project Settings).
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
+---------------------------------------|---------------------------------------|---------+
                                        | (Pty Stdin / Stdout stream)           | (Zero-copy
+---------------------------------------v---------------------------------------v--+     ImageBitmap)
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

### 3.1 Unified WASI Preview 1 Host (`WasiHost`)
- **Module Location**: `src/vfs/wasi-host.js`
- **Scope & Role**: Implements the `wasi_snapshot_preview1` and `wasi_unstable` interfaces for both compilation (`clang.wasm`, `lld.wasm`) and runtime execution (`a.out`).
- **Core Syscall Implementation**:
  - `path_open`: Resolves file access relative to directory descriptors (`dirfd`). Preopened descriptor 3 maps to `/workspace` (or `.`) and descriptor 4 maps to `/`. Translates WASI creation flags (`O_CREAT`, `O_TRUNC`, `O_EXCL`, `O_DIRECTORY`) and append mode (`FDFLAG_APPEND`). Allocates numerical file descriptors (`fd >= 10`).
  - `fd_read` / `fd_pread`: Implements scatter/gather reading across `iovec` arrays. For `fd 0` (stdin), invokes custom stream reader (blocking `Atomics.wait()` on `SharedArrayBuffer` for interactive runtime execution, preloaded byte stream for pipeline/file redirection, or immediate EOF). For regular files (`fd >= 10`), transfers bytes from `VFS` into Wasm linear memory via `Uint8Array.set()`.
  - `fd_write` / `fd_pwrite`: Implements scatter/gather writing across `iovec` arrays. For `fd 1` (stdout) and `fd 2` (stderr), routes text to terminal or stdout redirection buffer. For regular files, writes directly into `VFS`.
  - `fd_seek` & `fd_tell`: Updates byte offset for descriptor (`SEEK_SET = 0`, `SEEK_CUR = 1`, `SEEK_END = 2`).
  - `fd_close`: Releases file descriptor and triggers any file synchronization callbacks.
  - `fd_filestat_get` & `path_filestat_get`: Serializes standard 64-byte `__wasi_filestat_t` layout (`dev`, `ino`, `filetype`, `nlink`, `size` at offset 32, `atim`, `mtim`, `ctim`).
  - `fd_filestat_set_size`: Truncates or extends file byte buffer.
  - `fd_readdir`: Serializes standard `__wasi_dirent_t` entries with deterministic cookies for directory enumeration.
  - `path_unlink_file`: Directly removes file from `VFS`.
  - `path_create_directory`: Creates directory in `VFS`.
  - `path_rename`: Renames file or directory in `VFS`.
  - `fd_prestat_get` & `fd_prestat_dir_name`: Advertises preopened directory capabilities for `/workspace` and `/`.
  - `environ_sizes_get`, `environ_get`, `args_sizes_get`, `args_get`: Injects environment variables (`USER`, `PWD`) and command-line arguments.
  - `clock_time_get`, `clock_res_get`: High-resolution monotonic and realtime clocks.
  - `random_get`: Fills cryptographic random values via `crypto.getRandomValues`.
  - `proc_exit`: Terminate execution with exit status code.

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
- **Sysroot Mount (`sysroot.tar.gz`)**:
  - Downloaded on demand and unpacked directly into `VFS`.
  - Headers mounted under `/usr/include`, `/include/wasm32-wasip1`, `/lib/clang/19/include`, and `/usr/include/c++/v1`.
  - Static libraries mounted under `/usr/lib` and `/lib/wasm32-wasip1`: `crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libclang_rt.builtins.a`, `libm.a`, `libpthread.a`, `libturtle.a`, `libturtle_canvas-wasi.a` (and `libturtle_raylib.a` when Raylib is enabled).
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
  - Handled via `SharedArrayBuffer` and `Atomics.wait()` for synchronous `scanf` / `cin` / `getchar`.
  - Seamless fallback to preloaded buffer for `<` redirection and pipeline chaining (`|`).
  - `Ctrl-D` transmits `STATE_EOF` (`-1`) signaling EOF cleanly.
- Real-time VFS sync:
  - File operations (`fopen`, `<fstream>`, `fwrite`, `remove`, `rename`) directly update `VFS` and emit real-time event notifications (`file_sync`, `file_delete`) to refresh Monaco editor tabs and the File Tree UI.

### 3.4 Decoupled Graphics Subsystems & Turtle Graphics
- **`canvas-wasi`**: Pure C direct software framebuffer (`<graphics.h>`), Canvas 2D vector primitives (`<graphics_canvas.h>`), floating/dockable graphics console (`GraphicsWindowUI`), and 512-byte `SharedArrayBuffer` input coordination (`InputCoordinator`).
- **`raylib-wasi`**: Standalone Raylib 5.5 WASI runtime and WebGL ES 2.0 host bridge (`createRaylibHost`).
- **`libturtle`**: Modular educational turtle graphics with Canvas-WASI and Raylib backends.
  - **Link-Time Backend Resolution**: High-level initialization expands via `#define turtle_begin(ctx) (<backend>_turtle_init(ctx) && turtle_begin_core())` to guarantee link failure if code is linked against the incorrect backend archive.
  - **Automated Hermetic In-Tree Compilation**: `scripts/download-sysroot.js` clones `libturtle` into `build/libturtle` and compiles both backends (`canvas-wasi` and `raylib`) for `wasm32-wasi` directly via the in-tree `llvm-box.wasm` toolchain (`WasmToolchain`) and archives them via `buildArchive` (`ar.js`), eliminating host toolchain dependencies (no host `clang`, `llvm-ar`, or `make` required) and manual string fallbacks.
  - **Zero-Drift Virtual Sysroot Sync**: Copied headers in `public/sysroot/include/turtle/` automatically generate `src/vfs/turtle-headers.js`, ensuring the virtual sysroot remains synchronized with compiled static libraries.
- **Zero-Copy Frame Transfer**: Synchronous `transferToImageBitmap()` in Web Worker transferred via `postMessage({ type: 'frame', bitmap }, [bitmap])` to `ImageBitmapRenderingContext`.

### 3.5 Service Worker & Large Asset Delivery Optimization (`coi-serviceworker.js`)
- **Cross-Origin Isolation**: Injects `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to enable `SharedArrayBuffer` in modern browsers.
- **Large Asset Streaming Bypass**:
  - For large WebAssembly binaries (`llvm-box.wasm` ~56 MB), the Service Worker fetch handler explicitly bypasses `networkResponse.clone()` and `cache.put()`.
  - **Eliminating Abort Errors**: Buffering and cloning 56 MB streams inside a Service Worker fetch event frequently triggers stream buffer locks, high memory usage, and browser worker keepalive timeouts (30-60s), resulting in `DOMException: The operation was aborted.` (`AbortError`).
  - Bypassing `CacheStorage` cloning allows the network response to stream directly through to the client with COOP/COEP headers, while persistent caching is handled deterministically by the client-side IndexedDB binary cache.

---

## 4. Verification & Testing Checklist

| Test Case | Expected Behavior |
|---|---|
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
| **Canvas & Raylib Graphics** | Generic framebuffer, 2D vector canvas, and Raylib interactive graphics render at ~60 FPS via zero-copy `ImageBitmap`. |
| **Turtle Graphics Subsystem** | Both `canvas-wasi` and Raylib turtle backends compile and render progressive animations. |
| **Wasm Binary IndexedDB Caching** | First run saves 56MB `ArrayBuffer` to IndexedDB `wasm_modules`; subsequent sessions retrieve from local disk in <100ms with 0 network bytes. |
| **Cross-Browser DataCloneError Prevention** | Storing raw `ArrayBuffer` in IndexedDB succeeds across Firefox and Chrome without `DataCloneError`. |
| **Streaming Compilation & Fallback** | `WebAssembly.compileStreaming` compiles chunks concurrently with download; falls back gracefully to `arrayBuffer()`. |
| **Service Worker Large Asset Delivery** | `llvm-box.wasm` streams directly through Service Worker with COOP/COEP headers without buffer locks or timeout aborts (`The operation was aborted.`). |
| **Silent Background Pre-Warming** | Background toolchain warmup completes silently without printing to or disrupting the active xterm terminal prompt. |
