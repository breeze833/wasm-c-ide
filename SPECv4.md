# Software Specification v4: In-Browser C/C++ Teaching IDE with LLVM 19 WASI Toolchain & Decoupled Dual-Module Graphics Subsystems (Pure Static Wasm)

## 1. Project Overview & Objectives
The goal of this project is to build an installation-free, zero-backend, multi-file C/C++ programming development and learning environment that runs entirely client-side in modern web browsers via WebAssembly (Wasm).

SPECv4 extends SPECv3 by fully modularizing the Raylib 5.5 graphics subsystem into [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi), establishing architectural symmetry with [`breeze833/canvas-wasi`](https://github.com/breeze833/canvas-wasi). In SPECv4, `wasm-c-ide` completely eliminates ad-hoc graphics and WebGL host dispatcher source code (`raylib-host.js`). All generic 2D vector drawing, procedural software framebuffer, floating/dockable graphics window UI (`GraphicsWindowUI`), and keyboard/mouse input coordination (`InputCoordinator`) are delegated to `canvas-wasi`, while all Raylib 5.5 WebGL ES 2.0 host state machines, handle tables, and Wasm runtime imports are delegated to `raylib-wasi`. Furthermore, SPECv4 establishes a strict zero-binary and zero-upstream-header Git repository policy: compiled binaries (`libraylib.a`) and standard C headers (`raylib.h`, `raymath.h`, `rlgl.h`) are distributed as release assets and fetched on demand by the build/install lifecycle.

### Key Objectives:
- **Zero Backend / Pure Static**: Hostable on static hosting services (e.g., GitHub Pages, Cloudflare Pages, static Nginx) with no server-side execution.
- **Educational Transparency**: Demystify the compilation, assembly, and linking phases. Users observe object files (`.o`), static libraries (`.a`), executables (`.wasm`/binary), search paths, and compiler flags directly in the file tree and terminal.
- **Pedagogical Discipline**: Enforce strict standard C mode (`-std=c11 -pedantic-errors`), disallow automatic saving to cultivate deliberate save habits, and route all GUI actions into visible shell terminal commands.
- **Modern LLVM 19 Toolchain (`wasm32-wasip1`)**:
  - Full support for modern C11, C23, C++17, and C++20 features via prebuilt assets from [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi).
  - Native WebAssembly Section 12 (`DataCount`) bulk-memory support in `wasm-ld`.
  - Upstream compiler-rt runtime builtins (`libclang_rt.builtins.a`).
  - Seamless linking with modern relocations (`R_WASM_TABLE_INDEX_REL_SLEB`, 64-bit table indices).
- **Native WASI Preview 1 MemFS (`memfs.wasm`)**:
  - Maintained upstream in [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi) and integrated as an official release binary.
  - Dynamic inode scaling beyond 1,024 nodes, supporting extraction of over 4,300 standard library headers and runtime files.
  - Standard WASI Preview 1 filestat ABI alignment, standard whence mapping, and safe non-trapping lookups.
- **Decoupled Dual-Module Graphics Subsystems**:
  - **`canvas-wasi`**: Pure C direct software framebuffer (`<graphics.h>`), HTML5 Canvas 2D vector primitives (`<graphics_canvas.h>`), floating/dockable graphics console UI (`GraphicsWindowUI`), and shared 512-byte `SharedArrayBuffer` input coordination (`InputCoordinator`).
  - **`raylib-wasi`**: Standalone Raylib 5.5 port and WebGL ES 2.0 host bridge, providing Wasm imports (`gl`, `raylib`) and zero-Emscripten `PLATFORM_CUSTOM` execution.
- **Dual Console Ergonomics**: A dedicated graphical console window for visual rendering and game inputs running concurrently alongside `xterm.js` for text standard I/O.

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
|  +-------------+------------+          |  - OffscreenCanvas (WebGL/2D Context)|  |
|                | (executes commands)   |  - Modules: canvas-wasi + raylib-wasi|  |
|                v                       +------------------+-------------------+  |
|  +--------------------------------------------------------+                      |
|  |  LLVM 19 Clang / LLD / Make Wasm Toolchain (Async)     |                      |
|  |  - clang.wasm 19.1.0 (-cc1 wasm32-unknown-wasi)        |                      |
|  |  - lld.wasm 19.1.0 (-flavor wasm, Section 12 DataCount)|                      |
|  |  - memfs.wasm (WASI Preview 1, Dynamic Nodes)          |                      |
|  +------------------------------------+-------------------+                      |
|                                       |                                          |
|                                       v                                          |
|  +------------------------------------+------------------------------------------+
|  | Virtual File System (VFS - Single Source of Truth)                            |
|  | - /workspace (Read-Write, IndexedDB Sync, .zip Export/Import)                |
|  | - /usr/include & /include/wasm32-wasip1 (C/C++, graphics, turtle, raylib)     |
|  | - /usr/lib & /lib/wasm32-wasip1 (libc, libc++, compiler-rt, libturtle, raylib)|
|  | - /bin & /usr/bin (POSIX and Toolchain Binaries: gcc, g++, ar, make, etc.)   |
|  +-------------------------------------------------------------------------------+
+----------------------------------------------------------------------------------+
| Offline Engine: Unified PWA Service Worker (COOP/COEP & CacheStorage)            |
+----------------------------------------------------------------------------------+
```

---

## 3. Detailed Component Specifications

### 3.1 Code Editor Component
- **Engine**: Monaco Editor.
- **Implementation**: Pure Vanilla JS / DOM with standard ES modules.
- **Multi-File / Multi-Tab**: Tabbed interface corresponding to files under `/workspace`.
- **Dirty State Indicator**:
  - Unsaved modifications display a prominent dirty marker (`*` on tab).
  - **No Auto-Save**: Files MUST NOT auto-save on edit or build.
  - **Save Action**: Explicit `Ctrl+S` / `Cmd+S` or UI Save button writes content into the Virtual File System (VFS).
- **Build Pre-Condition Warning**:
  - If a user triggers "Compile Active File" or "Build" while any workspace file is dirty, show a non-blocking toast warning: `"Warning: File has unsaved changes. Build proceeds with last saved disk state."` (Does not block compilation, but never auto-saves).

### 3.2 Terminal & Shell Subsystem
- **Terminal Emulator**: `xterm.js` with `xterm-addon-fit`.
- **Shell**: Dedicated Web Worker running interactive POSIX-compatible shell.
  - **Built-in CLI Utilities**: `sh`, `ls`, `cd`, `pwd`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `clear`, `echo` (with `>` and `>>` output redirection), `which`, `pushd`, `popd`, and `dirs`.
  - **External Toolchain Dispatch**: External commands (`gcc`, `clang`, `g++`, `clang++`, `ar`, `wasm-ld`, `make`, `./a.out` or `./*`) are delegated to Wasm toolchain and runtime worker execution sandboxes.
  - **Interactive Features**: Interactive prompt (`$ ` with cwd display), command history (Up/Down arrows), autocompletion (Tab), line editing, and ANSI colors.
  - **Directory Stack & Navigation**:
    - `pushd <dir>`: Saves current working directory onto stack and navigates to target.
    - `pushd .`: Pushes current directory onto stack.
    - `pushd` (parameterless): Swaps current directory with top of directory stack.
    - `popd`: Pops the top directory from stack and restores working directory.
    - `dirs`: Displays current directory stack formatted with `~` representing `/workspace`.
    - `cd -`: Swaps to the previous working directory (`oldPwd`).
  - **Command Chaining & Operators**:
    - Supports sequential `;`, conditional `&&`, and conditional `||`, properly respecting quoted strings.
    - **Pipes (`|`)**: Supports multi-stage pipeline command chaining (`cmd1 | cmd2 | cmd3`), connecting stdout of stage $k$ to stdin of stage $k+1$ across both builtins and external binaries via deterministic sequential buffer staging.
    - **Stream Redirections (`<`, `>`, `>>`)**:
      - Output Redirection: `> target` (truncate/overwrite) and `>> target` (append) capture stdout of builtins and external commands to files in the VFS.
      - Input Redirection: `< source` feeds files from VFS directly into standard input (`./a.out < input.txt`, `cat < input.txt`).
    - **Standard Input Closure (`Ctrl-D` / EOF)**:
      - Pressing `Ctrl-D` (`\x04`) while standard input is active cleanly transmits End-of-File (EOF) to the executing process without terminating the process or shell.
    - **Direct Shell Script Execution**:
      - Executing `./<script>`, `/<path>/<script>`, or any file ending in `.sh` directly (such as `./build.sh` or `/workspace/build.sh`) is automatically detected by inspecting file contents or extension.
      - If the target begins with a shebang (`#!`) or ends with `.sh`, it executes via the shell runner (`builtins.sh`) without requiring explicit `sh ./build.sh`.
      - Non-script executable files dispatched to the runtime worker are verified against the WebAssembly magic number (`\0asm` / `[0x00, 0x61, 0x73, 0x6d]`), returning descriptive diagnostics if invalid bytes are encountered.
    - **Glob Pattern Expansion**:
      - Unquoted command arguments containing glob wildcards (`*`, `?`) are recursively expanded against the VFS file tree before command execution.
    - **File Operations (`mv` and `cp`)**:
      - Supports directory destinations (`mv a.out src/`), multi-source operands (`mv a.c b.c src/`), atomic file replacement, and recursive directory copying (`cp -r src backup/`).
- **UI Button Action Redirection & Working Directory Transparency**:
  - GUI action buttons (Compile, Build, Run, Stop) MUST NOT invoke hidden internal APIs.
  - Action buttons dynamically construct shell command sequences and inject them directly into `xterm.js` via `terminal.injectCommand(cmd)`.
  - **Directory Stack Preservation**:
    - **Compile**: `pushd . && cd /workspace && gcc -Iinclude -Wall -c <relPath> -o <objPath>; popd` (or `g++` when active project is in C++ mode)
    - **Build**: `pushd . && cd /workspace && make; popd` (or `pushd . && cd /workspace && sh build.sh; popd`)
    - **Run**: `pushd . && cd /workspace && ./a.out; popd`
  - The `; popd` delimiter ensures the user's working directory is always restored even when compilation or program execution fails with a non-zero exit code.

### 3.3 LLVM 19 C/C++ Toolchain & WASI Preview 1 Sysroot
- **Prebuilt Binaries & On-Demand Download**: Modern **Clang 19.1.0** and **wasm-ld 19.1.0** targeting **WASI Preview 1 (`wasm32-wasip1`)** compiled from upstream LLVM 19 releases via [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi), alongside native WASI Preview 1 `memfs.wasm` and [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi). Prebuilt binary files (`*.wasm`, `sysroot.tar.gz`, `libraylib.a`, and Raylib headers) are excluded from Git tracking and automatically fetched on demand during the build/install lifecycle via `scripts/download-sysroot.js`.
- **Compiler (`clang.wasm`)**:
  - LLVM 19.1.0 `-cc1` frontend mapped to commands `gcc`, `clang`, `g++`, and `clang++`.
  - Configured with target triple `-triple wasm32-unknown-wasi`.
  - In C++ mode or when invoked via `g++` / `clang++`, C++ compilation flags (`-x c++`, `-std=c++17`) and `libc++` linkage are automatically selected.
- **Linker (`lld.wasm`)**:
  - `wasm-ld` 19.1.0 mapped to handle object linking (`-flavor wasm`).
  - Native support for WebAssembly Section 12 (`DataCount`), modern relocation records (`R_WASM_TABLE_INDEX_REL_SLEB`, 64-bit table indices), and builtin compiler-rt runtime (`libclang_rt.builtins.a`).
  - Links standard libraries: `-lc -lclang_rt.builtins -lc++ -lc++abi`, `-lturtle` (or `-lturtle_canvas-wasi`), and conditionally `-lraylib` / `-lturtle_raylib`.
- **Static Archiver (`ar`)**:
  - Standard POSIX/BSD `ar` tool mounted under `/usr/bin/ar` and available in `which`, shell worker, and `make`.
  - Generates standard `!<arch>\n` archives with 60-byte headers and even-byte newline padding.
  - Automatically extracts defined, non-local symbols from member Wasm objects (subtype 8, `WASM_SYMBOL_TABLE` in `linking` custom section) and generates a big-endian symbol index compatible with LLVM 8 through LLVM 19 `wasm-ld`.
  - Supports GNU long filename tables (`//`) for member names exceeding 15 characters.
- **Sysroot & Standard Libraries (`sysroot.tar.gz`)**:
  - Bundles standard WASI Preview 1 sysroot (compressed to 30MB with gzip, decompressed on the fly via `DecompressionStream`) with headers mounted under `/usr/include`, `/include/wasm32-wasip1`, `/lib/clang/19/include`, and `/usr/include/c++/v1`.
  - Static libraries mounted under `/usr/lib` and `/lib/wasm32-wasip1`: `crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libclang_rt.builtins.a`, `libm.a`, `libpthread.a`, `libturtle.a`, `libturtle_canvas-wasi.a` (and `libturtle_raylib.a` when Raylib is enabled).
- **WebAssembly Shared Object (`.so`) Support**:
  - **Position-Independent Code (`-fPIC`, `-fpic`)**: Compiles position-independent code with `-mrelocation-model pic -pic-level 2`, emitting relocatable WebAssembly objects with dynamic relocation entries.
  - **Shared Library Generation (`-shared`, `--shared`)**: Links objects into WebAssembly dynamic libraries (`.so`) with `wasm-ld --shared`, omitting `crt1.o` and generating standard `dylink.0` dynamic linking custom sections. Shared libraries export functions and ctors (`__wasm_call_ctors`, `__wasm_apply_data_relocs`) while importing `env.memory`, `env.__memory_base`, and `env.__table_base`.
  - **Dynamic Linkage in Executables**: Programs link directly against `.so` files (e.g. `gcc main.c libmath.so -o a.out` or `-Bdynamic -L<dir> -l<name>`), producing executables containing `dylink.0` dynamic dependency records and `env.<symbol>` function imports.
  - **C & C++ Shared Libraries**: Full support for both C and C++ shared objects (`gcc -shared -fPIC ...`, `g++ -shared -fPIC ...`).
- **Comprehensive Compiler CLI Flag & Stage Support**:
  - **Preprocess Stage (`-E`)**: Preprocess source files without compiling or linking. Streams preprocessed output to `stdout` (or `-o <file>`). Supports piping and redirection (`gcc -E main.c > main.i`, `gcc -E main.c | grep foo`).
  - **Assembly Stage (`-S`)**: Compiles source files to WebAssembly text/assembly format (`.s`). Emits `<source_base>.s` or `-o <file>` (or `-o -` for stdout). Skips linking.
  - **Object Compilation Stage (`-c`)**: Compiles source files to `.o` object format (`<source_base>.o` or `-o <file>`). Skips linking.
  - **Full Build & Link Stage (Default)**: Compiles all input source files to `.o` and invokes `wasm-ld` with user objects, libraries, and runtime builtins into `a.out` (or `-o <target>`).
  - **Preprocessor & Include Options**: `-D<macro>`, `-U<macro>`, `-I<dir>`, `-isystem<dir>` resolved relative to working directory and passed directly to Clang.
  - **Optimization & Diagnostic Flags**: Optimization flags (`-O0`, `-O1`, `-O2`, `-O3`, `-Os`), warning controls (`-w`, `-Wall`, `-Wextra`, `-Werror`, `-pedantic-errors`), and verbose diagnostics (`-v`).
  - **Linker Flag Routing**: Search paths (`-L<dir>`), libraries (`-l<name>`), and linker options (`-Wl,...`) cleanly routed to `wasm-ld`.
- **Toolchain MemFS Lifecycle & Native WASI Preview 1 Invariants**:
  - `memfs.wasm` is maintained upstream in `breeze833/clang-wasi` and provided as an official release binary.
  - **Dynamic Node Allocation**: Scales beyond the legacy 1,024-node ceiling via dynamic reallocations (`Node** g_nodes`), mounting over 4,300 files without running out of inodes.
  - **Explicit Memory Deallocation & Zeroing on Unlink**: `DeleteNode` explicitly frees member buffers (`node->file.data`, `node->name`, `node->dir.dirents`) and zeroes out recycled node structures before placing them onto the free list, preventing buffer offset corruption.
  - **Safe Non-Trapping Lookups**: `FindNode` returns 0 for non-existent files rather than tripping `lookup.node` assertion traps.
  - **WASI Preview 1 Alignment**: Standard `__wasi_filestat_t` layout (`size` at offset 32), standard whence mapping (`0 = SET, 1 = CUR, 2 = END`), and `path_link` export prevent all struct alignment discrepancies.
  - **Defensive Unlink Invariant**: `MemFS.removeFile` truncates files to 0 bytes before unlinking (`AddFileNode(len, 0)` then `path_unlink_file`) as a defensive invariant.
- **Language Dialects**:
  - **Pure C Mode**: Automatically injects `-x c -std=c11 -pedantic-errors -Wall -Wextra`. Forbids C++ syntax extensions and disallows `#include <iostream>`, `<vector>`, etc.
  - **C++ Mode**: Injects `-x c++ -std=c++17 -Wall -Wextra` linking against `libc++`. Preferred wrapper command is `g++`.
- **Include Paths**: Default configuration includes `/workspace/include`, `/workspace`, `/usr/include`, `/include/wasm32-wasip1`, `/lib/clang/19/include`, and `/usr/include/c++/v1`.

### 3.4 Build Systems (Dual-Track Mechanism) & Project Settings
Users can select between two build strategies in the Project Settings UI:
1. **Decoupled Settings Modal Actions**:
   - **Save Button**: Persists configuration state (mode, build system, compiler flags, include paths, target name, and Raylib toggle) and dynamically mounts/unmounts sysroot headers and libraries without overwriting existing files in `/workspace`.
   - **Generate Build Script Button**: Scans source files in `/workspace` and generates or updates `/workspace/build.sh` and `/workspace/Makefile`.
2. **Track 1: Shell Script (`build.sh`)**:
   - The UI generates `/workspace/build.sh` reflecting compiler command (`gcc` in Pure C mode, `g++` in C++ mode), compiler flags, source files, and output paths.
   - When Raylib is enabled, `-lraylib` is automatically included in the final link command.
   - Triggering "Build" injects `pushd . && cd /workspace && sh build.sh; popd` to the terminal.
3. **Track 2: Makefile & Incremental Make**:
   - The UI generates a standard `/workspace/Makefile` defining explicit targets (`all`, `clean`, `%.o: %.c` or `%.o: %.cpp`) using `CC = gcc` in Pure C mode and `CXX = g++` in C++ mode.
   - When Raylib is enabled, `LDFLAGS += -lraylib` is automatically configured.
   - Incremental Makefile runner evaluates file modification timestamps (`mtime`) to rebuild only stale prerequisites.
   - Triggering "Build" injects `pushd . && cd /workspace && make; popd` to the terminal.

### 3.5 Runtime & Interactive Standard I/O
- Target binaries run in a dedicated Web Worker instance with WASI Preview 1 emulation.
- **Monotonic Clock**: `clock_time_get` implemented in `AppInstance` providing high-resolution monotonic timestamps.
- **Standard Input (`stdin`) Handling**:
  - **Interactive Blocking Input**: Handled via `SharedArrayBuffer` and `Atomics.wait()`. When the runtime executes WASI `fd_read` on file descriptor 0, the worker pauses without blocking the browser main UI thread until `xterm.js` receives user input and signals `SharedArrayBuffer` via `Atomics.notify()`.
  - **Non-Interactive Stream Redirection**: When stdin is redirected from a file (`<`) or pipeline (`|`), input bytes are preloaded into memory and consumed synchronously by `fd_read` without entering `Atomics.wait()`.
  - **End-of-File Signaling (`Ctrl-D` / `\x04`)**:
    - Pressing `Ctrl-D` (`\x04`) in `xterm.js` while input is pending flushes existing buffer content or signals `STATE_EOF` (`-1`) to `SharedArrayBuffer`.
    - `Atomics.notify()` immediately resumes the waiting worker.
    - WASI `fd_read` sets `*nread = 0` and returns `ESUCCESS` (0), allowing standard C library functions (`scanf`, `getchar`, `fgets`, `cin`) to recognize EOF and terminate input loops cleanly.
- **Execution Interruption**:
  - `Ctrl+C` in the terminal or GUI "Stop" button immediately issues worker interruption/termination, closes/resets the graphical window, and resets terminal state.

### 3.6 Virtual File System (VFS) & Storage
- Single Source of Truth shared across Editor, Shell Worker, and Toolchain.
- **Directory Layout**:
  - `/workspace`: Root of the user project (Read-Write, persisted in IndexedDB).
  - `/usr/include` & `/include/wasm32-wasip1`: Read-only sysroot standard C and C++ headers, `graphics.h`, `graphics_canvas.h`, `turtle.h`, and `turtle_backend_canvas_wasi.h`. When Raylib is enabled, also contains `raylib.h`, `raymath.h`, `rlgl.h`, and `turtle_backend_raylib.h`.
  - `/usr/lib` & `/lib/wasm32-wasip1`: Read-only static runtime archives (`crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libclang_rt.builtins.a`, `libm.a`, `libpthread.a`, `libturtle.a`, `libturtle_canvas-wasi.a`). When Raylib is enabled, also contains `libraylib.a` and `libturtle_raylib.a`.
  - `/bin`: Read-only POSIX utilities (`sh`, `ls`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `pwd`, `clear`, `echo`, `pushd`, `popd`, `dirs`).
  - `/usr/bin`: Read-only toolchain binaries (`gcc`, `clang`, `g++`, `clang++`, `ar`, `make`, `wasm-ld`).
- **Persistence**: Synchronized with browser `IndexedDB`. Survives page refreshes.
- **Import / Export**:
  - Export: Bundles `/workspace` exclusively into a standard `.zip` archive downloaded to the client.
  - Import: Extracts a user `.zip` archive directly into `/workspace`. System files outside `/workspace` cannot be overwritten.

### 3.7 Static Hosting, Security Isolation & Offline PWA Capabilities
- **Cross-Origin Isolation**:
  - `SharedArrayBuffer` requires:
    - `Cross-Origin-Opener-Policy: same-origin`
    - `Cross-Origin-Embedder-Policy: require-corp`
- **GitHub Pages / Zero-Config Static Server Compatibility & Unified PWA Service Worker**:
  - Bundles `coi-serviceworker.js` in `public/` providing Cross-Origin Isolation header injection across static hosting environments and `CacheStorage` offline caching.
- **Progressive Web App (PWA) & Offline Execution**:
  - `manifest.webmanifest` defining standalone display, theme colors, and icons.
  - Enables 100% offline development: cached toolchain and Raylib assets execute locally without network access.

### 3.8 Generic Graphics Subsystem & Dedicated Graphical Console
- **Modular Subsystem Package (`canvas-wasi`)**:
  - The generic graphics console, HTML5 Canvas 2D vector primitives, window control, input coordination, and WebAssembly host bindings are decoupled into an independent, zero-dependency package: [`breeze833/canvas-wasi`](https://github.com/breeze833/canvas-wasi) (consumed via `"canvas-wasi": "github:breeze833/canvas-wasi"`).
  - `wasm-c-ide` mounts system headers directly from `canvas-wasi/headers`, instantiates host imports in `runtime.worker.js` via `createGraphicsImports` from `canvas-wasi/worker`, and renders the UI via `GraphicsWindowUI` from `canvas-wasi`.
- **Framework-Agnostic Presentation Layer**: The graphical console operates independently of any specific graphics framework, displaying zero-copy `ImageBitmap` frames on `<canvas id="graphics-canvas">` (and popup canvas `<canvas id="graphics-popup-canvas">`) via `ImageBitmapRenderingContext`.
- **Generic Framebuffer C API (`/usr/include/graphics.h`)**:
  - Mounted by default in sysroot for all C/C++ projects without requiring external dependencies or compiler flags.
  - Minimal, educational API functions:
    - `void graphics_init(int width, int height, const char *title)`: Opens graphical window at requested dimensions.
    - `void graphics_present(const uint32_t *pixels)`: Presents a 32-bit RGBA pixel framebuffer to the display.
    - `void graphics_present_rgba(const uint8_t *rgba, int width, int height)`: Presents arbitrary-sized byte buffers.
    - `bool graphics_should_close(void)`: Polls window close status.
    - `void graphics_close(void)`: Closes the graphics window.
    - `void graphics_wait_frame(int target_fps)`: Synchronizes frame pacing using `Atomics.wait()`.
    - `void graphics_get_mouse(int *x, int *y, int *buttons, int *wheel)`: Reads mouse coordinates, button states, and wheel delta.
    - `bool graphics_is_key_down(int key)`: Inspects active keyboard key states.
- **Enhanced 2D Vector Canvas C API (`/usr/include/graphics_canvas.h`)**:
  - Includes `<graphics.h>` and provides high-level 2D vector drawing primitives backed by the browser's native `OffscreenCanvas` 2D context (`CanvasRenderingContext2D`).
  - Supported APIs:
    - Frame swap: `void canvas_present(void)`: Renders 2D canvas drawing to the display.
    - Rectangles: `canvas_clear_rect`, `canvas_fill_rect`, `canvas_stroke_rect`.
    - Paths & Arcs: `canvas_begin_path`, `canvas_close_path`, `canvas_move_to`, `canvas_line_to`, `canvas_arc`, `canvas_fill`, `canvas_stroke`.
    - Styles & Line: `canvas_set_fill_style`, `canvas_set_stroke_style`, `canvas_set_fill_rgb`, `canvas_set_line_width`, `canvas_set_line_cap`.
    - Typography: `canvas_fill_text`, `canvas_stroke_text`, `canvas_set_font`.
    - Matrix Transforms: `canvas_save`, `canvas_restore`, `canvas_translate`, `canvas_rotate`, `canvas_scale`.
    - Pixel-Level Manipulation & Framebuffer Interop: `canvas_get_image_data`, `canvas_put_image_data`, `canvas_get_pixels`, `canvas_put_pixels`, `canvas_get_pixel`, `canvas_set_pixel`. Bridged directly to `CanvasRenderingContext2D` (`getImageData` / `putImageData`) and WebAssembly linear memory (`memoryInstance.buffer`).
- **Modular Opt-In Game Engine (`raylib-wasi`)**:
  - Decoupled Raylib 5.5 integration via [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi) without Emscripten, compiled with LLVM 19.
  - Zero-ad-hoc host architecture: `wasm-c-ide` imports `createRaylibHost` directly from the `raylib-wasi` package, eliminating internal WebGL state dispatchers and handle tables from the IDE codebase.
  - Standardized C headers (`raylib.h`, `raymath.h`, `rlgl.h`) are mounted into `/usr/include` and `/include/wasm32-wasip1`, populated via `scripts/download-sysroot.js` or the module distribution.
  - Precompiled static library `libraylib.a` is distributed as a GitHub Release asset and downloaded on demand via `scripts/download-sysroot.js`. Zero binary `.a` or `.wasm` files and zero upstream header copies are committed to the IDE or toolchain Git repositories.
  - Shares the identical runtime graphics protocol (`graphics_init`, `frame`, `fps`, `graphics_close`) with the unified `GraphicsWindowUI` from `canvas-wasi`.
- **Synchronous Zero-Copy Frame Delivery**:
  - Eliminates microtask starvation in synchronous WebAssembly interactive game loops (`while (!graphics_should_close())`). Because the Web Worker call stack never unwinds during synchronous execution, Promise-based APIs (`createImageBitmap().then(...)`) cannot fire.
  - `presentBuffer` and `canvas_present` in `runtime.worker.js` invoke `offscreen2d.transferToImageBitmap()`, generating an `ImageBitmap` **synchronously** without Promises.
  - The bitmap is transferred immediately via `self.postMessage({ type: 'frame', bitmap }, [bitmap])` to the main UI thread, where `ImageBitmapRenderingContext.transferFromImageBitmap` presents it with zero copy.
  - In environments where 2D `transferToImageBitmap` is unavailable, `presentBuffer` falls back to transferring the raw pixel buffer synchronously via `self.postMessage({ type: 'frame_buffer', buffer, width, height }, [buffer])` for immediate rendering on the main thread.
- **Dual-Channel Input Coordination & Memory Safety**:
  - Coordinates mouse position, buttons, wheel deltas, and keystrokes using a 512-byte `SharedArrayBuffer` for zero-latency cross-thread synchronization.
  - `graphics_get_mouse` writes coordinates, button bitmasks, and wheel states into WebAssembly linear memory using `DataView.setInt32` / `DataView.setUint32` with explicit little-endian encoding, guaranteeing strict byte-alignment safety across Wasm memory growth boundaries (`malloc`/`calloc`).
  - Supports clean mouse hover state: pointer coordinates initialize and reset to `(-1, -1)` on blur or `mouseleave`, ensuring hover indicators only render when the pointer actively resides within canvas bounds.
  - When running in a decoupled or non-isolated context, forwards an event stream (`postMessage({ type: 'input_event', event })`) as a seamless fallback.
- **Dedicated Graphical Console & Window Ergonomics**:
  - Floating, draggable, resizable in-page window (`#graphics-canvas`) running alongside `xterm.js`.
  - Dynamic resolution adaptation based on `graphics_init(width, height, title)` or `InitWindow(width, height, title)`.
  - Zero-copy GPU frame transfer (`ImageBitmap` / WebGL) rendered at a fluid 60 FPS.
  - Real-time FPS counter and resolution badge.
  - Pop-Out (`↗`) to external browser window (`#graphics-popup-canvas`) with auto-focus and full keyboard event capture (`windowTarget`), and clean Dock (`↙`) back.
  - Frame pacing via `Atomics.wait()` in `graphics_wait_frame` based on target FPS.
  - **Background Frame Activity Indicator**:
    - The `[🎮 Canvas]` toolbar button is permanently accessible in the top header.
    - When new frames are presented while the graphics window is closed or minimized, the canvas button activates a pulsating green indicator dot and tooltip alert (`Canvas (New frames rendering in background - Click to show)`), notifying the user without forcefully popping up or occluding terminal inspection.
    - Automatically clears when the user opens the window, un-minimizes the window, or when process execution terminates.
- **Interactive Educational Examples Suite (`/examples/`)**:
  - Bundled single-file C examples for immediate manual testing and demonstration:
    - `01_stdio.c`: Interactive console standard I/O (menu navigation, Fibonacci, Factorial, Prime check) configured with unbuffered stdout (`setbuf(stdout, NULL)`) and immediate prompt flushing (`fflush(stdout)`).
    - `02_raylib_interactive.c`: Raylib 5.5 GLES2 interactive demo with mouse tracking, bouncing balls on mouse click, and arrow-key/WASD box movement.
    - `03_framebuffer_graphics.c`: Pure C direct software framebuffer (`<graphics.h>`) rendering a 60 FPS procedural plasma via 512-entry sine lookup table, glowing hover cursor dot, persistent white paint strokes layer on click/drag, and 'C'/Space canvas clearing.
    - `04_canvas_vector.c`: HTML5 2D vector canvas demo (`<graphics_canvas.h>`) rendering anti-aliased geometry, orbiting shapes with matrix transformations (`canvas_rotate`, `canvas_scale`), drop shadows, and typography.
    - `05_canvas_pixels.c`: HTML5 Canvas 2D pixel manipulation & image processing demo (`<graphics_canvas.h>`) combining vector scene underlay with direct pixel access and 2D spatial convolution filters in pure C (Sobel edge detection gradient filter, 3x3 box blur, grayscale & contrast adjustment, color inversion, and interactive mouse spotlight lens).
    - `06_turtle_canvas.c`: Progressive turtle graphics demo using the default canvas-wasi backend (`<turtle.h>`, `<turtle_backend_canvas_wasi.h>`) drawing a multi-colored animated star spiral with stylized turtle cursor.
    - `07_turtle_raylib.c`: Progressive turtle graphics demo using the Raylib backend (`<turtle.h>`, `<turtle_backend_raylib.h>`) drawing a geometric rosette pattern.
    - `README.md`: Step-by-step user compilation and running guide for all examples.

### 3.9 Turtle Graphics Subsystem (`libturtle`)
- **Modular Educational Turtle Architecture**:
  - Decouples high-level geometric navigation logic from rasterization backends using a Hardware Abstraction Layer (HAL) specified in [`breeze833/libturtle`](https://github.com/breeze833/libturtle).
  - Mathematical Cartesian Coordinates:
    - Viewport center is $(0.0, 0.0)$.
    - $+X$ points East (Right), $+Y$ points North (Up).
    - Default heading is $90.0^\circ$ (pointing North).
    - Rotation angles follow standard math conventions: counter-clockwise (CCW) is positive.
    - Double-precision coordinates and angles prevent cumulative floating-point drift.
  - Packed 32-bit RGBA integer colors (`0xRRGGBBAA`) and standard palette macros (`TURTLE_BLACK`, `TURTLE_RED`, `TURTLE_GREEN`, `TURTLE_BLUE`, `TURTLE_YELLOW`, `TURTLE_MAGENTA`, `TURTLE_CYAN`, `TURTLE_WHITE`).
  - Progressive drawing and frame animation via `turtle_delay(double ms)`.
  - Stylized turtle cursor with carapace, flippers, head, and eyes, rendered non-destructively without corrupting canvas art.
- **Dual Backend Integration**:
  1. **Canvas-WASI Backend (`libturtle_canvas-wasi.a` / `libturtle.a`)**:
     - **Enabled by Default**: Because `<graphics_canvas.h>` and `<graphics.h>` are always available in the sysroot, the `canvas-wasi` backend is mounted and available out of the box.
     - Headers: `<turtle.h>` and `<turtle_backend_canvas_wasi.h>` mounted in `/usr/include`.
     - Static Library: Mounted as `/usr/lib/libturtle.a` and `/usr/lib/libturtle_canvas-wasi.a`.
     - Link Command: Programs link with `-lturtle` (e.g. `gcc main.c -lturtle`).
     - Driven by native `OffscreenCanvas` 2D context via `canvas-wasi` bridge.
  2. **Raylib Backend (`libturtle_raylib.a`)**:
     - **Opt-in / Dynamically Mounted**: When Raylib graphics support is enabled in Project Settings, the Raylib turtle backend is mounted alongside Raylib sysroot assets.
     - Headers: `<turtle_backend_raylib.h>` mounted in `/usr/include`.
     - Static Library: Mounted as `/usr/lib/libturtle_raylib.a`.
     - Link Command: Programs link with `-lturtle_raylib -lraylib`.
     - Unmounting Raylib in Project Settings cleanly unmounts `<turtle_backend_raylib.h>` and `libturtle_raylib.a` from both VFS and MemFS.
- **Build Scripts Linking Rules (`build.sh` & `Makefile`)**:
  - `(1)` Raylib disabled && `turtle_backend_canvas_wasi.h` included $\implies$ `-lturtle`
  - `(2)` Raylib enabled && `turtle_backend_canvas_wasi.h` included $\implies$ `-lturtle`
  - `(3)` Raylib enabled && `turtle_backend_raylib.h` included $\implies$ `-lturtle_raylib -lraylib`

---

## 4. UI Layout & User Experience

```
+-----------------------------------------------------------------------------------------+
| [Header] App Title | Mode: [Pure C | C++] | Raylib: [ON] | Build System: [sh | make]     |
| [Actions] [💾 Save] [⚙ Compile] [🔨 Build] [▶ Run] [⏹ Stop] | [🎮 Canvas] [⚙ Settings]  |
|                                                                  [📲 Install PWA (opt)] |
+-----------------------+-----------------------------------------------------------------+
| Workspace File Tree   | Editor Tabs: [main.c *] [calc.c]                    [- 14px +]  |
| [📄+] [📁+] [📥] [📤]   +---------------------------------------------------------------+
| - src/                | 1 | #include "raylib.h"                                         |
|   - main.c            | 2 | int main(void) {                                            |
| - build/              | 3 |   InitWindow(640, 480, "Ball Demo");                        |
|   - main.o            | 4 |   while (!WindowShouldClose()) { ... }                      |
| - a.out               | 5 | }                                                           |
| - Makefile            +-----------------------------------------------------------------+
|                       | Integrated Terminal (xterm.js)                      [- 13px +]  |
|                       | ide:~$ pushd . && cd /workspace && make; popd                   |
|                       | ide:~$ ./a.out                                                  |
+-----------------------+-----------------------------------------------------------------+
                                      |
                                      v (Opens automatically on InitWindow)
                        +---------------------------------------+
                        | [🎮] Ball Demo (640x480) [60 FPS] [↗][X]|
                        | +-----------------------------------+ |
                        | |                                   | |
                        | |         🔴 (WebGL Canvas)         | |
                        | |                                   | |
                        | +-----------------------------------+ |
                        +---------------------------------------+
```

---

## 5. Non-Functional Requirements
- **Bundle Size Optimization**: Toolchain and Raylib assets lazy-loaded with clear progress indicators.
- **Clean Browser Compatibility**: Operable on recent Chromium, Firefox, and Safari (Safari 15.2+ supporting `SharedArrayBuffer` and `ImageBitmapRenderingContext`).
- **No Remote Telemetry**: Strict local client execution; zero remote dependencies.
- **Sub-Path Hosting Compatibility**: Ready for zero-config sub-directory hosting without hardcoded absolute URLs.
- **Main-Thread Asynchronous Wasm Compilation**: Zero synchronous instantiation of Wasm modules >8MB on the main thread.
- **100% Offline Autonomy**: Full offline PWA execution with Cache-First Service Worker precaching App Shell, Wasm toolchain, and Raylib distribution assets.

---

## 6. Verification & Testing Checklist

| Test Case | Expected Behavior |
|---|---|
| **LLVM 19 Pure C Compilation** | `gcc -x c -std=c11 -pedantic-errors -Wall -c main.c` compiles C code strictly with Clang 19. |
| **LLVM 19 C++ Compilation** | `g++ -std=c++17 main.cpp` compiles C++ code linking against `libc++` and `libc++abi`. |
| **WebAssembly Section 12 Linkage** | `wasm-ld` 19 links relocatable objects containing Section 12 (`DataCount`) without section errors. |
| **Compiler Runtime Builtins** | Symbols required by Clang 19 WebAssembly operations resolve cleanly via `libclang_rt.builtins.a`. |
| **MemFS Capacity & Dynamic Nodes** | Extracting `sysroot.tar.gz` (4,300+ entries) completes without inode exhaustion or allocation errors. |
| **MemFS File Deletion & Recompile** | Deleting `.o` files and recompiling begins writing at byte offset 0 with valid `\0asm` headers. |
| **Raylib 5.5 Compilation & Linking** | Programs using `InitWindow` link with `-lraylib` and run in the runtime worker without undefined symbols. |
| **Generic Framebuffer Compilation** | Programs using `<graphics.h>` compile with standard Pure C mode without external link flags. |
| **Generic Framebuffer Rendering** | Passing pixel buffers to `graphics_present` transfers `ImageBitmap` frames to `#graphics-canvas`. |
| **2D Vector Canvas Compilation & Drawing** | Programs using `<graphics_canvas.h>` compile in pure C and render vector paths, shapes, and typography via OffscreenCanvas 2D context. |
| **Canvas Pixel Manipulation & Image Processing** | Programs using `canvas_get_pixels`, `canvas_put_pixels`, `canvas_get_image_data`, `canvas_put_image_data`, `canvas_get_pixel`, and `canvas_set_pixel` directly inspect and modify canvas raster memory in pure C. |
| **Interactive Canvas Window** | Calling `graphics_init(w, h, title)` or `InitWindow(w, h, title)` opens Graphical Console at requested dimensions. |
| **Zero-Copy Frame Rendering** | Shapes and text render to canvas at ~60 FPS via `ImageBitmap` without main UI thread lag. |
| **Concurrent Terminal I/O** | `printf` and `scanf` in the same program interact with `xterm.js` while graphics render on the canvas. |
| **Compiler Preprocessing (`gcc -E`)** | `gcc -E main.c` streams preprocessed output to terminal or `main.i` via `-o` without linking. |
| **Compiler Assembly (`gcc -S`)** | `gcc -S main.c` compiles to WebAssembly assembly text (`main.s` or `-o <file>`) without linking. |
| **Compiler Macros & Diagnostics (`-D`, `-v`)** | Macros defined via `-D` substitute cleanly; `-v` prints verbose toolchain invocations and search paths. |
| **Static Archiver Creation (`ar rcs`)** | `ar rcs libmath.a add.o sub.o` generates compliant `!<arch>\n` archive with big-endian symbol index. |
| **Static Archiver Linkage (`wasm-ld`)** | Programs link against generated `.a` archives using `-Lworkspace -lmath` or direct file path `workspace/libmath.a`. |
| **Shared Object Creation (`gcc -shared`)** | `gcc -shared -fPIC math.c -o libmath.so` produces valid WebAssembly shared library with `dylink.0` section. |
| **Shared Object Linkage (`gcc main.c libmath.so`)** | Executable links against `.so`, generating `dylink.0` dynamic dependency records and `env.<symbol>` imports. |
| **Shared Object Runtime Execution** | Executable dynamically loads and executes functions from `.so` at runtime without unresolved symbol traps. |
| **C++ Shared Object (`g++ -shared -fPIC`)** | C++ code compiles to position-independent `.so` and exports `extern "C"` functions cleanly. |
| **Interactive `scanf` & `Ctrl-D` EOF** | Stdin blocks via `SharedArrayBuffer` until Enter; `Ctrl-D` triggers EOF cleanly. |
| **Pipelines & Redirections** | Command pipelines (`|`) and stream redirections (`<`, `>`, `>>`) execute deterministically across stages. |
| **Direct Shell Script Execution** | `./build.sh` or `/workspace/script.sh` executes shell commands without manual `sh` prefix. |
| **Synchronous Frame Delivery** | `transferToImageBitmap()` delivers frames synchronously without Promise starvation in Wasm loops. |
| **Background Activity Indicator** | Presenting frames while window is minimized/hidden activates green pulsating dot on `[🎮 Canvas]` button. |
| **Dual-Channel Input Coordination** | Mouse movement, clicks, and keys synchronize via `SharedArrayBuffer` with message fallback and `DataView` byte safety. |
| **Example Programs Suite** | `01_stdio.c`, `02_raylib_interactive.c`, `03_framebuffer_graphics.c`, `04_canvas_vector.c`, `05_canvas_pixels.c`, `06_turtle_canvas.c`, and `07_turtle_raylib.c` compile and run without error. |
| **Canvas Turtle Graphics (`-lturtle`)** | Programs using `<turtle.h>` and `<turtle_backend_canvas_wasi.h>` compile by default and animate with `turtle_delay()`. |
| **Raylib Turtle Graphics (`-lturtle_raylib`)** | Enabling Raylib mounts `<turtle_backend_raylib.h>` and `libturtle_raylib.a`, compiling and rendering in Raylib mode. |
| **Turtle Sysroot Dynamic Unmount** | Disabling Raylib unmounts `<turtle_backend_raylib.h>` and `libturtle_raylib.a` from VFS and MemFS cleanly. |
| **Raylib Module Decoupling** | `wasm-c-ide` imports `createRaylibHost` directly from `raylib-wasi` without local `src/toolchain/raylib-host.js`. |
| **Raylib Sysroot Headers Mounting** | Standard C headers (`raylib.h`, `raymath.h`, `rlgl.h`) mount into VFS dynamically when Raylib is enabled in Project Settings. |
| **Raylib Input Coordination Interop** | Raylib execution coordinates inputs through shared `InputCoordinator` across `GraphicsWindowUI` and worker `WasiInputState`. |
| **Offline PWA Operation** | LLVM 19 toolchain and Raylib assets execute while disconnected from the internet via Service Worker caching. |

