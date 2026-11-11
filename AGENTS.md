# AGENTS.md: Development & Operational Guidelines for AI Agents

## 1. Role & Operating Principles
You are an autonomous senior systems and web engineer implementing the project specified in `SPEC.md`.

### Core Rules:
1. **Strict Specification Alignment**: `SPEC.md` is the ground truth. Do not deviate, substitute architectures, or remove constraints without explicit instructions.
2. **Document-Driven Engineering**: If a design flaw, platform limitation, or bug requires architectural adjustments, update `SPEC.md` first with detailed rationale, then implement the code.
3. **No Hidden Bridges**: Keep the compilation and build process transparent. UI buttons must paste terminal commands into `xterm.js` rather than invoking internal JS bindings directly.
4. **Pedagogical Integrity**:
   - Never auto-save dirty files on build.
   - Enforce `-pedantic-errors` in Pure C mode.
   - Keep the workspace directory clean and visible so students understand object and binary generation.

---

## 2. Directory Structure & Conventions

```
/
├── SPEC.md                    # Technical specification & architectural ground truth
├── AGENTS.md                  # Agent operating protocols (this file)
├── README.md                  # User-facing project documentation & deployment guides
├── docs/                      # Project documentation and technical specifications
│   ├── SHARED_SYSROOT_VFS.md  # Specification for Two-Tier Overlay VFS and SharedSysroot binary format
│   ├── DEDICATED_COMPILER_WORKER.md # Case study on off-thread compilation worker & tri-worker architecture
│   ├── SHELL_AND_UTILITIES.md # Specification for BusyBox ash shell, wasi_host_spawn, GNU Make, and SQLite
│   ├── GRAPHICS_AND_TURTLE.md # Specification for canvas-wasi, raylib-wasi, and libturtle subsystems
│   ├── TERMINAL_AND_UI.md     # Specification for detached terminal, LineEditor, and workspace UI
│   ├── SINGLE_THREAD_FRAME_PACING.md # Case study on single-threaded WebAssembly graphics & progressive delays
│   ├── KNOWN_ISSUES.md        # Documented toolchain version gaps, limits, and single-threaded frame pacing
│   └── archived/              # Historical technical specifications (v1 baseline through v4)
│       ├── SPECv1.md
│       ├── SPECv2.md
│       ├── SPECv3.md
│       └── SPECv4.md
├── ide-docs/                  # Standalone public API documentation portal source
│   ├── index.html             # Documentation portal home & quick start
│   ├── libc-wasi.html         # General C Libc & WASI Preview 1 restrictions guide
│   ├── turtle.html            # Turtle graphics API reference (<turtle.h>)
│   ├── canvas.html            # Canvas 2D & Direct Software Framebuffer reference
│   ├── raylib.html            # Raylib 5.5 WASI reference (<raylib.h>)
│   ├── sqlite.html            # SQLite 3 WASI reference (<sqlite3.h>)
│   ├── highlighter.js         # Zero-dependency client-side syntax highlighter
│   └── style.css              # Responsive dark theme documentation styling
├── examples/                  # Bundled pedagogical single-file C examples & guide
│   ├── 01_stdio.c             # Standard I/O console menu demo
│   ├── 02_raylib_interactive.c # Interactive Raylib 5.5 GLES2 graphics demo
│   ├── 03_framebuffer_graphics.c # Direct software framebuffer procedural plasma demo
│   ├── 04_canvas_vector.c     # HTML5 Canvas 2D vector primitives demo
│   ├── 05_canvas_pixels.c     # Canvas 2D pixel manipulation & image processing demo
│   ├── 06_turtle_canvas.c     # Turtle graphics animated star spiral (canvas-wasi backend)
│   ├── 07_turtle_raylib.c     # Turtle graphics geometric rosette (Raylib backend)
│   ├── 08_ansi_terminal.c     # Comprehensive ANSI VT100 screen control & TUI demo
│   ├── 09_sqlite_database.c   # Relational database operations in pure C via SQLite 3
│   ├── 10_raylib_gui_audio.c  # Interactive Raylib immediate-mode GUI, animation & Web Audio synthesizer
│   └── README.md              # Examples compilation & execution guide
├── index.html                 # Main entry point (loads /coi-serviceworker.js)
├── package.json               # Development tooling, dependencies, and test scripts
├── vite.config.js             # Vite configuration (COOP/COEP headers, workers, wasm support)
├── scripts/
│   ├── build-docs.js          # API docs builder compiling ide-docs/ into dist/docs/ and public/docs/
│   └── download-sysroot.js    # Automated LLVM 19, Raylib WASI & libturtle asset downloader and unpacker
├── src/
│   ├── main.js                # App bootstrap, DOM layout, and UI event binding
│   ├── style.css              # Dark theme styling, button color hierarchy, tooltips
│   ├── components/
│   │   ├── examples-data.js   # Embedded offline pedagogical C examples for 1-click loading
│   │   ├── filetree.js        # File tree sidebar, directory expansion, file operations
│   │   ├── reference.js       # In-IDE slide-out right Reference Drawer & cheatsheet tabs
│   │   ├── settings.js        # Project settings modal with decoupled Save and Generate buttons
│   │   └── toast.js           # Non-blocking notification toasts
│   ├── editor/
│   │   ├── editor.js          # Monaco editor instance controller and save actions
│   │   ├── hover-provider.js  # Monaco hover & autocomplete provider for custom headers
│   │   ├── monaco-setup.js    # Monaco worker environment setup
│   │   └── tabs.js            # Tab bar manager and dirty mark (*) tracking
│   ├── terminal/
│   │   ├── line-editor.js     # Unified terminal line-editing engine with relative prompt-safe cursor redrawing
│   │   ├── terminal.js        # xterm.js wrapper and command injection bridge
│   │   └── runtime.js         # Host-side runtime manager and SharedArrayBuffer coordinator
│   ├── toolchain/
│   │   ├── ar.js              # POSIX ar static library archiver and wasm object symbol extractor
│   │   ├── compiler-client.js # Host-side manager and differential VFS sync for compiler worker
│   │   ├── driver.js          # gcc / clang command parser and execution coordinator
│   │   ├── make.js            # Incremental Makefile runner evaluating mtimes
│   │   ├── tar.js             # Sysroot tarball extractor
│   │   ├── wasm-cache.js      # IndexedDB persistent binary cache for compiled WebAssembly modules
│   │   └── wasm-clang.js      # LLVM multicall, streaming compiler, and direct VFS driver
│   ├── vfs/
│   │   ├── archive.js         # JSZip project export and import routines
│   │   ├── shared-sysroot.js  # Shared read-only sysroot binary builder, reader, and FNV-1a index
│   │   ├── storage.js         # IndexedDB synchronization and default project seed
│   │   ├── sysroot.js         # Standard C/C++ sysroot header and binary mount definitions
│   │   ├── vfs.js             # In-memory virtual filesystem with path normalization
│   │   └── wasi-host.js       # Unified Platform Host fusing WASI Preview 1, MemoryPipe, and component bridges
│   └── workers/
│       ├── compiler.worker.js # Dedicated Web Worker executing Clang, LLD, ar, and make
│       ├── runtime.worker.js  # WASI host executing user binaries with Atomics stdin & OffscreenCanvas
│       └── shell.worker.js    # Interactive POSIX shell worker (pushd/popd, globs, mv/cp, direct scripts)
├── public/
│   ├── coi-serviceworker.js   # Unified cross-origin isolation and CacheStorage offline worker
│   ├── manifest.webmanifest   # Web App Manifest for PWA installation
│   ├── icons/                 # PWA application icons (192, 512, svg)
│   └── sysroot/               # Downloaded on-demand via scripts/download-sysroot.js (git-ignored)
│       ├── wasm/              # Prebuilt llvm-box.wasm, libraylib.a, libturtle.a, libturtle_raylib.a, libsqlite3.a, sqlite3.wasm, sysroot.tar.gz
│       └── include/           # Minimal fallback libc headers, raylib headers & turtle headers
└── test/
    ├── ar.test.js             # Static archiver creation, extraction, table, and wasm-ld linkage tests
    ├── compiler-worker.test.js # Dedicated compiler worker, CompilerClient, and off-thread execution tests
    ├── detached-terminal.test.js # Detached floating terminal mode (80x24), snapping, and ANSI tests
    ├── fileio.test.js         # In-code standard C/C++ file I/O, fopen modes, seeking, and fstream tests
    ├── graphics.test.js       # Generic framebuffer, 2D vector, and pixel manipulation tests
    ├── line-editor.test.js    # Unified LineEditor cursor navigation, history recall, and prompt safety tests
    ├── make.test.js           # Makefile parsing and incremental build tests
    ├── pipeline.test.js       # Command pipeline (|) and file redirection (<, >, >>) tests
    ├── raylib.test.js         # Raylib graphics compilation, input sync, and canvas UI tests
    ├── reference-drawer.test.js # In-IDE Reference Drawer, Monaco hover tooltips, and public docs tests
    ├── runtime.test.js        # SharedArrayBuffer Atomics protocol and Ctrl-D EOF tests
    ├── settings-upgrade.test.js # Project Settings save/generate decoupling and passive upgrade tests
    ├── shell.test.js          # Shell argument parsing, globs, pushd/popd, mv/cp, and direct scripts
    ├── sidebar.test.js        # Collapsible slim rail, horizontal resizer, and shortcut tests
    ├── so.test.js             # WebAssembly shared object (.so) compilation, linking, and runtime execution tests
    ├── sqlite.test.js         # SQLite 3 C library compilation, linking, CLI execution, and VFS tests
    ├── startup.test.js        # Startup loading indication, VFS population lifecycle, and prompt tests
    ├── sw.test.js             # Service Worker, PWA manifest, and offline COOP/COEP tests
    ├── toolchain.test.js      # Toolchain driver, MemFS directory, unlink guardrails, and libc tests
    ├── turtle.test.js         # Turtle graphics compilation, backend switching, and asset unmounting tests
    ├── vfs.test.js            # VFS hierarchy, permissions, and zip round-trip tests
    └── zoom.test.js           # Editor & terminal font zoom, clamping, and persistence tests
```

---

## 3. Step-by-Step Implementation Roadmap

Agents executing this project should proceed milestone-by-milestone:

### Milestone 1: Environment & Static Sandbox Setup
- Set up Vite project configured with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- Integrate `coi-serviceworker.js` to verify isolation works in static preview environments.
- Verify `window.crossOriginIsolated === true`.

### Milestone 2: VFS & File Management Layer
- Implement in-memory VFS abstraction representing files and directories.
- Connect persistence to IndexedDB to survive page refreshes.
- Build Import/Export routines:
  - Export: Generate `.zip` from `/workspace` using JSZip.
  - Import: Unpack `.zip` into `/workspace`.
- Mount `/usr/include` containing minimal standard C headers (`stdio.h`, `stdlib.h`, `string.h`, `math.h`).

### Milestone 3: Editor & Workspace UI
- Mount Monaco / CodeMirror editor with file tab switching.
- Implement Dirty State tracking:
  - Add dirty mark on tab when content differs from VFS.
  - Bind `Ctrl+S` / `Cmd+S` to write buffer into VFS and clear dirty mark.
  - Display non-blocking warning notification if compile/build is clicked while dirty.

### Milestone 4: Terminal, BusyBox & Command Bridging
- Set up `xterm.js` and connect it via Web Worker to BusyBox-wasi.
- Implement UI-to-Terminal command bridge:
  - Create helper `terminal.injectCommand(cmd: string)` that appends `\r\n` and dispatches keys into xterm input stream.
- Test basic CLI commands (`ls`, `pwd`, `cat`).

### Milestone 5: Clang/LLD Wasm Toolchain Integration
- Integrate `clang.wasm` and `wasm-ld.wasm`.
- Route `gcc` command in BusyBox or shell dispatcher to invoke Clang/LLD against VFS.
- Implement language modes:
  - Pure C: Force `-x c -std=c11 -pedantic-errors`.
  - C++: Force `-x c++ -std=c++17`.
- Validate multi-file compilation:
  - `gcc -c src/a.c -o build/a.o`
  - `gcc -c src/b.c -o build/b.o`
  - `gcc build/a.o build/b.o -o a.out`

### Milestone 6: Execution Runtime & Synchronous Stdin
- Implement `runtime.worker.js` for executing generated `a.out`.
- Implement `Atomics.wait` on `SharedArrayBuffer` for synchronous `scanf` / `cin` handling:
  - Shell/Runtime requests stdin input $\to$ terminal captures characters $\to$ `Atomics.notify` resumes runtime worker.
- Implement execution timeout and explicit process cancellation (`Ctrl+C` / UI Stop button).

### Milestone 7: Build Systems (Shell Script & Makefile)
- Create Project Settings panel:
  - Track include paths, source files, compiler flags, and target name.
- Generate `/workspace/build.sh` reflecting settings.
- Generate `/workspace/Makefile` and integrate lightweight `make.wasm`.
- Link UI "Build" button to inject either `sh build.sh` or `make`.

### Milestone 8: Usability Enhancements, Sub-Path Hosting & Production Packaging
- Implement independent pane font zoom controls (+, -, reset label) and shortcuts (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`) for Monaco and xterm.js with clamping (9px–36px) and `localStorage` persistence.
- Implement seamless sub-path deployment (`base: process.env.BASE_URL || './'`) and relative asset paths for manifest, icons, service worker, and Wasm assets.
- Refactor toolchain compilation to use async `WebAssembly.instantiate` / `compile` bypassing the 8MB main-thread limit.
- Set up PWA Web App Manifest, in-app install prompt (`beforeinstallprompt`), and Cache-First offline caching in `coi-serviceworker.js`.
- Implement production packaging (`npm run pack` generating `wasm-c-ide.zip`) and GitHub Actions CI/CD workflow for automated tests, GitHub Pages deployment, and GitHub Releases publication.

### Milestone 9: Advanced Shell Pipelines, Stream Redirections & EOF Handling
- Implement pipeline execution (`|`) with sequential buffer staging connecting stages.
- Implement stream redirections (`<`, `>`, `>>`) for built-in utilities and external binaries.
- Implement `Ctrl-D` (`\x04`) handling in `RuntimeManager` sending `STATE_EOF` via `SharedArrayBuffer` for clean EOF in `scanf`, `cin`, and `getchar`.
- Support preloaded `stdinBytes` in `runtime.worker.js` for synchronous stream feeding without `Atomics.wait`.
- Support direct shell script execution (`./build.sh`, `/workspace/script.sh`) in `shell.worker.js` and validate executable Wasm magic headers (`\0asm`) in `main.js`.

### Milestone 10: Unified Graphics Subsystem (canvas-wasi, Raylib 5.5) & Dual Console Integration
- Decouple generic graphics console, HTML5 Canvas 2D vector primitives, window control, input coordination, and WebAssembly host bindings into modular package [`breeze833/canvas-wasi`](https://github.com/breeze833/canvas-wasi).
- Mount direct software framebuffer C API (`<graphics.h>`) by default in sysroot for writing software renderers and procedural visual demos in pure C without external dependencies.
- Mount enhanced HTML5 Canvas 2D vector & pixel manipulation C API (`<graphics_canvas.h>`) for vector drawing and 2D spatial convolution filters (Sobel edge detection, blur, grayscale, inversion).
- Integrate Raylib 5.5 WASI static library (`libraylib.a`) and headers (`raylib.h`, `raymath.h`, `rlgl.h`) bundled permanently in sysroot.
- Implement dual-thread rendering: offscreen WebGL / 2D canvas in `runtime.worker.js` transferring zero-copy GPU `ImageBitmap` frames to main thread `<canvas id="graphics-canvas">`.
- Synchronous zero-copy frame delivery: `transferToImageBitmap()` generates `ImageBitmap` synchronously without Promise delays, with transferable `frame_buffer` fallback.
- Implement frame pacing with `Atomics.wait()` in `graphics_wait_frame` / `EndDrawing()` based on target FPS.
- Implement `GraphicsWindowUI` draggable/resizable floating window, pop-out to separate browser window (`window.open`), dock back, dynamic dimension adaptation to `graphics_init()` / `InitWindow()`, dimension preservation across window toggles, and pulsating background frame activity indicator on `[🎮 Canvas]` toolbar button.
- Implement 512-byte `SharedArrayBuffer` keyboard and mouse input coordination with clean focus/blur lifecycle resets and safe `DataView` little-endian alignment.
- Decouple Project Settings modal into dedicated **Save** (state & sysroot mounting) and **Generate Build Script** (`build.sh` & `Makefile` generation) actions.
- Enforce MemFS unlinking invariants: always truncate files to 0 bytes before unlinking (`AddFileNode(len, 0)` then `path_unlink_file`) in `MemFS.removeFile()` to conceal the inode reallocation offset bug and ensure clean recompilation.

### Milestone 11: Compiler CLI Options (-E, -S, -c, -v, -D) & Built-in `ar` Archiver Tool
- Implement compiler stages in `wasm-clang.js` and `driver.js`:
  - Preprocess stage (`-E`): stream preprocessed C/C++ text directly to stdout (`write`) or output file (`-o <file>`), skipping linker.
  - Assembly stage (`-S`): compile source to WebAssembly assembly text (`<name>.s`, `-o <file>`, or `-o -` for stdout), skipping linker.
  - Compile stage (`-c`): compile source to object file (`<name>.o` or `-o <file>`), skipping linker.
  - Full build & link (default): compile sources to `.o` and invoke `wasm-ld` with user objects and libraries.
- Support preprocessor, optimization, diagnostic, and linker flags: `-D<macro>`, `-U<macro>`, `-I<dir>`, `-isystem<dir>`, `-O0`–`-O3`, `-Os`, `-w`, `-Wall`, `-Wextra`, `-Werror`, `-pedantic-errors`, `-v`, `-L<dir>`, `-l<name>`, `-Wl,...`.
- Implement `src/toolchain/ar.js`:
  - Standard POSIX/BSD `ar` tool mounted under `/usr/bin/ar` and available in `which`, shell worker, and `make`.
  - Operations: `rcs` (create/replace with symbol index), `t`/`tv` (table of contents), `x` (extract), `d` (delete), `q` (quick append), `s` (regenerate symbol index).
  - WebAssembly relocatable object parsing: parse custom `linking` section (subtype 8, `WASM_SYMBOL_TABLE`) to extract defined, non-local symbols.
  - Big-endian symbol index (`/`) generation and GNU long filename table (`//`) support, fully compatible with LLVM 8 through LLVM 19 `wasm-ld`.

### Milestone 12: Modern LLVM 19.1.0 WASI Toolchain Upgrade & Upstream Integration
- Upgrade `clang.wasm` and `lld.wasm` to modern **LLVM 19.1.0 (`wasm32-wasip1`)** using prebuilt release assets from [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi).
- Upgrade `sysroot.tar.gz` to modern LLVM 19 WASI Preview 1 sysroot with libc, libc++, compiler-rt runtime builtins (`libclang_rt.builtins.a`), and headers (`/include/wasm32-wasip1`, `/lib/clang/19/include`), compressed with gzip to ~30MB for GitHub file size compliance and fast client loading.
- Upgrade `libraylib.a` to Raylib 5.5 WASI compiled with LLVM 19 from [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi).
- Integrate native WASI Preview 1 `memfs.wasm` from `clang-wasi` with dynamic node allocation, standard WASI Preview 1 ABI alignment, safe `FindNode`, explicit buffer deallocation on unlink, and `path_link` export.
- Remove downloadable prebuilt binaries (`*.wasm`, `sysroot.tar.gz`, `libraylib.a`, Raylib headers) from Git tracking and implement `scripts/download-sysroot.js` to fetch them on demand during `npm install` and build lifecycles.
- Remove redundant repository-local build files and maintain single-source upstream toolchain integration.

### Milestone 13: Turtle Graphics Subsystem (`libturtle`) Integration
- Integrate modular C turtle graphics from [`breeze833/libturtle`](https://github.com/breeze833/libturtle) with Cartesian coordinates and Hardware Abstraction Layer (HAL).
- **Canvas WASI Backend (`libturtle_canvas-wasi.a` / `libturtle.a`)**:
  - Mounted by default in sysroot (`/usr/include/turtle.h`, `/usr/include/turtle_backend_canvas_wasi.h`, `/usr/lib/libturtle.a`).
  - Supports progressive drawing via `turtle_delay(ms)` and animated stylized turtle cursor via `<graphics_canvas.h>`.
  - Links out of the box with `-lturtle` without extra compiler or linker flags.
- **Raylib Backend (`libturtle_raylib.a`)**:
  - Mounted by default in sysroot alongside canvas-wasi (`/usr/include/turtle_backend_raylib.h`, `/usr/lib/libturtle_raylib.a`).
  - Links with `-lturtle_raylib -lraylib`.
- **Link-Time Backend Resolution**:
  - `turtle.h` declares `bool turtle_begin_core(void)`.
  - Backend headers (`turtle_backend_canvas_wasi.h` and `turtle_backend_raylib.h`) wrap initialization in `#define turtle_begin(ctx) (<backend>_turtle_init(ctx) && turtle_begin_core())` to strictly prevent linking against incorrect backend archives.
- **Automated In-Tree Compilation & Zero-Drift Header Sync**:
  - `scripts/download-sysroot.js` clones `libturtle` into `build/libturtle` and builds both WASI static libraries using the in-tree `llvm-box.wasm` WebAssembly toolchain (`WasmToolchain`) and `buildArchive` (`ar.js`), removing host toolchain requirements (`clang`, `llvm-ar`, `make`).
  - Copies user headers to `public/sysroot/include/turtle/` and bundles them directly into `sysroot.tar.gz`, eliminating manual header duplication and string fallbacks.
- Bundled example programs: `06_turtle_canvas.c` and `07_turtle_raylib.c`.

### Milestone 14: Raylib Module Decoupling (`raylib-wasi`) & Architecture Unification
- Modularize Raylib 5.5 host runtime into external package [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi).
- Remove ad-hoc `src/toolchain/raylib-host.js` from `wasm-c-ide`.
- Delegate WebGL ES 2.0 state machine, handle tables, Web Audio bridge, and Wasm runtime imports (`gl`, `raylib`) directly to `raylib-wasi`.
- Integrate Web Audio subsystem: pure WASI audio decoders and playback proxying (`createAudioReceiver`) from worker to main thread `AudioContext`.
- Mount Raylib standard C and GUI headers (`raylib.h`, `raymath.h`, `rlgl.h`, `raygui.h`) into VFS and sysroot via `scripts/download-sysroot.js` / module dist.
- Enforce strict zero-binary and zero-upstream-header Git repository policies: `libraylib.a` is fetched on demand via GitHub Releases.
- Align `InputCoordinator` between `canvas-wasi` and `raylib-wasi` over the shared 512-byte `SharedArrayBuffer` layout.

### Milestone 15: In-Code Standard File I/O (`fopen` / `fstream`) & Bidirectional VFS Synchronization
- Implement complete WASI Preview 1 filesystem syscalls in `src/workers/runtime.worker.js`:
  - Preopen descriptor `.` (fd 3) routing relative file access directly into `/workspace`.
  - `path_open` supporting POSIX creation (`WASI_O_CREAT`), truncation (`WASI_O_TRUNC`), exclusive creation (`WASI_O_EXCL`), directory (`WASI_O_DIRECTORY`), and append flags (`WASI_FDFLAG_APPEND`).
  - Read/write and positioning: `fd_read`, `fd_write` (with automatic seek to EOF in append mode), `fd_seek` (`SEEK_SET`, `SEEK_CUR`, `SEEK_END`), `fd_tell`, `fd_close`, `fd_filestat_get`, `fd_filestat_set_size`, and `fd_fdstat_get` advertising complete capability rights (`0x1fffffffffffffffn`).
  - File and directory management: `path_unlink_file` (`remove()`), `path_rename` (`rename()`), and `path_create_directory`.
  - Streaming event notifications (`file_sync`, `file_delete`) on file write/flush/close, with final batch synchronization on process termination.
- Implement host VFS synchronization bridge in `src/terminal/runtime.js` and `src/main.js`:
  - Captures `/workspace` file tree snapshot from `VFS` and delivers it to the runtime worker upon execution.
  - Listens for incremental `file_sync` and `file_delete` events from the worker, immediately updating host `VFS`.
  - On process termination, commits any remaining modified or deleted files to `VFS`, notifying `FileTreeUI` and persisting changes to IndexedDB.
- Integrate standard C++ `<fstream>` in `src/vfs/sysroot.js`:
  - Provide lightweight pedagogical `<fstream>` header (`std::ofstream`, `std::ifstream`, `std::getline`, `std::endl`).
  - Implement equality operators (`operator==`) for pedagogical `std::string`.
  - Update `stddef.h` to use compiler builtin `__builtin_offsetof` and guard `wchar_t` typedef with `#ifndef __cplusplus` for strict C++ standard conformance.
- Implement TAR symlink unpacking in `src/toolchain/tar.js` and `src/toolchain/wasm-clang.js` to preserve and resolve symlink alias headers (`type 2`) from `sysroot.tar.gz`.
- Implement comprehensive automated test suite in `test/fileio.test.js` validating all standard access modes (`"r"`, `"w"`, `"a"`, `"rb"`, `"wb"`, `"r+"`), `fseek`/`ftell`, `remove()`, `rename()`, subdirectory access, and C++ `<fstream>`.


### Milestone 16: Zero-MemFS Unified VFS WASI Host Architecture
- Author and enforce `SPEC.md` as the ground truth architectural specification.
- Eliminate `memfs.wasm` dependency entirely from both compiler toolchain and runtime worker:
  - Remove `memfs.wasm` download, loading, instantiation, and MemFS memory bridging.
  - Implement `src/vfs/wasi-host.js` as the single, canonical, zero-dependency WASI Preview 1 host.
  - Directly connect WASI system calls (`path_open`, `fd_read`, `fd_write`, `fd_pread`, `fd_pwrite`, `fd_seek`, `fd_filestat_get`, `path_filestat_get`, `fd_readdir`, etc.) to `VFS`.
- Dynamic inode allocation & non-zero device id:
  - Generate unique `ino` per path and set `st_dev = 1n` to prevent Clang from mistaking distinct include directories as identical duplicates or looping indefinitely.
- Preopen isolation:
  - Toolchain (`clang`, `lld`): preopens `.` (/workspace, fd 3) and `/` (root sysroot, fd 4).
  - Runtime worker (user binaries): preopens single `.` (/workspace, fd 3) to guarantee relative file accesses resolve cleanly inside `/workspace`.
- Direct sysroot extraction:
  - Unpack `sysroot.tar.gz` directly into host `VFS` using `Tar` reader, preserving directory symlinks and header hierarchies.
- Unified Platform Host Ownership:
  - `wasm-c-ide` directly owns `src/vfs/wasi-host.js` as its tracked platform host, fusing baseline WASI Preview 1 (`clang-wasi`), BusyBox `MemoryPipe` and host builtins (`busybox-wasi`), terminal control, and component graphics/audio bridges.
  - `scripts/download-sysroot.js` downloads only precompiled binary assets, leaving JavaScript runtime code fully tracked in Git.

### Milestone 17: Single-Binary Toolchain Consolidation (`llvm-box.wasm`) & Direct CLI Multicall Delegation
- Consolidate upstream `clang-wasi` release assets into a single multicall binary `llvm-box.wasm` (~60MB), eliminating duplicate downloads of `clang.wasm` and `lld.wasm` and saving ~110MB network payload.
- Update `scripts/download-sysroot.js` to download only `llvm-box.wasm` and `sysroot.tar.gz`.
- Mount `/usr/bin/` aliases (`gcc`, `g++`, `clang`, `clang++`, `ld`, `lld`, `wasm-ld`, `ar`, `ranlib`, `nm`, `objdump`, `size`, `cxxfilt`, `readelf`, `strip`) backed by `llvm-box.wasm`.
- Implement transparent multicall delegation in `src/toolchain/driver.js` and `src/toolchain/wasm-clang.js`:
  - Direct passthrough for toolchain introspection (`gcc --help`, `gcc -v`, `gcc --version`, `g++ --help`, `clang --help`, `ld --help`, `wasm-ld --help`).
  - Map `gcc`/`g++` to `clang`/`clang++` and `ld`/`lld`/`ld.lld` to `wasm-ld`.
- Resolve interactive stdin capturing: handle `stdin_request` event in `RuntimeManager` to seamlessly echo and buffer interactive terminal keystrokes for `scanf` / `cin`.

### Milestone 18: Strict Link-Time Symbol Resolution & Host Whitelist Enforcement
- Eliminate blanket `--allow-undefined` in `WasmToolchain.link()` (`src/toolchain/wasm-clang.js`) for executable binaries.
- Implement host imports whitelist via `--allow-undefined-file=/usr/lib/wasm-host-imports.txt`:
  - Mount `/usr/lib/wasm-host-imports.txt` during sysroot initialization (`src/vfs/sysroot.js`) containing the 37 host functions provided by `canvas-wasi` (`graphics_*` and `canvas_*`).
  - Fall back to generating `/usr/lib/wasm-host-imports.txt` on-the-fly in `wasm-clang.js` if missing during isolated toolchain executions.
- Enforce standard Unix linker behavior:
  - Missing library flags (`-lraylib`, `-lturtle`, `-lm`), omitted object files in multi-file projects, or typos in function calls immediately produce link-time errors: `wasm-ld: error: <file>.o: undefined symbol: <name>`.
  - Prevent broken binaries from reaching runtime execution and exploding with generic exit code 1 or unhandled `LinkError`.
- Preserve `--allow-undefined` for WebAssembly shared objects (`.so`) where external symbol resolution is deferred to dynamic loading time.
- Route `--allow-undefined` and `-Wl,--allow-undefined` in `parseCompilerArgs` (`src/toolchain/driver.js`) to linker flags, allowing advanced users to explicitly opt into permissive linking when desired.
- Add test case in `test/toolchain.test.js` validating undefined symbol rejection and host whitelist acceptance.

### Milestone 19: Toolchain Startup Acceleration, Streaming Compilation & IndexedDB Persistence
- Implement `src/toolchain/wasm-cache.js`:
  - Persistent binary storage using IndexedDB database `wasm-c-ide-wasm-cache` and object store `wasm_modules`.
  - Store raw 56 MB `ArrayBuffer` (`llvm-box-19.1.0`) to avoid browser-engine `DataCloneError` on `WebAssembly.Module` serialization (deprecated across Chromium and Gecko).
  - Subsequent launches retrieve `llvm-box` from local disk in **<100ms** with zero network transfer.
- Implement streaming compilation & parallel stream cloning in `src/toolchain/wasm-clang.js`:
  - Parallelize network download and compilation via `WebAssembly.compileStreaming(res)` while cloning stream to capture `ArrayBuffer` for IndexedDB cache without double download.
  - Safe fallback to `arrayBuffer()` and `WebAssembly.compile()` for mock environments and non-streaming HTTP responses.
- Implement background pre-warming in `src/main.js`:
  - Silently warm up `_getLlvmBox({ silent: true })` following sysroot header extraction.
- Implement Service Worker streaming optimization in `public/coi-serviceworker.js`:
  - Detect `llvm-box.wasm` (~56 MB) and bypass `networkResponse.clone()` and `cache.put()`.
  - Stream directly through with COOP/COEP headers, eliminating Service Worker memory buffer locks, worker termination, and timeout-induced `AbortError` (`"The operation was aborted."`).
- Add unit test verification in `test/toolchain.test.js` for `wasm-cache` fallback, IndexedDB ArrayBuffer persistence, and instant cache hits.

### Milestone 20: Detached Floating Terminal Mode, ANSI Screen Control & Direct Sysroot Bundling
- **Detached Floating Terminal Mode**:
  - Detach bottom dock terminal into floating draggable window with preset dimensions (80x24 standard VT100 geometry, cycling to 100x30 and 120x36).
  - Title bar dragging with viewport edge boundary clamping.
  - Sizing badge with interactive click-to-detach and click-to-cycle presets.
  - Window control actions: dynamic minimize/maximize toggling with proper icons (`_` underscore and `□` square).
  - Active focus tracking with distinct green glow outline (`box-shadow: 0 0 0 2px #22c55e, 0 16px 40px rgba(0,0,0,0.6)`).
  - Keyboard shortcut: `Ctrl+Shift+D` (or `Cmd+Shift+D`) to toggle between docked and floating modes.
- **ANSI VT100 Screen Control & UTF-8 Text Decoding**:
  - Update `WasiHost.prototype.readStr` in `src/vfs/wasi-host.js` (and `clang-wasi`) to decode strings using `TextDecoder('utf-8')` instead of byte-by-byte char code concatenation.
  - Guarantees multi-byte UTF-8 sequences, box-drawing characters (`─`, `│`, `┌`, `┐`, `└`, `┘`, `┼`), and international characters render cleanly in `xterm.js`.
  - Bundled example `08_ansi_terminal.c` demonstrating VT100 screen control, direct cursor positioning (`\033[%d;%dH`), colors, and animated progress bars.
- **Synchronous Timer Sleeping in WASI (`poll_oneoff`)**:
  - Implement real clock timer subscription parsing (`WASI_EVENTTYPE_CLOCK`) in `WasiHost.prototype.poll_oneoff`.
  - Convert nanosecond timeouts to millisecond durations and sleep synchronously via `Atomics.wait()` on `SharedArrayBuffer` when cross-origin isolated.
  - Powers standard POSIX `nanosleep(&ts, NULL)`, `usleep()`, `sleep()`, and turtle `delay_ms()` accurately without 100% CPU busy looping.
- **Permanent Sysroot Bundling & Settings Simplification**:
  - Bundle Raylib headers (`raylib.h`, `raymath.h`, `rlgl.h`, `raygui.h`) directly into `sysroot.tar.gz` and `public/sysroot/include/` in `scripts/download-sysroot.js`.
  - Mount Raylib and Raylib-turtle headers (`raylib.h`, `raymath.h`, `rlgl.h`, `raygui.h`, `turtle_backend_raylib.h`) permanently in `/usr/include/` during `mountSysroot(vfs)`.
  - Mount and preload `libraylib.a` and `libturtle_raylib.a` in `/usr/lib/` and `/lib/wasm32-wasip1/` out of the box.
  - Remove `#setting-raylib` checkbox from Project Settings; users explicitly specify linker flags (`-lraylib`, `-lturtle_raylib -lraylib`).

### Milestone 21: Collapsible (Slim Rail) & Resizable Workspace Sidebar
- Implement horizontal draggable divider (`#sidebar-resizer`) between sidebar and editor allowing dynamic width adjustment (160px–600px).
- Implement double-click on resizer handle to reset sidebar to default 240px.
- Implement collapsible slim vertical rail:
  - Collapsing reduces sidebar width to 36px with transition animation.
  - Displays toggle button (flipping between `«` and `»`) and vertical label **`WORKSPACE`** (`writing-mode: vertical-rl; transform: rotate(180deg)`).
  - Clicking the toggle button or the collapsed vertical strip expands the sidebar back to its previous width.
  - Automatically hides `#sidebar-resizer` while collapsed.
- Implement keyboard shortcut: `Ctrl+B` / `Cmd+B` toggles sidebar between collapsed and expanded states (bound globally and within Monaco editor).
- Implement session persistence: stores custom width (`wasm_c_ide_sidebar_width`) and collapsed state (`wasm_c_ide_sidebar_collapsed`) in `localStorage`.
- Add comprehensive automated test suite in `test/sidebar.test.js`.

### Milestone 22: Project Settings Decoupling & Configurable Run Execution
- Decouple **Save** (state & sysroot mounting) and **Generate Build Script** (`build.sh` & `Makefile` generation) in the Project Settings modal.
- Implement custom Run Command input (`#setting-run-cmd`) persisting across sessions in `localStorage` (`wasm_c_ide_run_cmd`).
- Default Run Command: `pushd . && cd /workspace && ./a.out; popd`.
- Clicking the toolbar **Run** button (`#btn-run`) injects the configured command into the active terminal session, preserving directory stack semantics even on runtime errors.
- Unit test coverage in `test/settings-upgrade.test.js`.

### Milestone 23: Passive System Upgrade & Double-Confirmation Toolchain Refresh
- Add **System Upgrade** button (`#modal-upgrade-btn`) in the Project Settings modal header.
- Implement two-stage confirmation modal overlay (`#upgrade-confirm-overlay`):
  - Informs the user of upgrade implications (purging cached compiler modules and Service Worker caches).
  - Explicitly highlights that user workspace files (`/workspace`) remain completely intact.
- Implement selective cache purge in `SettingsModal.prototype.performSystemUpgrade()`:
  - Deletes `wasm_cache` IndexedDB database (purging `llvm-box.wasm`).
  - Iterates and unregisters active Service Worker registrations.
  - Clears Service Worker `CacheStorage` keys (`caches.delete`).
  - Triggers hard page reload (`window.location.reload()`) to refetch the latest toolchain and assets from production.
- Unit test coverage in `test/settings-upgrade.test.js`.

### Milestone 24: SQLite 3 WASI Embedded Database & CLI Subsystem (`sqlite-wasi`)
- Integrate zero-dependency embedded relational database engine SQLite 3 (version 3.54.1) targeting `wasm32-wasip1` from [`breeze833/sqlite-wasi`](https://github.com/breeze833/sqlite-wasi).
- Bundled sysroot headers & static library:
  - Dynamically fetch and mount `/usr/include/sqlite3.h` and `/usr/include/sqlite3ext.h` directly into `sysroot.tar.gz` and `public/sysroot/include/`.
  - Mount precompiled static library `libsqlite3.a` in `/usr/lib/` and `/lib/wasm32-wasip1/`.
  - User programs compile and link cleanly using standard `-lsqlite3` without additional flags or host bridges.
- Standalone CLI binary (`/usr/bin/sqlite3`):
  - Mount `sqlite3.wasm` into `/usr/bin/sqlite3` in the in-memory `VFS`.
  - Register in shell commands (`which sqlite3` resolves to `/usr/bin/sqlite3`).
  - Interoperate with shell pipelines and input/output stream redirections (`<`, `>`, `>>`, `|`).
  - Live bidirectional synchronization of database files (`*.db`) to host VFS and FileTree.
  - Interactive SQL shell supporting arrow key line-editing and query history via `LineEditor`.
- Bundled example program: `examples/09_sqlite_database.c`.
- Automated test coverage in `test/sqlite.test.js`.

### Milestone 25: Unified Terminal Line Editor & Prompt-Safe Stdin Subsystem (`LineEditor`)
- Implement `src/terminal/line-editor.js` as the single authoritative terminal line-editing engine for both `shell.worker.js` and `runtime.js`.
- Prompt-safe relative redrawing algorithm:
  - Cursor tracking strictly relative to the input line buffer.
  - Cursor back-stepping (`\b.repeat(cursor)`) and suffix clearing (`\x1b[K`) preserving preceding application prompts (`sqlite> `, `ide:~$ `).
- Keybindings & navigation:
  - Horizontal navigation: Left/Right arrows, Home/End, Ctrl+A/E.
  - Text deletion: Backspace, Delete, Ctrl+K (kill to line end), Ctrl+U (clear line).
  - History recall: Up/Down arrows with uncommitted edit scratchpad preservation (`savedScratch`).
  - Contextual history isolation: segregated history stacks by namespace (`'shell'`, `'sqlite3'`, `'default'`).
- Signal & control invariants:
  - `Ctrl-C` (`\x03`) immediately bypasses input buffer and triggers process/command interruption.
  - `Ctrl-D` (`\x04`) flushes partial buffer if non-empty, or signals `STATE_EOF` (`-1`) to close interactive sessions cleanly.
- Unit test coverage in `test/line-editor.test.js`.

### Milestone 26: Startup Loading Indication, VFS Population Lifecycle & Dev Server Production Emulation
- Real-time informational boot feedback in `xterm.js`:
  - Early `TerminalManager` initialization during `App.prototype.init()` to stream boot progress into viewport.
  - Sequential startup log messages: environment initialization, VFS headers mounting, workspace loading, sysroot preparation, tarball fetching, decompression and unpacking progress, runtime library preloading, and system ready.
- Deferred shell prompt and keystroke guarding:
  - `this.isReady` guards terminal input and keyboard interrupts before VFS population finishes.
  - Welcome banner and shell prompt (`ide:~$ `) are strictly deferred until all VFS items are fully populated.
  - Concurrent runtime library preloading via `Promise.all` in `WasmToolchain.prototype.init()`.
- Local dev server production emulation (`emulate-production-sysroot`):
  - Custom Vite plugin in `vite.config.js` serving `/sysroot/wasm/` as `application/octet-stream` without `Content-Encoding: gzip`.
  - Adds immutable caching headers matching production server behavior, eliminating duplicate decompressions and manual testing delays.
- Unit test coverage in `test/startup.test.js`.

### Milestone 27: Raylib 5.5 Web Audio, Immediate-Mode GUI (`raygui.h`) & Single-Threaded Pacing Documentation
- Raylib 5.5 Ecosystem Integration:
  - Header files: `<raylib.h>`, `<raymath.h>`, `<rlgl.h>`, and `<raygui.h>` mounted permanently into `/usr/include/` via default VFS sysroot.
  - Runtime static library `libraylib.a` bundled in sysroot and linked out-of-the-box with `-lraylib`.
- Pure WASI Web Audio Subsystem:
  - Raylib audio decoders and procedural wave synthesis running in runtime worker without POSIX threads.
  - Proxying worker audio messages to host `createAudioReceiver` (`src/terminal/runtime.js`), bridging to browser `AudioContext`.
  - Automatic audio unlock on user gesture and clean teardown on process exit.
- Immediate-Mode GUI (`raygui.h`):
  - In-tree support for `raygui.h` (`#define RAYGUI_IMPLEMENTATION`) with immediate-mode widgets (buttons, sliders, toggles, checkboxes, group boxes).
- Pedagogical Example:
  - Bundled `examples/10_raylib_gui_audio.c` demonstrating immediate-mode UI, procedural Web Audio synthesis, 16-band frequency equalizer, orbital particles, and reactive shockwaves.
- Architectural Documentation & Single-Threaded Frame Pacing:
  - Documented WebAssembly single-threaded display loop constraints in `docs/KNOWN_ISSUES.md`.
  - Authored comprehensive case study `docs/SINGLE_THREAD_FRAME_PACING.md` detailing the mechanics and mathematics of progressive animation delays (e.g. `turtle_delay(25.0)`) and the alternating 1-frame/2-frame cadence resulting in ~47 FPS.

### Milestone 28: Canvas-WASI v0.1.3 Integration & Canvas-Window Delegation
- Upgrade `canvas-wasi` dependency to `v0.1.3`:
  - Delegates floating draggable windowing, pop-out detached window (`window.open`), dock-back restoration, and input coordination to `canvas-window`.
  - Re-exports `CanvasWindow`, `GraphicsWindowUI`, `InputCoordinator`, and protocol constants directly from `canvas-window`.
  - Ensures clean HTTPS resolution for `canvas-window` in `package-lock.json` for reliable CI environments.
- Sysroot asset download resiliency:
  - Updates `scripts/download-sysroot.js` to verify presence of `raygui.h` in `localDist` before selecting it, falling back to `node_modules/raylib-wasi/dist`.
- Test suite alignment:
  - Updates `test/graphics.test.js` to assert default title `'Canvas Display'` matching `canvas-window`.

### Milestone 29: Dedicated Compiler Web Worker & Off-Thread Toolchain Execution
- Architect dedicated, persistent `compiler.worker.js` and client manager `compiler-client.js`:
  - Offloads LLVM Clang, LLD linker, archiver (`ar`), and build engine (`make`) from main browser thread to background Web Worker.
  - Eliminates main-thread UI freezing during compilation of large source files (e.g. `examples/10_raylib_gui_audio.c` with `raygui.h`).
  - Keeps Monaco editor, toolbar buttons, and floating windows at 60 FPS responsiveness during long builds.
- Instant `Ctrl+C` / Stop Process Termination:
  - Supports immediate cancellation of in-flight builds via `worker.terminate()`, returning cleanly to shell prompt and re-spawning a replacement compiler worker in background.
- Real-Time Diagnostic Streaming:
  - Streams compiler stdout and stderr diagnostics incrementally to `xterm.js` via `postMessage({ type: 'stdout', id, data })`.
- Differential `/workspace` Synchronization:
  - Synchronizes modified user files into worker before compilation and applies generated artifacts (`a.out`, `*.o`, `*.a`) back to master VFS upon completion.
- Comprehensive Architectural Documentation:
  - Authored case study `docs/DEDICATED_COMPILER_WORKER.md` detailing the threading model, root causes of UI freezing, and comparative analysis of worker designs.

### Milestone 30: BusyBox Applet VFS Publishing & Virtual Character Devices (/dev/null, /dev/zero)
- Publish all 72 compiled BusyBox applets into `BIN_COMMANDS` mounted under `/bin` using `wasmBinaryStub` (`\0asm`).
- Guarantee full toolchain discoverability: `ls /bin` displays all core utilities (`cat`, `ls`, `head`, `tail`, `grep`, `awk`, `sed`, `find`, `sort`, `uniq`, `diff`, `wc`, `tar`, `tr`, etc.) and `which <cmd>` resolves accurately to `/bin/<cmd>`.
- Pre-mount `/dev` with read-only protection in `VFS`.
- Support virtual character devices `/dev/null` and `/dev/zero` via `clang-wasi` Platform Host:
  - Discard written bytes without memory allocations.
  - Return EOF (`0` bytes) for `/dev/null` reads and zero-filled buffers for `/dev/zero` reads.
  - Synthesize virtual directory entries in `ls /dev` (`null`, `zero` with `d_type: 2`) without physical VFS nodes.
- Update automated test suite in `test/shell.test.js` and `test/vfs.test.js`.

### Milestone 31: Real GNU Make WASI Integration (`make-wasi`) & Educational JS Parser Retirement
- Replace the legacy educational JS-based Makefile runner (`src/toolchain/make.js`) with genuine GNU Make 4.4.1 compiled for WASI Preview 1 (`make.wasm`) from `make-wasi`.
- Host-assisted recipe dispatch (`wasi_run_recipe`):
  - Bridges GNU Make recipe execution directly into the host runtime via `make-wasi/host`.
  - Seamlessly evaluates built-in filesystem operations (`mkdir -p`, `rm -rf`, `touch`, `cp`, `mv`, `echo`) and toolchain commands (`gcc`, `g++`, `clang`, `clang++`, `ar`, `wasm-ld`).
  - Evaluates `$(shell ...)` expansions via `wasi_capture_command`.
- Synchronous Toolchain Execution in Background Worker:
  - Extends `WasmToolchain` and `AppInstance` with synchronous instantiation (`AppInstance.createSync`, `compileSync`, `linkSync`, `runToolSync`, `runClangSync`) using the pre-compiled `llvmBoxModule`.
  - Implements `executeGccCommandSync` in `src/toolchain/driver.js` to synchronously compile and link object files during GNU Make recipe execution without async event loop suspension.
- Accurate VFS Mtime Preservation & Touch Integration:
  - Implements `setTimes` in `VFS` (`src/vfs/vfs.js`) and overrides `path_filestat_set_times` / `fd_filestat_set_times` in `WasiHost` (`src/vfs/wasi-host.js`), enabling BusyBox `touch` to update timestamps on existing files with monotonic forward advancement.
  - Preserves exact `{ content, mtime }` across `shell.worker.js`, `compiler.worker.js`, and host `main.js` via `vfs_sync` and `CompilerClient.getWorkspaceFiles()`, preventing timestamp clobbering.
  - Overrides `path_filestat_get` and `fd_filestat_get` in `WasiHost` (`src/vfs/wasi-host.js`) to report real nanosecond modification timestamps from `VFS` nodes (`st.mtime * 1000000n`).
  - Enables accurate GNU Make incremental rebuilds: avoids rebuilding targets whose prerequisites are older than the target, and selectively rebuilds only modified targets.
- Pre-mounted Toolchain Binary:
  - Mounts `/usr/bin/make` backed by `make.wasm` in `SYSROOT_UTILITIES` in `src/vfs/sysroot.js`.
  - Adds `downloadMakeAssets()` in `scripts/download-sysroot.js` fetching `make.wasm` from `https://github.com/breeze833/make-wasi/releases/download/latest/make.wasm`.
  - Adds dependency `"make-wasi"` to `package.json`.
- Comprehensive Automated Test Suite:
  - Updates `test/make.test.js` covering automatic variables (`$@`, `$<`, `$^`), order-only prerequisites (`|`), pattern rules (`build/%.o: src/%.c`), conditionals (`ifeq`), `include` directives, `-k` (keep-going), `-n` (dry-run), error propagation, and end-to-end C compilation into WebAssembly binaries.

### Milestone 32: Direct Sysroot Header Unification, Synchronous Shell Stdin & POSIX Heredocs
- Direct Sysroot Header Unification:
  - Repack all third-party and custom headers (Raylib, Raygui, Turtle, SQLite) directly into `sysroot.tar.gz` and `public/sysroot/include/` via `scripts/download-sysroot.js`.
  - Remove virtual string-embedded header modules (`raylib-headers.js`, `sqlite-headers.js`, `turtle-headers.js`), simplifying `sysroot.js` and reducing JavaScript bundle size.
- Synchronous Shell Stdin & Interactive Input Routing:
  - Implement interactive stdin bridging (`stdin_request` / `stdin_buffer`) between `shell.worker.js` and `main.js`.
  - Interactive commands like `cat > file` and `sqlite3` prompt in xterm, echo characters, and cleanly capture multi-line keyboard input until `Ctrl-D` sends EOF.
- POSIX Heredoc & Multi-Line Buffer Accumulation (`cat <<EOF`):
  - Detect pending heredocs and multi-line continuations via `findHeredocs` and `isCommandIncomplete`.
  - Accumulate heredoc lines with secondary prompt (`> `).
  - Synthesize missing closing delimiters when aborted early with `Ctrl-D`, preventing shell trailing control commands (`__rc=$?...`) from leaking into stdout.

---

## 4. Verification & Testing Checklist

Before marking any task complete, agents must verify:

| Test Case | Expected Behavior |
|---|---|
| **Strict Link-Time Symbol Resolution** | Referencing undefined functions without required libraries (e.g. omitting `-lraylib` or multi-file `.o`) triggers `wasm-ld: error: undefined symbol` at link time; whitelisted host functions (`<graphics.h>`, `<graphics_canvas.h>`) link cleanly. |
| **C++ Keyword in Pure C Mode** | Declaring `int class = 5;` or `int new = 1;` in Pure C mode triggers strict compile error. |
| **Missing Semicolon / Syntax Error** | Compiler diagnostics with exact line/col and colors are printed to `xterm.js`. |
| **Unsaved Edits** | Clicking Build without saving produces a dirty warning; output binary reflects disk state, not editor state. |
| **Multi-File Linkage** | Separately compiled `.o` files link into an executable without symbol resolution errors. |
| **Interactive `scanf`** | Program halts at `scanf("%d", &v)`, accepts typing from terminal, and proceeds upon Enter without UI freeze. |
| **Interactive `Ctrl-D` (EOF)** | Pressing `Ctrl-D` while waiting for input triggers EOF (`nread = 0`), exiting input loops cleanly. |
| **Output Redirection (`>`, `>>`)** | `echo "hi" > file.txt` writes to file; `>>` appends to file without clobbering existing content. |
| **Input Redirection (`<`)** | `./a.out < input.txt` reads directly from VFS file without interactive terminal prompt. |
| **Command Pipelines (`|`)** | `cat input.txt | ./a.out` and `./a.out | cat` pipe output to input across stages. |
| **Direct Shell Script Execution** | `./build.sh` or `/workspace/script.sh` runs shell commands without requiring manual `sh` prefix; Wasm validation catches invalid binaries. |
| **Compiler Preprocessing (`gcc -E`)** | `gcc -E main.c` streams preprocessed output to terminal or `main.i` via `-o` without linking. |
| **Compiler Assembly (`gcc -S`)** | `gcc -S main.c` compiles to WebAssembly assembly text (`main.s` or `-o <file>`) without linking. |
| **Compiler Macros & Diagnostics (`-D`, `-v`)** | Macros defined via `-D` substitute cleanly; `-v` prints verbose toolchain invocations and search paths. |
| **Static Archiver Creation (`ar rcs`)** | `ar rcs libmath.a add.o sub.o` generates compliant `!<arch>\n` archive with big-endian symbol index extracted from Wasm relocatable objects. |
| **Static Archiver Linkage (`wasm-ld`)** | Programs link against generated `.a` archives using `-Lworkspace -lmath` or direct file path `workspace/libmath.a`. |
| **Static Archiver Table & Extraction (`ar t`, `ar x`)** | `ar t` lists member files; `ar x` unpacks members into current directory; `ar d` deletes members. |
| **Shared Object Creation (`gcc -shared`)** | `gcc -shared -fPIC math.c -o libmath.so` produces compliant WebAssembly shared library with `dylink.0` section. |
| **Shared Object Linkage (`gcc main.c libmath.so`)** | Executables link against `.so` shared libraries, creating dynamic `dylink.0` dependencies and `env.<symbol>` imports. |
| **Shared Object Runtime Execution** | Executable dynamically loads and invokes functions exported from `.so` without unresolved symbols. |
| **C++ Shared Object (`g++ -shared -fPIC`)** | C++ code compiles to position-independent `.so` and exports `extern "C"` symbols properly. |
| **In-Code Standard File I/O (`fopen`, `fstream`)** | Programs using standard C file operations (`fopen` with "r", "w", "a", "rb", "wb", "r+", `fread`, `fwrite`, `fseek`, `ftell`, `fgets`, `fputs`, `fclose`, `remove`, `rename`) and C++ `<fstream>` (`std::ofstream`, `std::ifstream`) read, write, seek, and mutate files in `/workspace` with bidirectional VFS synchronization. |
| **Infinite Loop Interruption** | `while(1);` can be interrupted via `Ctrl+C` or UI Stop button; terminal returns to prompt. |
| **Refresh Persistence** | Modifying files, closing tab, and reopening keeps files intact via IndexedDB. |
| **Zip Round-Trip** | Exporting project to zip and re-importing preserves directory hierarchy. |
| **Font Zoom & Clamping** | Clicking +/- or pressing Ctrl+=/- zooms font size within 9px–36px limits; clicking label resets. |
| **Font Zoom Persistence** | Reloading page preserves configured font size for editor and terminal via localStorage. |
| **Sub-Path Asset Resolution** | Serving application under a sub-path resolves all assets without broken root `/` requests. |
| **Async Wasm Loading (8MB Limit)** | Clang (~20MB+) compiles and instantiates asynchronously without triggering main-thread synchronous size errors. |
| **Permanent Sysroot Bundling** | Raylib 5.5, Raylib turtle, and SQLite development files (`raylib.h`, `raymath.h`, `rlgl.h`, `raygui.h`, `turtle_backend_raylib.h`, `sqlite3.h`, `libraylib.a`, `libturtle_raylib.a`, `libsqlite3.a`) mount in sysroot by default. |
| **Raylib Compilation & Linking** | Programs using `InitWindow` and drawing primitives link with `-lraylib` and run in runtime worker out-of-the-box. |
| **Generic Framebuffer Compilation** | Programs using `<graphics.h>` compile with standard Pure C mode without external link flags. |
| **Generic Framebuffer Rendering** | Passing pixel buffers to `graphics_present` transfers `ImageBitmap` frames to `#graphics-canvas`. |
| **2D Vector Canvas Compilation & Drawing** | Programs using `<graphics_canvas.h>` compile in pure C and render vector paths, shapes, and typography via OffscreenCanvas 2D context. |
| **Canvas Pixel Manipulation & Image Processing** | Programs using `canvas_get_pixels`, `canvas_put_pixels`, `canvas_get_image_data`, `canvas_put_image_data`, `canvas_get_pixel`, and `canvas_set_pixel` directly inspect and modify canvas raster memory in pure C. |
| **Dynamic Canvas Dimensions** | Initializing window sets canvas and window frame to requested size; toggling canvas preserves dimensions. |
| **Synchronous Frame Delivery** | `transferToImageBitmap()` delivers frames synchronously without Promise starvation in Wasm loops. |
| **Background Activity Indicator** | Presenting frames while window is minimized/hidden activates green pulsating dot on `[🎮 Canvas]` button. |
| **Dual-Channel Input Coordination** | Mouse movement, clicks, and keys synchronize via `SharedArrayBuffer` with message fallback and `DataView` byte safety. |
| **Settings Action Decoupling** | Clicking Save updates state without modifying `/workspace`; Generate Build Script creates build files with user Linker Flags. |
| **Configurable Run Command** | Project Settings modal configures custom run command with default `pushd . && cd /workspace && ./a.out; popd`, persists in `localStorage`, and injects into xterm on clicking `#btn-run`. |
| **MemFS Recompilation Invariant** | Deleting an object file (`build/calc.o`) or deleted source file purges MemFS without ghost files; re-running `make` re-compiles and relinks without corrupted object headers. |
| **Example Programs Suite** | `01_stdio.c`, `02_raylib_interactive.c`, `03_framebuffer_graphics.c`, `04_canvas_vector.c`, `05_canvas_pixels.c`, `06_turtle_canvas.c`, `07_turtle_raylib.c`, `08_ansi_terminal.c`, `09_sqlite_database.c`, and `10_raylib_gui_audio.c` compile and run without error. |
| **Canvas Turtle Graphics (`-lturtle`)** | Programs using `<turtle.h>` and `<turtle_backend_canvas_wasi.h>` compile by default and animate with `turtle_delay()`. |
| **Raylib Turtle Graphics (`-lturtle_raylib -lraylib`)** | Linking with `-lturtle_raylib -lraylib` compiles and renders in Raylib mode out of the box. |
| **Turtle Link-Time Backend Resolution** | Programs link against matching backend archive via `turtle_begin(ctx)` macro and fail link-time resolution if mismatched. |
| **SQLite 3 C Compilation & Linking** | Programs including `<sqlite3.h>` compile and link cleanly with `-lsqlite3`, performing transactions with VFS persistence. |
| **SQLite 3 CLI Execution** | `sqlite3` command executes in terminal against `:memory:` or `/workspace/*.db` with interactive queries and stream redirection. |
| **Detached Floating Terminal Mode** | Floating window snaps to 80x24 standard VT100 dimensions, cycles through presets (100x30, 120x36), supports title dragging with viewport clamping, dynamic minimize/maximize icons (`_` and `□`), and active green glow focus. |
| **ANSI VT100 & UTF-8 Screen Control** | Programs using ANSI VT100 control sequences and UTF-8 multi-byte characters (box borders, cursor positioning, colors) render crisply in `xterm.js`. |
| **Synchronous Timer Sleeping** | WASI `poll_oneoff` accurately parses clock events and sleeps synchronously via `Atomics.wait` on `SharedArrayBuffer` without busy looping. |
| **Collapsible & Resizable Sidebar** | Sidebar freely resizes with smooth col-resize dragging, collapses to 36px slim vertical rail with vertical WORKSPACE label, responds to Ctrl+B, and persists width and collapsed state in localStorage. |
| **Unified LineEditor In-Line Navigation** | Left/Right arrows, Home/End, Backspace, Delete, Ctrl+A/E, and Ctrl+K/U operate with accurate cursor positioning without prompt corruption across shell and user binaries. |
| **Arrow Key History Recall** | Up/Down arrows recall command history and restore uncommitted scratch edits across both shell and runtime. |
| **Contextual History Isolation** | Shell command history (`gcc`, `ls`) and application query history (`sqlite3`: SQL statements) maintain separate history stacks. |
| **Interactive SQLite3 Shell Line-Editing** | In `sqlite3` CLI, Up/Down arrows recall previous queries and Left/Right arrows move cursor in place without overwriting or erasing the `sqlite> ` prompt. |
| **Ctrl-D and Ctrl-C Invariants** | `Ctrl-C` immediately halts running binaries or interrupts the shell, while `Ctrl-D` cleanly terminates interactive sessions (`sqlite3`, `cat`) or sends EOF without input corruption. |
| **Passive System Upgrade & Workspace Preservation** | Clicking `#modal-upgrade-btn` in Project Settings header displays confirmation dialog; confirming purges compiler wasm-cache and Service Worker CacheStorage, triggers page reload, and keeps `/workspace` user files intact. |
| **Startup Loading Indication & Deferred Prompt** | Startup streams informational loading and progress messages into the xterm terminal area during VFS preparation (sysroot fetching, decompression, unpacking, library preloading); input is guarded during boot, and the welcome message and interactive shell prompt appear only after all VFS items are fully populated. |
| **Offline PWA Installation** | Application provides valid manifest, registers service worker with COOP/COEP headers, and operates offline. |
| **Portable Zip Distribution** | `npm run pack` creates a standalone `wasm-c-ide.zip` that runs in any static web server document root. |
| **Virtual Character Devices (`/dev/null`, `/dev/zero`)** | Shell stream redirections (`> /dev/null`, `< /dev/null`, `/dev/zero`) operate without allocating physical VFS storage; `ls /dev` lists virtual character devices `null` and `zero`. |
| **BusyBox Applet VFS Publishing** | All 70+ BusyBox multicall applets are mounted into `/bin` and discoverable via `ls /bin` and `which <cmd>`. |
| **Bidirectional VFS & Shell Directory Sync** | `touch`, `mkdir`, and `rmdir` execute reliably in shell; file and directory additions/removals synchronize bidirectionally between terminal and sidebar file tree without page refresh. |
| **Slide-Out Right Reference Drawer UI** | Clicking `#btn-reference` or pressing `Ctrl+Shift+H` / `F1` toggles the slide-out drawer on the right without occluding the editor or disrupting terminal output. |
| **Offline Documentation Invariant** | In offline PWA mode, the reference drawer renders all tabs (Libc/WASI limits, Turtle, Canvas, Raylib, and SQLite) instantly with zero network requests. |
| **Pristine Upstream Headers Invariant** | Upstream headers (`raylib.h`, `sqlite3.h`) remain 100% byte-for-byte identical to upstream without manual docstring edits or patch drift. |
| **Monaco Custom Header Hover Tooltips** | Hovering over functions declared in custom sysroot headers (`turtle_forward`, `graphics_fill_rect`, `raylib_turtle_init`) displays detailed prototypes, parameter explanations, and coordinate notes parsed from header docstrings. |
| **Libc & WASI Restrictions Guidance** | The General C Libc tab clearly documents unavailable syscalls (`fork`, `exec`, `sockets`, `pthreads`) and demonstrates idiomatic WASI alternatives (`poll_oneoff`, `WasiHost` VFS file I/O). |
| **1-Click Example Template Loading** | Clicking "Load Example" from any reference tab prompts cleanly if the active tab is unsaved, opens the corresponding C example in a new editor tab, and synchronizes with the file tree. |
| **External Documentation Link Safety** | Clicking external links to the public documentation site, Raylib cheatsheet, or SQLite reference opens in a new browser tab with `rel="noopener noreferrer"`, preserving active IDE state and avoiding navigation loss. |
| **Subpath & Base URL Documentation Resolution** | In any deployment subpath (e.g. `/`, `/ide/`, or GitHub Pages `/<repo>/`), clicking the "Open Full Documentation" link in the reference drawer navigates accurately to `${BASE_URL}docs/`, and links within the documentation navigate back to the IDE via `../` with zero 404 errors. |

