# WebAssembly C/C++ Teaching IDE

A zero-backend, installation-free, multi-file C/C++ development and learning environment running entirely client-side in the browser via WebAssembly (Wasm).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cross-Origin Isolated](https://img.shields.io/badge/Cross--Origin_Isolation-COOP%2FCOEP-green.svg)](#cross-origin-isolation--security-requirements)
[![Client-Side Wasm](https://img.shields.io/badge/Architecture-100%25_Static_Wasm-orange.svg)](#purpose--pedagogical-vision)

---

## Table of Contents

- [Purpose & Pedagogical Vision](#purpose--pedagogical-vision)
- [Key Features](#key-features)
  - [Editor & Workspace UI](#1-editor--workspace-ui)
  - [Interactive POSIX Shell & Terminal](#2-interactive-posix-shell--terminal)
  - [Clang & LLD WebAssembly Toolchain](#3-clang--lld-webassembly-toolchain)
  - [Dual Build Systems (Shell Script & Makefile)](#4-dual-build-systems-shell-script--makefile)
  - [Execution Sandbox, Synchronous Stdin & In-Code File I/O](#5-execution-sandbox-synchronous-stdin--in-code-file-io)
  - [Unified Graphics Canvas, Vector 2D & Game Engine](#6-unified-graphics-canvas-vector-2d--game-engine)
  - [Turtle Graphics Subsystem (libturtle)](#7-turtle-graphics-subsystem-libturtle)
  - [SQLite 3 Embedded Database & CLI Subsystem (sqlite-wasi)](#8-sqlite-3-embedded-database--cli-subsystem-sqlite-wasi)
  - [Interactive Educational Examples Suite](#9-interactive-educational-examples-suite)
  - [Virtual File System & Storage](#10-virtual-file-system--storage)
  - [Progressive Web App (PWA) & Offline Execution](#11-progressive-web-app-pwa--offline-execution)
  - [Integrated API Reference & Documentation Subsystem](#12-integrated-api-reference--documentation-subsystem)
- [Getting Started & Local Development](#getting-started--local-development)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Development Server](#development-server)
  - [Running Tests](#running-tests)
  - [Production Build](#production-build)
- [Deployment](#deployment)
  - [GitHub Pages](#github-pages)
  - [Nginx](#nginx)
  - [Caddy](#caddy)
  - [Cloudflare Pages / Vercel](#cloudflare-pages--vercel)
  - [Cross-Origin Isolation & Security Requirements](#cross-origin-isolation--security-requirements)
- [Documentation & Technical Guides](#documentation--technical-guides)
- [License](#license)

---

## Purpose & Pedagogical Vision

Traditional online code playgrounds abstract away the build system, silently bundle code in black-box containers, auto-save files on execution, or execute code on remote servers. 

This IDE is specifically engineered for **students and systems programming educators**:
- **Zero Backend**: 100% client-side static application. No cloud servers, no account logins, no remote telemetry, and zero hosting runtime costs.
- **Educational Transparency**: Demystifies the compilation, assembly, and linking phases. Students observe object files (`.o`), binaries (`a.out`), header search paths, and compiler flags directly in the file tree and terminal.
- **Pedagogical Discipline**:
  - **No Hidden Bridges**: Clicking UI action buttons (Compile, Build, Run) does not invoke private JS APIs; it writes transparent POSIX commands into the terminal emulator.
  - **Explicit Save Habits**: Files never auto-save on build. Modifying a file marks it dirty (`*`). Building with unsaved edits displays a warning that the binary is built from disk state.
  - **Strict Standard C Mode**: Pure C mode enforces `-x c -std=c11 -pedantic-errors -Wall -Wextra`, rejecting C++ extensions (e.g. C++ keywords as identifiers) to teach standard-compliant C.
  - **Standard C++ Support**: Seamlessly toggleable to C++ mode (`-std=c++17`) with standard library support (`<iostream>`, `<vector>`, `<string>`, `<fstream>`, etc.).

---

## Key Features

### 1. Editor & Workspace UI
- **Monaco Code Editor**: Powered by the same engine as VS Code with dark theme, syntax highlighting, and keyboard shortcuts (`Ctrl+S` / `Cmd+S`).
- **Tab Management & Dirty Tracking**: Visual dirty indicator (`*`) when in-memory buffers differ from VFS disk state.
- **Ergonomic Toolbar**:
  - Color-coded header action buttons with icons: **Save** (cyan), **Compile** (violet), **Build** (blue), **Run** (green), **Stop** (red), and **Settings**.
  - Compact sidebar workspace actions with floating tooltips: **New File**, **New Folder**, **Import Zip**, and **Export Zip**.
- **Collapsible & Resizable File Tree**:
  - **Horizontal Drag Resizing**: Vertical drag divider (`#sidebar-resizer`) between sidebar and editor with `col-resize` cursor (drag freely between 160px and 600px; double-click to reset to default 240px).
  - **36px Slim Rail Collapse**: Collapses smoothly into a 36px slim vertical rail displaying the toggle button and vertical **WORKSPACE** badge, freeing up maximum horizontal width for the code editor.
  - **Keyboard Shortcut**: `Ctrl+B` / `Cmd+B` toggles between collapsed and expanded modes.
  - **Persistence**: Remembers custom width and collapsed state in `localStorage` across sessions.
  - Hierarchical folder tree with inline file and directory creation, deletion, and file opening.

### 2. Interactive POSIX Shell & Terminal
- **xterm.js Terminal**: Embedded terminal emulator with ANSI colors, line wrapping, and dynamic window resizing.
- **Detached Floating Window Mode**:
  - Detach the terminal from the bottom dock into a floating window snapping to standard **80x24** VT100 dimensions.
  - Interactive preset cycling badge: click the dimension badge to cycle through standard presets (`80x24` $\to$ `100x30` $\to$ `120x36`).
  - Draggable title bar with viewport edge boundary clamping and dynamic dimension calculation on resize.
  - Window control actions: minimize to title bar (`_`) and maximize/restore (`□`).
  - Active focus tracking with distinct green glow outline.
  - Global keyboard shortcut: `Ctrl+Shift+D` (or `Cmd+Shift+D`) to toggle between docked and floating modes.
- **Interactive Shell Worker & 70+ BusyBox Unix Utilities**:
  - Full-featured POSIX `ash` shell powered by `busybox.wasm`.
  - All 70+ compiled BusyBox core utilities (`ash`, `awk`, `basename`, `bc`, `cat`, `cksum`, `cmp`, `comm`, `cp`, `crc32`, `cut`, `date`, `dc`, `diff`, `dirname`, `du`, `echo`, `egrep`, `expr`, `false`, `fgrep`, `find`, `fold`, `getopt`, `grep`, `gunzip`, `gzip`, `head`, `hexdump`, `httpd`, `kill`, `ls`, `md5sum`, `mkdir`, `mktemp`, `mv`, `nproc`, `paste`, `printenv`, `printf`, `pwd`, `readlink`, `realpath`, `rm`, `rmdir`, `sed`, `seq`, `sh`, `sha1sum`, `sha256sum`, `sleep`, `sort`, `stat`, `stty`, `tac`, `tail`, `tar`, `tee`, `test`, `touch`, `tr`, `true`, `uname`, `uniq`, `unlink`, `wc`, `wget`, `which`, `xargs`, `xxd`, `yes`) are mounted into `/bin` and discoverable via `ls /bin` and `which <cmd>`.
  - **Virtual Character Devices (`/dev/null`, `/dev/zero`)**: Pre-mounts `/dev` providing standard virtual devices `/dev/null` and `/dev/zero` for shell stream redirections (e.g. `> /dev/null`, `< /dev/null`) and zero-byte generation without physical VFS memory allocation. Discoverable via `ls /dev`.
  - **Directory Stack**: Full support for `pushd`, `popd`, `dirs`, and `cd -`.
  - **Command Chaining & Pipelines**: Supports `;`, `&&`, `||`, and sequential stream pipelines (`|`).
  - **Stream Redirections**: File input (`<`) and output (`>`, `>>`) across builtins and external binaries.
  - **Direct Script Execution**: Run `./build.sh` or `/workspace/script.sh` directly without requiring explicit `sh` prefix. Shebang (`#!`) and `.sh` scripts are executed automatically.
  - **Interactive EOF (`Ctrl-D`)**: Flushes buffer or signals EOF to input loops (`scanf`, `cin`, `getchar`).
  - **Glob Pattern Expansion**: Expands `*` and `?` wildcards against the VFS file tree (e.g., `ls build/*`, `gcc src/*.c`).
  - **Advanced File Operations**: `mv` and `cp` support directory destinations (`mv a.out src/`), multi-source operands (`mv a.c b.c src/`), atomic file replacement, and recursive directory copying (`cp -r src backup/`).
- **Startup Loading Indication & Deferred Prompt**:
  - `TerminalManager` initializes early during app bootstrap so the `xterm.js` viewport streams real-time informational status during VFS preparation:
    - `[System] Initializing WebAssembly C/C++ environment...`
    - `[*] Mounting virtual filesystem headers...`
    - `[*] Loading workspace from storage...`
    - `[*] Preparing C/C++ standard library sysroot...`
    - `[*] Fetching standard library sysroot archive (sysroot.tar.gz)...`
    - `[*] Unpacking sysroot headers and runtime (<count> items)...`
    - `[*] Preloading runtime libraries (libraylib, libturtle, libsqlite3)...`
    - `[✓] System ready.`
  - Keystrokes and interrupts are guarded during startup to prevent input corruption, and the welcome banner and interactive shell prompt (`ide:~$ `) appear strictly after all VFS items are populated.
- **Unified Terminal Line Editor (`LineEditor`)**:
  - Centralized line-editing subsystem (`src/terminal/line-editor.js`) mediating all interactive text input across the shell and running WebAssembly binaries (`sqlite3`, `scanf`, `fgets`).
  - **Prompt-Safe Relative Redrawing**: Dynamically repositions cursor relative to user buffer and emits suffix clearing (`\x1b[K`), leaving preceding application prompts (`sqlite> `, `ide:~$ `) completely intact during editing and history traversal.
  - **In-Line Navigation & History**: Supports Left/Right arrows, Home/End, Backspace, Delete, Ctrl+A/E, and Ctrl+K/U. Up/Down arrows traverse command history while preserving uncommitted scratch edits.
  - **Contextual History Isolation**: Segregates history stacks by context (`'shell'` vs `'sqlite3'`), keeping bash commands and SQL statements cleanly separated.
- **Transparent Working Directory Preservation**:
  - UI action buttons inject transparent directory stack commands into the terminal:
    - **Compile**: `pushd . && cd /workspace && gcc -Iinclude -Wall -c src/main.c -o build/main.o; popd`
    - **Build**: `pushd . && cd /workspace && make; popd` (or `sh build.sh`)
    - **Run**: `pushd . && cd /workspace && ./a.out; popd` (configurable in Project Settings)
  - Guarantees that the student's shell working directory is preserved even if compilation or execution exits with an error code.

### 3. Clang & LLD WebAssembly Toolchain
- **Modern LLVM 19.1.0 Toolchain**: Powered by real WebAssembly builds of LLVM Clang 19.1.0 and `wasm-ld` 19.1.0 targeting **WASI Preview 1 (`wasm32-wasip1`)**, directly integrated from [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi) and [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi). Toolchain and sysroot assets are downloaded on demand during the build/install lifecycle via `scripts/download-sysroot.js`, keeping the repository clean and free of large binary blobs.
- **Native WebAssembly Section 12 Support**: `wasm-ld` natively parses and links relocatable object files containing Section 12 (`DataCount`) emitted by modern Clang for bulk-memory operations.
- **Sysroot & Standard Libraries**:
  - Bundles standard WASI Preview 1 headers under `/usr/include/`, `/include/wasm32-wasip1/`, `/lib/clang/19/include/`, and standard C++ headers under `/usr/include/` (`<iostream>`, `<vector>`, `<string>`, `<fstream>`).
  - Pre-mounted static runtime archives in `/usr/lib/` and `/lib/wasm32-wasip1/`: `crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libclang_rt.builtins.a`, `libm.a`, `libpthread.a`.
- **Standard Compiler CLI Options & Stages**:
  - **Preprocess Only (`-E`)**: Inspect preprocessed output streamed directly to stdout or saved via `-o <file>` (e.g., `gcc -E main.c > main.i`, `gcc -E main.c | grep foo`).
  - **Assembly Only (`-S`)**: Compile to WebAssembly assembly text (`main.s` or `-o -` for stdout).
  - **Object Compilation (`-c`)**: Compile source files to object files (`main.o`) without invoking the linker.
  - **Macro & Include Directives**: Pass `-D<macro>`, `-U<macro>`, `-I<dir>`, and `-isystem<dir>` flags seamlessly.
  - **Diagnostics & Optimization**: Supports `-O0`, `-O1`, `-O2`, `-O3`, `-Os`, `-Wall`, `-Wextra`, `-Werror`, `-w`, and `-v` verbose diagnostics.
- **Built-in `ar` Archiver**:
  - Full-featured static library archiver mounted at `/usr/bin/ar` and integrated into the shell and `make` (`AR = ar`).
  - Supports `rcs` (create/replace with symbol table index), `t`/`tv` (list contents), `x` (extract), `d` (delete), and `q` (quick append).
  - Generates standard `!<arch>\n` archives with big-endian symbol indices extracted directly from Wasm object `linking` metadata, fully linkable by `wasm-ld` via `-L<dir> -l<name>` or direct archive paths.
- **Multi-File Separate Compilation & Linking**:
  - Separate object generation: `gcc -c src/calc.c -o build/calc.o`
  - Archive creation: `ar rcs build/libcalc.a build/calc.o`
  - Separate linking: `gcc build/main.o -Lbuild -lcalc -o a.out`
- **WebAssembly Shared Objects (`.so`)**:
  - Position-Independent Code: `-fPIC` and `-fpic` flags compile code with position-independent relocation records.
  - Shared library creation: `gcc -shared -fPIC src/math.c -o build/libmath.so` (and `g++ -shared -fPIC ...` for C++) generates standard WebAssembly dynamic libraries with `dylink.0` custom sections.
- **Zero-MemFS Direct VFS Architecture**: `memfs.wasm` is completely eliminated. The unified Platform Host (`src/vfs/wasi-host.js`) directly bridges `llvm-box.wasm` (`clang`, `wasm-ld`, `llvm-ar`) and runtime binaries (`a.out`, `busybox.wasm`) to the application `VFS`, fusing standard WASI Preview 1 POSIX syscalls, in-memory `MemoryPipe` descriptors, and component graphics/audio bridges without double-buffering, memory limits, or intermediate file copying.
- **Dedicated Compiler Web Worker (`compiler.worker.js`)**:
  - Clang, LLD linker, archiver (`ar`), and GNU Make (`make`) execute off the main browser thread in a dedicated, persistent Web Worker managed by `CompilerClient` (`src/toolchain/compiler-client.js`).
  - **Zero UI Freezing**: Large header expansions (such as `raygui.h` in `examples/10_raylib_gui_audio.c`) run entirely in the background without blocking Monaco Editor typing, xterm.js rendering, or floating window interactions.
  - **Streaming Diagnostics & Instant Cancellation**: Compiler stderr/stdout streams in real-time to the terminal. Pressing `Ctrl+C` or clicking Stop terminates the worker immediately, cleanly aborting stuck builds without leaving corrupted state.

### 4. Dual Build Systems (Shell Script & Makefile)
- **Track 1: Shell Script (`build.sh`)**:
  - Generates `/workspace/build.sh` reflecting active compiler flags, include directories, and output binaries.
- **Track 2: Standard Makefile (`Makefile`) & Genuine GNU Make 4.4.1 WASI**:
  - Generates a modular Makefile with `all`, `clean`, and pattern rules (`%.o: %.c`).
  - Integrated with genuine **GNU Make 4.4.1 WASI** (`make-wasi`): delivers complete standard capabilities including automatic variables (`$@`, `$<`, `$^`), pattern rules (`build/%.o: src/%.c`), order-only prerequisites (`|`), conditionals (`ifeq`/`ifneq`), `include` directives, `$(shell ...)` expansions, and incremental builds evaluating nanosecond VFS modification timestamps (`mtime`).
  - Supports standard CLI flags: `-n` (dry-run), `-k` (keep-going), `-C <dir>`, `-f <file>`, `-B` (always rebuild).
- **Project Settings Modal**:
  - Decoupled **Save** and **Generate Build Script** buttons: save configuration and toggle sysroots without clobbering existing files in `/workspace`.
  - Configure language mode, include directories, compiler warning flags, default build track, target binary name, linker flags, and custom Run Command (default: `pushd . && cd /workspace && ./a.out; popd`).
- **Passive System Upgrade**:
  - Accessible via the **System Upgrade** button in the Project Settings modal header.
  - Presents a two-stage confirmation dialog explaining that compiler caches and Service Worker caches will be refreshed while keeping user `/workspace` files completely untouched.
  - Purges the `wasm_cache` IndexedDB and Service Worker `CacheStorage`, then reloads the page to fetch the latest toolchain and runtime assets.

### 5. Execution Sandbox, Synchronous Stdin & In-Code File I/O
- **Dedicated Runtime Web Worker**: User executables run in an isolated WebAssembly execution sandbox with complete WASI Preview 1 filesystem emulation.
- **Synchronous Blocking Input (`scanf` / `cin`)**:
  - Employs `SharedArrayBuffer` and `Atomics.wait()` / `Atomics.notify()`.
  - When the user's C program invokes `scanf("%d", &val)` or `getchar()`, the runtime worker suspends synchronously without locking the main browser UI thread.
  - Characters typed into `xterm.js` are forwarded to the worker via shared memory upon pressing Enter.
- **In-Code Standard File I/O (`fopen` & `fstream`)**:
  - **Standard C File Operations**: Direct in-code file management via `fopen`, `fclose`, `fread`, `fwrite`, `fseek` (`SEEK_SET`, `SEEK_CUR`, `SEEK_END`), `ftell`, `rewind`, `fgetc`, `fputc`, `fgets`, `fputs`, `fprintf`, `fscanf`, `remove`, and `rename`.
  - **All Standard Modes**: Text (`"r"`, `"w"`, `"a"`, `"r+"`, `"w+"`, `"a+"`) and binary (`"rb"`, `"wb"`, `"ab"`, `"r+b"`, `"w+b"`, `"a+b"`).
  - **Standard C++ File Streams**: Mounts `<fstream>` with `std::ofstream`, `std::ifstream`, `std::getline`, and `std::endl`.
  - **Bidirectional VFS Synchronization**: Pre-executes with a complete `/workspace` file tree snapshot; streams live file mutations and deletions back to the host VFS on flush and closure; atomically persists all changes to IndexedDB upon program termination and updates editor tabs and file tree.
  - **Subdirectory Traversal**: Seamlessly creates, opens, reads, and writes nested files in subdirectories (e.g., `fopen("data/nested.txt", "w")`).
- **Execution Interruption**:
  - Pressing `Ctrl+C` in `xterm.js` or clicking the UI **Stop** button terminates the runtime worker immediately, returning control to the shell prompt.

### 6. Unified Graphics Canvas, Vector 2D & Game Engine
- **Modular Architecture (`canvas-wasi`)**:
  - The generic graphics console, HTML5 Canvas 2D vector primitives, window control, input coordination, and WebAssembly host bindings are decoupled into the standalone package [`breeze833/canvas-wasi`](https://github.com/breeze833/canvas-wasi) (powered by [`breeze833/canvas-window`](https://github.com/breeze833/canvas-window)).
- **Framework-Agnostic Display**: Operates independently of any single graphics engine, displaying zero-copy `ImageBitmap` frames on `<canvas id="graphics-canvas">` via `ImageBitmapRenderingContext`.
- **Direct Software Framebuffer C API (`<graphics.h>`)**:
  - Mounted by default in `/usr/include/graphics.h` for all standard C projects with zero external flags or dependencies.
  - Minimal API: `graphics_init(w, h, title)`, `graphics_present(pixels)`, `graphics_present_rgba(rgba, w, h)`, `graphics_wait_frame(fps)`, `graphics_get_mouse(&x, &y, &btn, &wheel)`, `graphics_is_key_down(key)`, `graphics_should_close()`, `graphics_close()`.
  - Enables writing direct pixel software renderers, fractal generators, and retro plasma demos in pure C.
- **Enhanced HTML5 Canvas 2D Vector & Pixel C API (`<graphics_canvas.h>`)**:
  - Direct C bridge to the browser's native `OffscreenCanvas` 2D context (`CanvasRenderingContext2D`).
  - Vector primitives: `canvas_fill_rect`, `canvas_stroke_rect`, `canvas_clear_rect`, `canvas_arc`, `canvas_begin_path`, `canvas_fill`, `canvas_stroke`, `canvas_set_fill_style`, `canvas_set_stroke_style`, `canvas_fill_text`, `canvas_set_font`, `canvas_save`, `canvas_restore`, `canvas_rotate`, `canvas_scale`, `canvas_present`.
  - Pixel manipulation & framebuffer interop: `canvas_get_pixels`, `canvas_put_pixels`, `canvas_get_image_data`, `canvas_put_image_data`, `canvas_get_pixel`, `canvas_set_pixel` for direct pixel-level reading, writing, and 2D image processing filter implementation.
- **Bundled Raylib 5.5 Game Engine, GUI & Web Audio (`raylib-wasi`)**:
  - Full-featured 2D/3D GLES2/WebGL game engine, immediate-mode GUI (`raygui.h`), and pure WASI Web Audio subsystem decoupled into the standalone package [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi) without Emscripten, compiled natively with LLVM 19.
  - Standard C headers (`<raylib.h>`, `<raymath.h>`, `<rlgl.h>`, `<raygui.h>`) and static library archive (`libraylib.a`) are mounted permanently into the sysroot by default.
  - **Web Audio Subsystem**: Pure WASI audio decoders and playback (`InitAudioDevice`, `Sound`, `Wave`, `Music`, `AudioStream`) without POSIX threads, bridged to browser `AudioContext` via `createAudioReceiver` and runtime worker proxying.
  - **Immediate-Mode GUI**: Built-in `raygui.h` support for desktop-style UI widgets (buttons, sliders, toggles, text boxes) compiled natively in C.
  - Zero ad-hoc host dispatchers: WebGL ES 2.0 state machine, handle tables, audio receiver, and Wasm runtime imports (`gl`, `raylib`) are imported directly from `raylib-wasi`.
  - Shares the 512-byte `SharedArrayBuffer` `InputCoordinator` and floating/dockable `GraphicsWindowUI` with `canvas-wasi`.
  - Compiles and links out-of-the-box using standard `-lraylib` linker flag.
- **Synchronous Zero-Copy Frame Delivery**:
  - Prevents microtask starvation during synchronous WebAssembly execution loops (`while (!graphics_should_close())`).
  - Invokes `offscreen2d.transferToImageBitmap()`, creating an `ImageBitmap` **synchronously** without Promise delays and posting it directly to the UI thread via `postMessage({ type: 'frame', bitmap }, [bitmap])`.
  - Features transferable ArrayBuffer fallback (`frame_buffer`) for universal browser compatibility.
- **Dedicated Floating & Pop-Out Canvas Window**:
  - Floating, draggable, resizable window (`#graphics-canvas`) running alongside `xterm.js`.
  - Dynamic resolution adaptation based on `graphics_init(width, height, title)` or `InitWindow(width, height, title)`.
  - Real-time FPS counter and resolution badge.
  - Pop-Out (`↗`) to external browser window (`#graphics-popup-canvas`) with auto-focus and keyboard capturing (`windowTarget`), and clean Dock (`↙`) back.
  - **Background Frame Activity Indicator**:
    - The `[🎮 Canvas]` toolbar button is permanently accessible in the top header.
    - When new frames render while the window is closed or minimized, the canvas button activates a pulsating green indicator dot and tooltip alert (`Canvas (New frames rendering in background - Click to show)`), notifying the user without forcefully popping up or occluding terminal inspection.
    - Automatically clears when the user opens the window, un-minimizes the window, or when process execution terminates.
- **Dual-Channel Input Coordination**:
  - Zero-latency 512-byte `SharedArrayBuffer` tracking mouse position, buttons, wheel, and keys with safe `DataView` byte alignment. Clean hover coordinates (`-1, -1`) on mouse leave.
  - Event stream message fallback for decoupled or non-isolated environments.

### 7. Turtle Graphics Subsystem (`libturtle`)
- **Modular Educational Turtle Architecture**:
  - Decouples high-level geometric navigation logic from rasterization backends using the Hardware Abstraction Layer (HAL) specified in [`breeze833/libturtle`](https://github.com/breeze833/libturtle).
  - **Mathematical Cartesian Coordinates**:
    - Viewport center is $(0.0, 0.0)$.
    - $+X$ points East (Right), $+Y$ points North (Up).
    - Default heading is $90.0^\circ$ (pointing North).
    - Rotation angles follow standard mathematical conventions: counter-clockwise (CCW) is positive.
    - Double-precision coordinates and angles prevent cumulative floating-point drift.
  - **32-Bit RGBA Colors & Standard Palette**: Packed `0xRRGGBBAA` values and palette macros (`TURTLE_BLACK`, `TURTLE_RED`, `TURTLE_GREEN`, `TURTLE_BLUE`, `TURTLE_YELLOW`, `TURTLE_MAGENTA`, `TURTLE_CYAN`, `TURTLE_WHITE`).
  - **Progressive Animation & Stylized Turtle Cursor**: Frame animation via `turtle_delay(ms)` and an animated visual turtle cursor with carapace, flippers, head, and eyes, rendered non-destructively over canvas artwork.
- **Dual Backend Integration**:
  1. **Canvas-WASI Backend (`libturtle.a` / `libturtle_canvas-wasi.a`)**:
     - **Enabled by Default**: Mounted out of the box in the sysroot (`/usr/include/turtle.h`, `/usr/include/turtle_backend_canvas_wasi.h`, `/usr/lib/libturtle.a`, `/usr/lib/libturtle_canvas-wasi.a`).
     - Links directly with `-lturtle` (e.g. `gcc main.c -lturtle`) with zero additional flags or setup.
     - Driven by native `OffscreenCanvas` 2D context via the `canvas-wasi` bridge.
  2. **Raylib Backend (`libturtle_raylib.a`)**:
     - **Enabled by Default**: Mounted permanently in sysroot alongside canvas-wasi (`/usr/include/turtle_backend_raylib.h`, `/usr/lib/libturtle_raylib.a`).
     - Links directly with `-lturtle_raylib -lraylib`.
- **Link-Time Backend Resolution**:
  - The public `turtle_begin(ctx)` macro expands to `(<backend>_turtle_init(ctx) && turtle_begin_core())` provided by `<turtle_backend_canvas_wasi.h>` or `<turtle_backend_raylib.h>`, ensuring compile/link failures if a program links against the incorrect backend archive.
- **Automated In-Tree Asset Compilation**:
  - `scripts/download-sysroot.js` clones `libturtle` into `build/libturtle` and uses the in-tree WebAssembly toolchain (`llvm-box.wasm` + `ar.js`) to compile both WebAssembly static archives with zero host compiler dependencies (`clang`, `llvm-ar`, or `make`).
  - Copies user headers to `public/sysroot/include/turtle/` and auto-generates `src/vfs/turtle-headers.js` to ensure zero drift between physical headers and the in-browser virtual sysroot.
- **Standard Linker Flag Specification**:
  - Linker flags are explicitly configured in the Project Settings Linker Flags field or passed on the terminal CLI:
    - Turtle with Canvas-WASI: `-lturtle`
    - Turtle with Raylib: `-lturtle_raylib -lraylib`
    - Standalone Raylib: `-lraylib`

### 8. SQLite 3 Embedded Database & CLI Subsystem (`sqlite-wasi`)
- **Embedded C Engine**: Zero-dependency SQLite 3 (v3.54.1) targeting `wasm32-wasip1` integrated from [`breeze833/sqlite-wasi`](https://github.com/breeze833/sqlite-wasi).
- **Sysroot Mounting & C Linkage**:
  - Headers (`<sqlite3.h>`, `<sqlite3ext.h>`) and static library `libsqlite3.a` are bundled out of the box in `/usr/include/` and `/usr/lib/`.
  - User C programs compile and link cleanly with standard `-lsqlite3` without additional flags or host bridges.
- **Standalone Interactive CLI Tool (`/usr/bin/sqlite3`)**:
  - `sqlite3.wasm` mounted at `/usr/bin/sqlite3`, executable directly in the terminal against memory databases (`:memory:`) or `/workspace/*.db`.
  - Full interoperation with shell stream redirection (`<`, `>`, `>>`) and command pipelines (`|`).
  - Interactive SQL prompt (`sqlite> `) featuring arrow-key in-line navigation, cursor positioning, and query history recall powered by `LineEditor`.
- **Bidirectional Database Persistence**:
  - SQLite database files created or modified in `/workspace` synchronize directly to the host VFS in real time and persist to IndexedDB.

### 9. Interactive Educational Examples Suite
The repository includes a ready-to-run suite of single-file C programs in the `examples/` directory for manual testing and pedagogical demonstration:
- **`01_stdio.c`**: Interactive console standard I/O (menu navigation, Fibonacci generator, Factorial, Prime tester) configured with unbuffered stdout (`setbuf(stdout, NULL)`) and prompt flushing (`fflush(stdout)`).
- **`02_raylib_interactive.c`**: Raylib 5.5 GLES2 interactive demo with mouse position tracking, bouncing balls on mouse click, and keyboard-controlled box movement.
- **`03_framebuffer_graphics.c`**: Pure C direct software framebuffer (`<graphics.h>`) rendering a 60 FPS procedural plasma via a 512-entry sine lookup table, glowing hover cursor dot, persistent white paint strokes layer on click/drag, and 'C'/Space canvas clearing.
- **`04_canvas_vector.c`**: HTML5 2D vector canvas demo (`<graphics_canvas.h>`) rendering anti-aliased geometry, orbiting shapes with matrix transformations (`canvas_rotate`, `canvas_scale`), drop shadows, and typography.
- **`05_canvas_pixels.c`**: HTML5 Canvas 2D pixel manipulation & image processing demo (`<graphics_canvas.h>`) combining vector scene underlay with direct pixel access and 2D spatial convolution filters in pure C (Sobel edge detection gradient filter, 3x3 box blur, grayscale & contrast adjustment, color inversion, and interactive mouse spotlight lens).
- **`06_turtle_canvas.c`**: Progressive turtle graphics demo using the default canvas-wasi backend (`<turtle.h>`, `<turtle_backend_canvas_wasi.h>`) drawing a multi-colored animated star spiral with stylized turtle cursor.
- **`07_turtle_raylib.c`**: Progressive turtle graphics demo using the Raylib backend (`<turtle.h>`, `<turtle_backend_raylib.h>`) drawing a geometric rosette pattern.
- **`08_ansi_terminal.c`**: Comprehensive ANSI VT100 screen control, cursor positioning, color rendering, and progress animation demo in pure C using UTF-8 box characters and POSIX `nanosleep()` frame timing.
- **`09_sqlite_database.c`**: Relational database operations in pure C using embedded SQLite 3 (`<sqlite3.h>`), creating tables, inserting with parameterized statements, formatted record queries, aggregations, and inspecting generated databases using the `sqlite3` CLI tool.
- **`10_raylib_gui_audio.c`**: Comprehensive Raylib 5.5 demo integrating immediate-mode GUI (`raygui.h`), procedural Web Audio synthesis (`InitAudioDevice`, `LoadSoundFromWave`, `PlaySound`), 16-band frequency equalizer animation with falling peak caps, and interactive shockwave ripples.
- **`examples/README.md`**: Step-by-step user compilation and running guide for each example.

### 10. Virtual File System & Storage
- **In-Memory VFS**: Fast hierarchical tree representation shared across the editor, shell, toolchain, and runtime execution worker.
- **IndexedDB Persistence**: Automatically persists `/workspace` across browser sessions and page refreshes.
- **Bidirectional Runtime Synchronization**: Changes made to `/workspace` files via C/C++ `fopen`/`fwrite`/`fputs`, C++ `<fstream>`, or SQLite 3 `sqlite3_open`/`sqlite3_step` automatically sync back to VFS in real-time and persist to IndexedDB, updating the file tree and editor tabs.
- **Zip Import & Export**: One-click export of `/workspace` into a standard `.zip` file using JSZip, and direct zip unpacking into the workspace.
- **Sysroot & Device Protection**: Read-only protection on system root paths (`/usr`, `/bin`, `/dev`), pre-mounting standard C/C++ headers (`<stdio.h>`, `<stdlib.h>`, `<iostream>`, `<fstream>`, etc.), `<graphics.h>`, `<graphics_canvas.h>`, `<turtle.h>`, `<raylib.h>`, `<sqlite3.h>`, `<sqlite3ext.h>`, runtime static libraries (`libc.a`, `libturtle.a`, `libraylib.a`, `libturtle_raylib.a`, and `libsqlite3.a`), CLI tools (`/usr/bin/sqlite3`), all 70+ BusyBox applets (`/bin/*`), and virtual character devices (`/dev/null`, `/dev/zero`).

### 11. Progressive Web App (PWA) & Offline Execution
- **Installable Desktop/Mobile App**: Certified PWA with Web App Manifest (`manifest.webmanifest`), dark theme colors, and icons.
- **In-App Install Prompt**: Automatically reveals an **Install** button in the header toolbar when the browser detects installability.
- **100% Offline Capability**:
  - Unified Service Worker caches App Shell, fonts, editor modules, WebAssembly compiler binaries (`llvm-box.wasm`, `sysroot.tar.gz`), Raylib assets, and Turtle static archives.
  - Seamless offline execution with retained `COOP: same-origin` and `COEP: require-corp` isolation headers so `SharedArrayBuffer` remains operational without an internet connection.
  - Automatic connection status notifications when transitioning between online and offline modes.

### 12. Integrated API Reference & Documentation Subsystem
- **In-IDE Slide-Out Reference Drawer**:
  - Toggled via the **Reference** toolbar button (`#btn-reference`) or keyboard shortcuts (<kbd>Ctrl+Shift+H</kbd> / <kbd>F1</kbd>) without occluding editor code or disrupting active terminal output.
  - **5 Specialized Documentation Tabs**:
    1. **General C Libc & WASI Restrictions**: Clear explanations of sandboxed WASI Preview 1 limits (no `fork`/`exec`, no raw BSD sockets, single-threaded execution, in-memory VFS) and standard idiomatic alternatives (POSIX shell pipelines, `poll_oneoff` synchronous sleeping via `SharedArrayBuffer` `Atomics.wait`).
    2. **Turtle Graphics (`<turtle.h>`)**: Full Cartesian coordinate diagrams, animation pacing (`turtle_delay`), complete lifecycle, motion, pen, and state inspection functions with required linker flags (`-lturtle`, `-lturtle_raylib -lraylib`).
    3. **Canvas 2D & Direct Software Framebuffer (`<graphics.h>`, `<graphics_canvas.h>`)**: Complete 32-bit `0xAABBGGRR` framebuffer presentation, synchronous input queries, HTML5 2D vector primitives, path construction, text rendering, and pixel-level image processing.
    4. **Raylib 5.5 WASI (`<raylib.h>`)**: Subsystem compatibility matrix (GLES2 WebGL, Web Audio, `raygui.h`), starter template, and link to the official cheatsheet.
    5. **SQLite 3 WASI (`<sqlite3.h>`)**: Transient in-memory databases (`:memory:`), persistent VFS files (`/workspace/*.db`), core C statement preparation and query execution, and terminal interactive CLI syntax.
  - **Real-Time Search Filter**: Rapidly filters API functions, concepts, and keywords across the active tab.
  - **1-Click Pedagogical Example Loading**: Seamlessly loads starter templates (`01_stdio.c` through `10_raylib_gui_audio.c`) into Monaco editor tabs and the workspace file tree.
- **Monaco Hover & Autocomplete Tooltips**:
  - Custom Monaco hover provider (`src/editor/hover-provider.js`) parsing function declarations and parameter documentation for custom sysroot headers (`<turtle.h>`, `<graphics.h>`, `<graphics_canvas.h>`), providing contextual IntelliSense tooltips during editing.
- **Standalone User Documentation Portal (`ide-docs/` -> `dist/docs/`)**:
  - Fully static, multi-page reference site compiled into `dist/docs/` and `public/docs/` via `npm run docs:build`.
  - Zero-dependency client-side syntax highlighter (`highlighter.js`) with pre-rendered tokens for zero-FOUC rendering.
  - Fully resilient to any deployment path (domain root `/`, subpath `/ide/`, or GitHub Pages `/<repo>/`) with relative links and 1-click launch buttons returning directly to the playground.

---

## Getting Started & Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18.0.0 or higher recommended)
- `npm` (bundled with Node.js)

### Installation
Clone the repository and install development dependencies:

```bash
git clone https://github.com/your-username/wasm-c-ide.git
cd wasm-c-ide
npm install
```

> **Note**: `npm install` triggers a `postinstall` hook that automatically runs `scripts/download-sysroot.js`, downloading the required LLVM 19 WASI single multicall binary (`llvm-box.wasm`, `sysroot.tar.gz`), Raylib 5.5 assets, SQLite 3 WASI assets (`libsqlite3.a`, `sqlite3.wasm`, `sqlite3.h`), and prebuilding `libturtle` static libraries (`libturtle.a`, `libturtle_canvas-wasi.a`, `libturtle_raylib.a`) from upstream GitHub releases into `public/sysroot/`. You can also manually trigger this download anytime with `npm run download:sysroot`.

### Development Server
Start the local Vite development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:5173`.

> **Note**: Vite is configured with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` HTTP headers to enable `SharedArrayBuffer` support out of the box during development. Additionally, the custom `emulate-production-sysroot` Vite plugin serves `/sysroot/wasm/` static assets as raw `application/octet-stream` with immutable caching headers, eliminating local dev server gzip double-handling and matching production streaming behavior.

### Running Tests
Execute the full unit test suite (covering all 22 test suites: VFS, Shell parser, Toolchain driver, Static Archiver, Runtime Atomics, Make engine, PWA Service Worker, Zoom controls, Pipelines & Redirections, Raylib graphics, Generic Graphics / Canvas 2D, Shared Objects, Turtle Graphics, In-Code File I/O, Detached Terminal & ANSI, Collapsible & Resizable Sidebar, SQLite 3 WASI, Unified Terminal LineEditor, Project Settings & Passive Upgrade, Startup Loading Indication, Compiler Worker, and Reference Drawer & Documentation Portal):

```bash
npm test
```

### Production Build
Compile the production-ready static assets:

```bash
npm run build
```

The compiled static files will be generated in the `dist/` directory. You can preview the production bundle locally with:

```bash
npm run preview
```

---

## Deployment

Because the application is 100% static, the contents of the `dist/` directory can be deployed to any static web hosting provider.

### Cross-Origin Isolation & Security Requirements
`SharedArrayBuffer` (which powers the synchronous blocking `scanf()` runtime IO) requires modern browsers to operate in a **Cross-Origin Isolated** environment. The following HTTP response headers must be sent:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For hosting environments that do not allow configuring custom response headers (e.g. GitHub Pages), the project automatically includes `coi-serviceworker.js` in `public/` which transparently enables cross-origin isolation via a Service Worker.

---

### GitHub Pages

The repository includes a GitHub Actions workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) that automatically runs tests, builds the production bundle, and deploys to GitHub Pages whenever you push to the `main` branch.

#### One-Time Setup in GitHub:
1. Go to your repository on GitHub: `https://github.com/<owner>/<repo>/settings/pages`
2. Under **Build and deployment** > **Source**, select **GitHub Actions** (instead of *Deploy from a branch*).
3. Push to `main` (or click **Run workflow** under the **Actions** tab).

The application will be live at `https://<owner>.github.io/<repo>/`! Because the build uses relative asset resolution, sub-path hosting on GitHub Pages works out-of-the-box, and `coi-serviceworker.js` provides cross-origin isolation (COOP/COEP) and offline PWA caching automatically.

### Direct Zip Download & GitHub Releases

On every push to `main`, the GitHub Actions workflow automatically packages the production `dist/` directory into a portable zip archive and publishes it to the repository's **Latest Release**:

- **Direct Download**: Download [`wasm-c-ide.zip`](https://github.com/breeze833/wasm-c-ide/releases/latest/download/wasm-c-ide.zip) from the GitHub Releases page.
- **Local Packaging**: You can also package the zip archive locally at any time:
  ```bash
  npm run pack
  ```
  This builds the bundle and outputs `wasm-c-ide.zip` in the repository root. Extracting its contents directly into any static web server document root runs the full IDE offline with no installation or Node.js runtime required.

### Nginx

Configure your Nginx server block to serve the `dist/` folder with the necessary isolation headers:

```nginx
server {
    listen 80;
    server_name ide.example.com;
    root /var/www/wasm-c-ide/dist;
    index index.html;

    # Root deployment
    location / {
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        try_files $uri $uri/ /index.html;
    }

    # Ensure WebAssembly MIME types are set
    types {
        application/wasm wasm;
    }
}
```

#### Sub-Path Deployment (e.g. `https://myhost/cpp-ide/`)

The application supports sub-path hosting out-of-the-box using relative asset resolution. You can build with default relative paths (`./`) or an explicit `BASE_URL`:

```bash
# Relative paths (default)
npm run build

# Or with an explicit sub-path:
BASE_URL=/cpp-ide/ npm run build
```

Nginx configuration for sub-path hosting:

```nginx
server {
    listen 80;
    server_name myhost;

    location /cpp-ide/ {
        alias /var/www/wasm-c-ide/dist/;
        index index.html;
        try_files $uri $uri/ /cpp-ide/index.html;

        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
    }

    types {
        application/wasm wasm;
    }
}
```

### Caddy

Add the headers in your `Caddyfile`:

```caddy
ide.example.com {
    root * /var/www/wasm-c-ide/dist
    file_server

    header {
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Embedder-Policy "require-corp"
    }

    try_files {path} /index.html
}
```

### Cloudflare Pages / Vercel

Add a `_headers` file to `public/` (or configure in dashboard):

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

---

## Documentation & Technical Guides

- [**`SPEC.md`**](./SPEC.md): Technical specification and architectural ground truth defining the unified VFS host, toolchain integration, and windowing system.
- [**`ide-docs/` (API Documentation Portal)**](./ide-docs/index.html): Public API documentation portal and cheatsheet covering Libc/WASI limits, Turtle graphics, Canvas 2D, Raylib, and SQLite 3.
- [**`docs/KNOWN_ISSUES.md`**](./docs/KNOWN_ISSUES.md): Documented version gaps, limits, and runtime constraints.
- [**`docs/SINGLE_THREAD_FRAME_PACING.md`**](./docs/SINGLE_THREAD_FRAME_PACING.md): Case study on single-threaded WebAssembly graphics, progressive animation pacing, and mathematical derivation of frame cadence metrics.
- [**`AGENTS.md`**](./AGENTS.md): Autonomous agent engineering guidelines, milestone tracking, and verification checklists.
- [**`examples/README.md`**](./examples/README.md): Comprehensive compilation and execution guide for all 10 bundled educational examples.

---

## License

This project is licensed under the [MIT License](LICENSE).
