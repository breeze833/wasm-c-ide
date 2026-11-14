# Software Specification: In-Browser C/C++ Teaching IDE with Unified VFS WASI Host & Zero-MemFS Architecture (Pure Static Wasm)

## 1. Project Overview & Objectives
The goal of this project is to build an installation-free, zero-backend, multi-file C/C++ programming development and learning environment that runs entirely client-side in modern web browsers via WebAssembly (Wasm).

This specification defines the architecture and design invariants of `wasm-c-ide`. The IDE completely eliminates `memfs.wasm` from the compilation toolchain and unifies all WASI Preview 1 (`wasi_snapshot_preview1`) host filesystem bindings across both the toolchain (`clang.wasm`, `lld.wasm`) and user binary runtime sandboxes (`runtime.worker.js`) into a single, high-performance, direct Virtual File System host (`src/vfs/wasi-host.js`). The IDE maintains a single, authoritative in-memory Virtual File System (`VFS`) serving as the single source of truth for the Monaco editor, file tree, shell worker, compiler, linker, archiver, and runtime execution.

### Key Objectives:
- **Zero Backend / Pure Static**: Hostable on static hosting services (GitHub Pages, Cloudflare Pages, static Nginx) with no server-side execution.
- **Single Source of Truth VFS**: Elimination of parallel in-memory filesystems. The compiler frontend (`clang.wasm`), linker (`lld.wasm`), runtime worker (`runtime.worker.js`), shell worker (`shell.worker.js`), and user interface all operate on the same unified `VFS`.
- **Zero-MemFS Toolchain**:
  - Eliminates `memfs.wasm` download, instantiation, and runtime overhead.
  - Eliminates all pre-compilation file synchronization and post-compilation artifact extraction bridges.
  - Eliminates historical C-level inode exhaustion, inode reuse, and buffer offset corruption bugs by relying on clean JavaScript `Map` and `Uint8Array` memory management.
  - **Shared Read-Only Sysroot (`SharedSysroot`) & Two-Tier Overlay VFS (`vfs-wasi`)**: Standard C/C++ sysroot headers and static runtime libraries (`sysroot.tar.gz`) are compiled into a contiguous memory-mapped `SharedArrayBuffer` (~108 MB) shared across all workers (`compiler`, `shell`, `runtime`), powered by the modular [`vfs-wasi`](https://github.com/breeze833/vfs-wasi) library. System paths (`/usr`, `/include`, `/lib`, `/bin`) operate as zero-copy, read-only overlays, while `/workspace` remains a dynamic, mutable virtual filesystem with differential synchronization. *(See [`docs/SHARED_SYSROOT_VFS.md`](./docs/SHARED_SYSROOT_VFS.md))*.
- **Comprehensive Standard C & C++ Library Headers**:
  - Full availability of standard C headers (`<stdio.h>`, `<stdlib.h>`, `<string.h>`, `<math.h>`, `<ctype.h>`, `<assert.h>`, `<stdint.h>`, `<stddef.h>`, `<stdbool.h>`, `<time.h>`, `<limits.h>`, `<float.h>`, `<inttypes.h>`, `<fcntl.h>`, `<sys/stat.h>`, `<dirent.h>`, etc.) and standard C++ headers (`<cstdio>`, `<cstdlib>`, `<cstring>`, `<cmath>`, `<cctype>`, `<cstddef>`, `<cstdint>`, `<cassert>`, `<ctime>`, `<climits>`, `<cfloat>`, `<cerrno>`, `<iostream>`, `<vector>`, `<string>`, `<fstream>`, `<algorithm>`, `<memory>`, `<map>`, `<set>`, etc.).
  - Zero missing header errors during teaching or shell exploration, with complete Musl C and LLVM libc++ sysroot structures directly accessible in both the compiler and the terminal shell.
- **Unified WASI Preview 1 Host (`WasiHost`)**:
  - Single, modular JavaScript engine implementing the complete WASI Preview 1 specification (`wasi_snapshot_preview1`).
  - Supports capability-based preopened directories (`.` / `/workspace`, `/`).
  - Scatter/gather I/O (`fd_read`, `fd_write`) with direct zero-copy `Uint8Array.set` transfers into and out of WebAssembly linear memory.
  - In-code standard file I/O (`fopen`, `fread`, `fwrite`, `fseek`, `ftell`, `fclose`, `<fstream>`) and interactive standard I/O (`scanf`, `cin`, `getchar`) seamlessly coordinated.
- **Pedagogical Discipline**: Enforce strict standard C mode (`-std=c11 -pedantic-errors`), disallow automatic saving to cultivate deliberate save habits, and route all GUI actions into visible shell terminal commands.
- **Strict Standard Link-Time Symbol Resolution**: The linker enforces standard resolution of undefined symbols, immediately reporting missing libraries or unlinked object files as standard `wasm-ld: error: undefined symbol: <name>` diagnostics rather than deferring failures to opaque runtime crashes. Authorized host imports (`canvas-wasi`) are strictly whitelisted via `--allow-undefined-file=/usr/lib/wasm-host-imports.txt`.
- **Decoupled Dual-Module Graphics Subsystems**:
  - **`canvas-wasi`**: Pure C direct software framebuffer (`<graphics.h>`), HTML5 Canvas 2D vector primitives (`<graphics_canvas.h>`), floating/dockable graphics console UI (`GraphicsWindowUI`), and shared 512-byte `SharedArrayBuffer` input coordination (`InputCoordinator`), powered by `canvas-window`.
  - **`raylib-wasi`**: Standalone Raylib 5.5 port, WebGL ES 2.0 host bridge, and pure WASI Web Audio subsystem, providing Wasm imports (`gl`, `raylib`) and zero-Emscripten `PLATFORM_CUSTOM` execution. Includes `raylib.h`, `raymath.h`, `rlgl.h`, and `raygui.h`. *(See [`docs/GRAPHICS_AND_TURTLE.md`](./docs/GRAPHICS_AND_TURTLE.md))*.
- **Turtle Graphics Subsystem (`libturtle`)**: Modular educational turtle graphics with dual backend support (Canvas-WASI and Raylib backends permanently bundled into sysroot out-of-the-box).
- **SQLite 3 Embedded Database & CLI Subsystem (`sqlite-wasi`)**: Precompiled SQLite 3.54.1 WASI Preview 1 static library (`libsqlite3.a`), C headers (`sqlite3.h`, `sqlite3ext.h`), and standalone interactive CLI (`sqlite3.wasm` mounted at `/usr/bin/sqlite3`) bundled permanently into sysroot, supporting relational databases with real-time VFS persistence. *(See [`docs/SHELL_AND_UTILITIES.md`](./docs/SHELL_AND_UTILITIES.md))*.
- **Unified Terminal Line Editor & Interactive Stdin Subsystem (`LineEditor` & `stdin-wasi`)**:
  - Zero-dependency prompt-safe line editor (powered by modular [`ansi-line-editor`](https://github.com/breeze833/ansi-line-editor)) and zero-dependency synchronous standard input coordinator (powered by modular [`stdin-wasi`](https://github.com/breeze833/stdin-wasi)) that unifies terminal input handling and WebAssembly blocking `fd_read` across the shell prompt (`ide:~$ `), interactive shell builtins (`cat`), and running WASI binaries (`sqlite3`, `scanf`, `fgets`). *(See [`docs/TERMINAL_AND_UI.md`](./docs/TERMINAL_AND_UI.md))*.
- **Toolchain Startup Acceleration & IndexedDB Binary Persistence**:
  - Streaming compilation (`WebAssembly.compileStreaming`) compiles bytecode concurrently as network chunks stream over the wire.
  - Persists raw 56 MB `ArrayBuffer` binaries inside IndexedDB (`wasm-c-ide-wasm-cache` -> `wasm_modules`), completely bypassing browser deprecation of `WebAssembly.Module` structured cloning (`DataCloneError`).
  - Subsequent launches retrieve pre-downloaded binaries from local disk in **<100ms** with zero network transfer.

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
+-------------------------------v---------------v-------------------------------v---------+
|                                Tri-Worker Architecture                                  |
|                                                                                         |
|  +--------------------------+  +-----------------------+  +--------------------------+  |
|  |       Shell Worker       |  |    Compiler Worker    |  |      Runtime Worker      |  |
|  |    (shell.worker.js)     |  |  (compiler.worker.js) |  |   (runtime.worker.js)    |  |
|  |  - busybox.wasm 1.38.0   |  |  - llvm-box.wasm 19.1 |  |  - User app (./a.out)    |  |
|  |  - POSIX Shell (ash)     |  |  - clang, lld, ar, nm |  |  - SQLite 3 (CLI/Lib)    |  |
|  |  - wasi_host_spawn Bridge|  |  - make.wasm (Make 4) |  |  - Raylib / Canvas / Txt |  |
|  |  - Real Unix Coreutils   |  |  - Zero-Freeze Builds |  |  - Atomics Stdin & FPS   |  |
|  +-------------+------------+  +-----------+-----------+  +------------+-------------+  |
|                |                           |                           |                |
|                +---------------------+     |     +---------------------+                |
|                                      v     v     v                                      |
|  +-----------------------------------------------------------------------------------+  |
|  |                         Two-Tier Overlay VFS Architecture                         |  |
|  |                                                                                   |  |
|  |  [Top Tier: Mutable Local VFS]                                                    |  |
|  |  - /workspace (Read-Write, Master VFS Authority, IndexedDB, Differential Sync)   |  |
|  |  - /dev (Virtual Character Devices: /dev/null, /dev/zero)                         |  |
|  |                                                                                   |  |
|  |  [Bottom Tier: Immutable SharedSysroot via SharedArrayBuffer (~108 MB)]           |  |
|  |  - /usr/include & /include/wasm32-wasip1 (Musl C, libc++, Raylib, Turtle headers)|  |
|  |  - /usr/lib & /lib/wasm32-wasip1 (libc.a, libc++.a, libraylib.a, libturtle.a)     |  |
|  |  - /bin & /usr/bin (Multi-call stubs: gcc, clang, make, sqlite3, busybox tools)  |  |
|  |  - Zero-Copy TypedArray Subarrays, Hardware Read-Only Protection (EROFS)          |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
| Offline Engine: Unified PWA Service Worker (COOP/COEP) + IndexedDB Wasm Cache           |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Subsystem Specifications & Technical Reference

Detailed technical specifications, binary layouts, memory protocols, and case studies are modularized in the following sub-documents:

| Subsystem | Architectural Focus | Technical Specification |
|---|---|---|
| **Two-Tier Overlay VFS & SharedSysroot (`vfs-wasi`)** | Memory-mapped `SharedArrayBuffer` (`SSYS`), FNV-1a index, zero-copy typed arrays, W3C safe decoding, and `EROFS` enforcement | [`docs/SHARED_SYSROOT_VFS.md`](./docs/SHARED_SYSROOT_VFS.md) |
| **Dedicated Compiler Web Worker** | Off-thread LLVM Clang toolchain execution, 60 FPS main-thread guarantee, streaming diagnostics, and `Ctrl+C` abort | [`docs/DEDICATED_COMPILER_WORKER.md`](./docs/DEDICATED_COMPILER_WORKER.md) |
| **BusyBox Shell, GNU Make & SQLite** | POSIX `ash` shell, 70+ coreutils, `wasi_host_spawn` process dispatch, directory stack, genuine GNU Make 4.4.1, and SQLite 3 | [`docs/SHELL_AND_UTILITIES.md`](./docs/SHELL_AND_UTILITIES.md) |
| **Graphics Canvas, Raylib & Turtle** | Decoupled 2D vector canvas, WebGL GLES 2.0 bridge, Web Audio API, `libturtle` backends, and frame pacing | [`docs/GRAPHICS_AND_TURTLE.md`](./docs/GRAPHICS_AND_TURTLE.md) |
| **Frame Pacing & Animation Delays** | Mathematical analysis of single-threaded WebAssembly frame production, `Atomics.wait()`, and progressive delays | [`docs/SINGLE_THREAD_FRAME_PACING.md`](./docs/SINGLE_THREAD_FRAME_PACING.md) |
| **Terminal, LineEditor & UI** | Detached 80x24 VT100 window, ANSI control, synchronous sleep (`poll_oneoff`), `LineEditor`, resizable sidebar, and settings | [`docs/TERMINAL_AND_UI.md`](./docs/TERMINAL_AND_UI.md) |
| **Editor & Reference Services** | Decision on removing partial hover providers, avoiding language tooling uncanny valley, and centralizing in Reference Drawer | [`docs/EDITOR_AND_REFERENCE_DESIGN.md`](./docs/EDITOR_AND_REFERENCE_DESIGN.md) |
| **Platform Host & Upstream Contracts** | Reference host contracts for WASI Preview 1, BusyBox bridge, canvas-wasi, and raylib-wasi | [`src/vfs/wasi-host.js`](./src/vfs/wasi-host.js) |
| **Known Issues & Constraints** | Documented version limits, browser quirks, and environment restrictions | [`docs/KNOWN_ISSUES.md`](./docs/KNOWN_ISSUES.md) |

### 3.1 Unified Platform Host (`WasiHost`) Summary
- Direct ownership of `src/vfs/wasi-host.js` as the first-class platform integrator composing WASI Preview 1, BusyBox host hooks, and graphics bridges.
- Routes path queries across the Two-Tier Overlay VFS (`/workspace` mutable top tier + `SharedSysroot` immutable bottom tier).
- Intercepts mutating syscalls (`path_open`, `path_unlink_file`, `path_remove_directory`, `path_create_directory`, `path_rename`) targeting system paths and enforces POSIX error `EROFS` (65).
- Preopens `fd 3` (`/workspace`, `.`) and `fd 4` (`/`, `/`) across toolchain, shell, and runtime sandboxes.
- Streams stdout/stderr directly to `xterm.js` and coordinates blocking stdin reads via `SharedArrayBuffer` and `Atomics.wait()`.

### 3.2 Toolchain & Persistent Binary Caching Summary
- Single unified multicall driver `llvm-box.wasm` (LLVM 19.1.0) containing `clang`, `clang++`, `wasm-ld`, `ar`, `nm`, `size`, `objdump`, `cxxfilt`, and `strings`.
- **Decoupled Toolchain & Driver via `clang-wasi`**:
  - Consumes high-level compiler driver functions (`parseCompilerArgs`, `executeGccCommand`, `executeLdCommand`, `executeToolCommand`) directly from `clang-wasi/driver`.
  - In-IDE `WasmToolchain` extends `WasmToolchain` from `clang-wasi/toolchain`, inheriting zero-copy VFS execution, multicall routing, and stage dispatching while augmenting it with browser-specific IndexedDB persistent module caching (`llvm-box-19.1.0`) and `SharedSysroot` initial mounting.
  - Pedagogical Pure C mode (`mode: 'c'`) explicitly passes `-std=c11 -pedantic-errors -Wall -Wextra` via compiler arguments when invoking `executeGccCommand`, preserving educational rigor over the generic `clang-wasi` driver.
- Persists raw 56 MB binary in IndexedDB (`wasm-cache.js`), bypassing `WebAssembly.Module` structured clone restrictions (`DataCloneError`) and loading in **<50ms** on repeat sessions.
- Streaming concurrent compilation via `WebAssembly.compileStreaming` with automatic buffer capture for offline persistence.
- Enforces strict link-time symbol resolution: missing libraries fail immediately at link time (`wasm-ld: error: undefined symbol`), while authorized host imports are whitelisted via `--allow-undefined-file=/usr/lib/wasm-host-imports.txt`.

### 3.3 Offline Delivery & Service Worker Summary
- Service Worker (`coi-serviceworker.js`) injects COOP/COEP headers to enable `SharedArrayBuffer` for cross-origin isolation.
- Large binary bypass: `llvm-box.wasm` (~56 MB) explicitly bypasses Service Worker `CacheStorage` stream cloning to eliminate stream buffer lockups, memory exhaustion, and `AbortError` timeouts.

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
| **Synchronous Shell Stdin (`cat > file`)** | Commands reading from shell stdin wait synchronously for user input in xterm, echo keystrokes, and terminate cleanly on `Ctrl-D` EOF without losing entered data. |
| **POSIX Heredoc & Multi-Line Scripting (`cat <<EOF`)** | Multi-line commands and heredocs accumulate under secondary prompt (`> `); early `Ctrl-D` termination synthesizes closing delimiters and prevents shell cleanup preamble leakage. |
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
| **Passive System Upgrade & Workspace Preservation** | Clicking `#modal-upgrade-btn` in Project Settings header displays confirmation dialog; confirming purges compiler wasm-cache (`IndexedDB`), clears Service Worker `CacheStorage`, unregisters the active Service Worker, and triggers a cache-busting reload (`?_upgrade=<timestamp>`) that bypasses the browser's HTTP disk cache, while keeping `/workspace` user files intact. |
| **Sysroot Revalidation & Dynamic Cache Invariant** | Unhashed sysroot assets under `/sysroot/wasm/` must be served with revalidation headers (`Cache-Control: no-cache, must-revalidate` with `Last-Modified` and `ETag`) rather than `immutable`. Workers must fetch sysroot binaries with `{ cache: 'no-cache' }` and use versioned cache keys so binary updates take effect immediately upon upgrade or rebuild without stale disk cache locks. |
| **Startup Loading Indication & Deferred Prompt** | Startup streams interactive loading indicators (animated braille spinner, live byte/percentage download progress bars, and checkmark step completion) into the xterm terminal area during VFS and toolchain preparation (`sysroot.tar.gz` fetching and decompression, runtime library preloading, SharedSysroot packing, and `llvm-box.wasm` compiler module loading); input is guarded during boot, and the welcome message and interactive shell prompt appear only after all VFS items and compiler toolchain modules are fully populated and ready. |
| **Slide-Out Right Reference Drawer UI** | Clicking `#btn-reference` or pressing `Ctrl+Shift+H` / `F1` toggles the slide-out drawer on the right without occluding the editor or disrupting terminal output. |
| **Offline Documentation Invariant** | In offline PWA mode, the reference drawer renders all tabs (Libc/WASI limits, Turtle, Canvas, Raylib, and SQLite) instantly with zero network requests. |
| **Pristine Upstream Headers Invariant** | Upstream headers (`raylib.h`, `sqlite3.h`) remain 100% byte-for-byte identical to upstream without manual docstring edits or patch drift. |
| **Libc & WASI Restrictions Guidance** | The General C Libc tab clearly documents unavailable syscalls (`fork`, `exec`, `sockets`, `pthreads`) and demonstrates idiomatic WASI alternatives (`poll_oneoff`, `WasiHost` VFS file I/O). |
| **1-Click Example Template Loading** | Clicking "Load Example" from any reference tab prompts cleanly if the active tab is unsaved, opens the corresponding C example in a new editor tab, and synchronizes with the file tree. |
| **External Documentation Link Safety** | Clicking external links to the public documentation site, Raylib cheatsheet, or SQLite reference opens in a new browser tab with `rel="noopener noreferrer"`, preserving active IDE state and avoiding navigation loss. |
| **Subpath & Base URL Documentation Resolution** | In any deployment subpath (e.g. `/`, `/ide/`, or GitHub Pages `/<repo>/`), clicking the "Open Full Documentation" link in the reference drawer navigates accurately to `${BASE_URL}docs/`, and links within the documentation navigate back to the IDE via `../` with zero 404 errors. |
| **SharedSysroot Binary Integrity** | Memory-mapped `SharedArrayBuffer` initializes with magic `SSYS`, valid entry count, index table, and zero-copy byte extraction without string parsing overhead. |
| **Overlay VFS Permission Enforcement** | Attempting to write, create, truncate, or delete files in system directories (`/usr`, `/include`, `/lib`, `/bin`) is intercepted by `WasiHost` and fails with `EROFS` (*Read-only file system*) or `EACCES`. |
| **Tri-Worker Sysroot Sharing** | Compiler Worker, Shell Worker, and Runtime Worker share a single contiguous `SharedArrayBuffer` instance without duplicate 108 MB heap allocations. |
| **Zero-Mock Sysroot Headers** | Eliminates legacy string-embedded mock C/C++ headers (`STANDARD_C_HEADERS`, `STANDARD_CPP_HEADERS`) from `src/vfs/sysroot.js`. Standard libc, libc++, and subsystem headers are exclusively sourced and served from the authoritative binary `SharedSysroot` (`sysroot.tar.gz`), eliminating code duplication, bundle bloat, and header divergence. |
| **Deep Sysroot Exploration in Shell** | Shell commands (`cat`, `ls`, `grep`) successfully inspect deep internal sysroot headers (e.g. `/include/wasm32-wasip1/stdio.h`, `/include/wasm32-wasip1/__struct_timespec.h`) directly from the shared memory-mapped sysroot. |
