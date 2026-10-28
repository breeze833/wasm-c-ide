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
├── SPEC.md                    # Technical specification & architectural ground truth (v1 baseline)
├── SPECv2.md                  # Extended technical specification with Raylib 5.5 graphics
├── SPECv3.md                  # Extended technical specification with LLVM 19 WASI toolchain
├── SPECv4.md                  # Extended technical specification with decoupled raylib-wasi & in-code file I/O
├── SPECv5.md                  # Extended technical specification with Zero-MemFS Unified VFS WASI Host
├── AGENTS.md                  # Agent operating protocols (this file)
├── KNOWN_ISSUES.md            # Documented toolchain version gaps, limits, and MemFS invariants
├── README.md                  # User-facing project documentation & deployment guides
├── examples/                  # Bundled pedagogical single-file C examples & guide
│   ├── 01_stdio.c             # Standard I/O console menu demo
│   ├── 02_raylib_interactive.c # Interactive Raylib 5.5 GLES2 graphics demo
│   ├── 03_framebuffer_graphics.c # Direct software framebuffer procedural plasma demo
│   ├── 04_canvas_vector.c     # HTML5 Canvas 2D vector primitives demo
│   ├── 05_canvas_pixels.c     # Canvas 2D pixel manipulation & image processing demo
│   ├── 06_turtle_canvas.c     # Turtle graphics animated star spiral (canvas-wasi backend)
│   ├── 07_turtle_raylib.c     # Turtle graphics geometric rosette (Raylib backend)
│   └── README.md              # Examples compilation & execution guide
├── index.html                 # Main entry point (loads /coi-serviceworker.js)
├── package.json               # Development tooling, dependencies, and test scripts
├── vite.config.js             # Vite configuration (COOP/COEP headers, workers, wasm support)
├── scripts/
│   └── download-sysroot.js    # Automated LLVM 19, Raylib WASI & libturtle asset downloader and unpacker
├── src/
│   ├── main.js                # App bootstrap, DOM layout, and UI event binding
│   ├── style.css              # Dark theme styling, button color hierarchy, tooltips
│   ├── components/
│   │   ├── filetree.js        # File tree sidebar, directory expansion, file operations
│   │   ├── settings.js        # Project settings modal with decoupled Save and Generate buttons
│   │   └── toast.js           # Non-blocking notification toasts
│   ├── editor/
│   │   ├── editor.js          # Monaco editor instance controller and save actions
│   │   ├── monaco-setup.js    # Monaco worker environment setup
│   │   └── tabs.js            # Tab bar manager and dirty mark (*) tracking
│   ├── terminal/
│   │   ├── terminal.js        # xterm.js wrapper and command injection bridge
│   │   └── runtime.js         # Host-side runtime manager and SharedArrayBuffer coordinator
│   ├── toolchain/
│   │   ├── ar.js              # POSIX ar static library archiver and wasm object symbol extractor
│   │   ├── driver.js          # gcc / clang command parser and execution coordinator
│   │   ├── make.js            # Incremental Makefile runner evaluating mtimes
│   │   ├── tar.js             # Sysroot tarball extractor
│   │   └── wasm-clang.js      # Clang, LLD, and MemFS WebAssembly wrappers
│   ├── vfs/
│   │   ├── archive.js         # JSZip project export and import routines
│   │   ├── storage.js         # IndexedDB synchronization and default project seed
│   │   ├── sysroot.js         # Standard C/C++ sysroot header and binary mount definitions
│   │   ├── vfs.js             # In-memory virtual filesystem with path normalization
│   │   └── wasi-host.js       # Unified zero-dependency WASI Preview 1 host directly backed by VFS
│   └── workers/
│       ├── runtime.worker.js  # WASI host executing user binaries with Atomics stdin & OffscreenCanvas
│       └── shell.worker.js    # Interactive POSIX shell worker (pushd/popd, globs, mv/cp, direct scripts)
├── public/
│   ├── coi-serviceworker.js   # Unified cross-origin isolation and CacheStorage offline worker
│   ├── manifest.webmanifest   # Web App Manifest for PWA installation
│   ├── icons/                 # PWA application icons (192, 512, svg)
│   └── sysroot/               # Downloaded on-demand via scripts/download-sysroot.js (git-ignored)
│       ├── wasm/              # Prebuilt llvm-box.wasm, libraylib.a, libturtle.a, libturtle_raylib.a, sysroot.tar.gz
│       └── include/           # Minimal fallback libc headers, raylib headers & turtle headers
└── test/
    ├── ar.test.js             # Static archiver creation, extraction, table, and wasm-ld linkage tests
    ├── fileio.test.js         # In-code standard C/C++ file I/O, fopen modes, seeking, and fstream tests
    ├── graphics.test.js       # Generic framebuffer, 2D vector, and pixel manipulation tests
    ├── make.test.js           # Makefile parsing and incremental build tests
    ├── pipeline.test.js       # Command pipeline (|) and file redirection (<, >, >>) tests
    ├── raylib.test.js         # Raylib graphics compilation, input sync, and canvas UI tests
    ├── runtime.test.js        # SharedArrayBuffer Atomics protocol and Ctrl-D EOF tests
    ├── shell.test.js          # Shell argument parsing, globs, pushd/popd, mv/cp, and direct scripts
    ├── so.test.js             # WebAssembly shared object (.so) compilation, linking, and runtime execution tests
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
- Integrate Raylib 5.5 WASI static library (`libraylib.a`) and headers (`raylib.h`, `raymath.h`, `rlgl.h`) with opt-in project settings toggle.
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
  - Mounted dynamically when Raylib graphics support is enabled in Project Settings (`/usr/include/turtle_backend_raylib.h`, `/usr/lib/libturtle_raylib.a`).
  - Links with `-lturtle_raylib -lraylib`.
  - Dynamically unmounts from VFS and purges from MemFS when Raylib is disabled.
- Automated asset pipeline in `scripts/download-sysroot.js` downloading headers and compiling/unpacking static archives for offline execution.
- Bundled example programs: `06_turtle_canvas.c` and `07_turtle_raylib.c`.

### Milestone 14: Raylib Module Decoupling (`raylib-wasi`) & Architecture Unification
- Modularize Raylib 5.5 host runtime into external package [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi).
- Remove ad-hoc `src/toolchain/raylib-host.js` from `wasm-c-ide`.
- Delegate WebGL ES 2.0 state machine, handle tables, and Wasm runtime imports (`gl`, `raylib`) directly to `raylib-wasi`.
- Mount Raylib standard C headers (`raylib.h`, `raymath.h`, `rlgl.h`) into VFS and sysroot via `scripts/download-sysroot.js` / module dist.
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
- Author and enforce `SPECv5.md` as the ground truth architectural specification.
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
- Standalone backport to `clang-wasi`:
  - Upstream `WasiHost` into `breeze833/clang-wasi` (`src/wasi-host.js`), providing in-memory VFS runners and automated C/C++ verification tests without external WASI runtime dependencies.

---

## 4. Verification & Testing Checklist

Before marking any task complete, agents must verify:

| Test Case | Expected Behavior |
|---|---|
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
| **Raylib Sysroot Mount/Unmount** | Toggling Raylib mounts/unmounts headers and `libraylib.a` in VFS and MemFS cleanly. |
| **Raylib Compilation & Linking** | Programs using `InitWindow` and drawing primitives link with `-lraylib` and run in runtime worker. |
| **Generic Framebuffer Compilation** | Programs using `<graphics.h>` compile with standard Pure C mode without external link flags. |
| **Generic Framebuffer Rendering** | Passing pixel buffers to `graphics_present` transfers `ImageBitmap` frames to `#graphics-canvas`. |
| **2D Vector Canvas Compilation & Drawing** | Programs using `<graphics_canvas.h>` compile in pure C and render vector paths, shapes, and typography via OffscreenCanvas 2D context. |
| **Canvas Pixel Manipulation & Image Processing** | Programs using `canvas_get_pixels`, `canvas_put_pixels`, `canvas_get_image_data`, `canvas_put_image_data`, `canvas_get_pixel`, and `canvas_set_pixel` directly inspect and modify canvas raster memory in pure C. |
| **Dynamic Canvas Dimensions** | Initializing window sets canvas and window frame to requested size; toggling canvas preserves dimensions. |
| **Synchronous Frame Delivery** | `transferToImageBitmap()` delivers frames synchronously without Promise starvation in Wasm loops. |
| **Background Activity Indicator** | Presenting frames while window is minimized/hidden activates green pulsating dot on `[🎮 Canvas]` button. |
| **Dual-Channel Input Coordination** | Mouse movement, clicks, and keys synchronize via `SharedArrayBuffer` with message fallback and `DataView` byte safety. |
| **Settings Action Decoupling** | Clicking Save updates state and sysroot without modifying `/workspace`; Generate Build Script creates build files. |
| **MemFS Recompilation Invariant** | Deleting an object file (`build/calc.o`) or deleted source file purges MemFS without ghost files; re-running `make` re-compiles and relinks without corrupted object headers. |
| **Example Programs Suite** | `01_stdio.c`, `02_raylib_interactive.c`, `03_framebuffer_graphics.c`, `04_canvas_vector.c`, `05_canvas_pixels.c`, `06_turtle_canvas.c`, and `07_turtle_raylib.c` compile and run without error. |
| **Canvas Turtle Graphics (`-lturtle`)** | Programs using `<turtle.h>` and `<turtle_backend_canvas_wasi.h>` compile by default and animate with `turtle_delay()`. |
| **Raylib Turtle Graphics (`-lturtle_raylib`)** | Enabling Raylib mounts `<turtle_backend_raylib.h>` and `libturtle_raylib.a`, compiling and rendering in Raylib mode. |
| **Turtle Sysroot Dynamic Unmount** | Disabling Raylib unmounts `<turtle_backend_raylib.h>` and `libturtle_raylib.a` from VFS and MemFS cleanly. |
| **Offline PWA Installation** | Application provides valid manifest, registers service worker with COOP/COEP headers, and operates offline. |
| **Portable Zip Distribution** | `npm run pack` creates a standalone `wasm-c-ide.zip` that runs in any static web server document root. |

