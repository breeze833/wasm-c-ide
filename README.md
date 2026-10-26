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
  - [Interactive Educational Examples Suite](#8-interactive-educational-examples-suite)
  - [Virtual File System & Storage](#9-virtual-file-system--storage)
  - [Progressive Web App (PWA) & Offline Execution](#10-progressive-web-app-pwa--offline-execution)
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
- **Collapsible File Tree**: Hierarchical folder tree with inline file and directory creation, deletion, and file opening.

### 2. Interactive POSIX Shell & Terminal
- **xterm.js Terminal**: Embedded terminal emulator with ANSI colors, line wrapping, and dynamic window resizing.
- **Interactive Shell Worker**:
  - POSIX utilities: `sh`, `ls`, `cd`, `pwd`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `clear`, `echo` (with `>` and `>>` redirection), and `which`.
  - **Directory Stack**: Full support for `pushd`, `popd`, `dirs`, and `cd -`.
  - **Command Chaining & Pipelines**: Supports `;`, `&&`, `||`, and sequential stream pipelines (`|`).
  - **Stream Redirections**: File input (`<`) and output (`>`, `>>`) across builtins and external binaries.
  - **Direct Script Execution**: Run `./build.sh` or `/workspace/script.sh` directly without requiring explicit `sh` prefix. Shebang (`#!`) and `.sh` scripts are executed automatically.
  - **Interactive EOF (`Ctrl-D`)**: Flushes buffer or signals EOF to input loops (`scanf`, `cin`, `getchar`).
  - **Glob Pattern Expansion**: Expands `*` and `?` wildcards against the VFS file tree (e.g., `ls build/*`, `gcc src/*.c`).
  - **Advanced File Operations**: `mv` and `cp` support directory destinations (`mv a.out src/`), multi-source operands (`mv a.c b.c src/`), atomic file replacement, and recursive directory copying (`cp -r src backup/`).
- **Transparent Working Directory Preservation**:
  - UI action buttons inject transparent directory stack commands into the terminal:
    - **Compile**: `pushd . && cd /workspace && gcc -Iinclude -Wall -c src/main.c -o build/main.o; popd`
    - **Build**: `pushd . && cd /workspace && make; popd` (or `sh build.sh`)
    - **Run**: `pushd . && cd /workspace && ./a.out; popd`
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
  - Dynamic linking: Link executables against `.so` shared libraries directly (`gcc src/main.c build/libmath.so -o a.out`) or via dynamic library search paths (`-Bdynamic -Lbuild -lmath`).
- **Native WASI Preview 1 MemFS Layer**: Built upstream in `clang-wasi` with dynamic node allocation supporting 4,300+ standard library files, explicit deallocation on unlink, standard WASI Preview 1 struct alignment, and safe non-trapping lookups.

### 4. Dual Build Systems (Shell Script & Makefile)
- **Track 1: Shell Script (`build.sh`)**:
  - Generates `/workspace/build.sh` reflecting active compiler flags, include directories, and output binaries.
- **Track 2: Standard Makefile (`Makefile`)**:
  - Generates a modular Makefile with `all`, `clean`, and pattern rules (`%.o: %.c`).
  - Built-in incremental `make` engine checks modification timestamps (`mtime`) against prerequisites to avoid redundant rebuilds.
- **Project Settings Modal**:
  - Decoupled **Save** and **Generate Build Script** buttons: save configuration and toggle sysroots without clobbering existing files in `/workspace`.
  - Configure language mode, include directories, compiler warning flags, default build track, target binary name, and optional Raylib graphics.

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
  - The generic graphics console, HTML5 Canvas 2D vector primitives, window control, input coordination, and WebAssembly host bindings are decoupled into the standalone zero-dependency package [`breeze833/canvas-wasi`](https://github.com/breeze833/canvas-wasi) (available via `github:breeze833/canvas-wasi`).
- **Framework-Agnostic Display**: Operates independently of any single graphics engine, displaying zero-copy `ImageBitmap` frames on `<canvas id="graphics-canvas">` via `ImageBitmapRenderingContext`.
- **Direct Software Framebuffer C API (`<graphics.h>`)**:
  - Mounted by default in `/usr/include/graphics.h` for all standard C projects with zero external flags or dependencies.
  - Minimal API: `graphics_init(w, h, title)`, `graphics_present(pixels)`, `graphics_present_rgba(rgba, w, h)`, `graphics_wait_frame(fps)`, `graphics_get_mouse(&x, &y, &btn, &wheel)`, `graphics_is_key_down(key)`, `graphics_should_close()`, `graphics_close()`.
  - Enables writing direct pixel software renderers, fractal generators, and retro plasma demos in pure C.
- **Enhanced HTML5 Canvas 2D Vector & Pixel C API (`<graphics_canvas.h>`)**:
  - Direct C bridge to the browser's native `OffscreenCanvas` 2D context (`CanvasRenderingContext2D`).
  - Vector primitives: `canvas_fill_rect`, `canvas_stroke_rect`, `canvas_clear_rect`, `canvas_arc`, `canvas_begin_path`, `canvas_fill`, `canvas_stroke`, `canvas_set_fill_style`, `canvas_set_stroke_style`, `canvas_fill_text`, `canvas_set_font`, `canvas_save`, `canvas_restore`, `canvas_rotate`, `canvas_scale`, `canvas_present`.
  - Pixel manipulation & framebuffer interop: `canvas_get_pixels`, `canvas_put_pixels`, `canvas_get_image_data`, `canvas_put_image_data`, `canvas_get_pixel`, `canvas_set_pixel` for direct pixel-level reading, writing, and 2D image processing filter implementation.
- **Opt-In Raylib 5.5 Game Engine (`raylib-wasi`)**:
  - Full-featured 2D/3D GLES2/WebGL game engine integration decoupled into the standalone package [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi) without Emscripten, compiled natively with LLVM 19.
  - Zero ad-hoc host dispatchers: WebGL ES 2.0 state machine, handle tables, and Wasm runtime imports (`gl`, `raylib`) are imported directly from `raylib-wasi`.
  - Shares the 512-byte `SharedArrayBuffer` `InputCoordinator` and floating/dockable `GraphicsWindowUI` with `canvas-wasi`.
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
     - **Opt-In / Dynamically Mounted**: Mounted when Raylib graphics support is enabled in Project Settings (`/usr/include/turtle_backend_raylib.h`, `/usr/lib/libturtle_raylib.a`).
     - Links with `-lturtle_raylib -lraylib`.
     - Unmounting Raylib in Project Settings cleanly unmounts `<turtle_backend_raylib.h>` and `libturtle_raylib.a` from both VFS and MemFS.
- **Automatic Build Script Linking Rules**:
  - When generating `build.sh` or `Makefile`, the IDE automatically detects backend headers:
    - Raylib disabled && `turtle_backend_canvas_wasi.h` included $\implies$ `-lturtle`
    - Raylib enabled && `turtle_backend_canvas_wasi.h` included $\implies$ `-lturtle`
    - Raylib enabled && `turtle_backend_raylib.h` included $\implies$ `-lturtle_raylib -lraylib`

### 8. Interactive Educational Examples Suite
The repository includes a ready-to-run suite of single-file C programs in the `examples/` directory for manual testing and pedagogical demonstration:
- **`01_stdio.c`**: Interactive console standard I/O (menu navigation, Fibonacci generator, Factorial, Prime tester) configured with unbuffered stdout (`setbuf(stdout, NULL)`) and prompt flushing (`fflush(stdout)`).
- **`02_raylib_interactive.c`**: Raylib 5.5 GLES2 interactive demo with mouse position tracking, bouncing balls on mouse click, and keyboard-controlled box movement.
- **`03_framebuffer_graphics.c`**: Pure C direct software framebuffer (`<graphics.h>`) rendering a 60 FPS procedural plasma via a 512-entry sine lookup table, glowing hover cursor dot, persistent white paint strokes layer on click/drag, and 'C'/Space canvas clearing.
- **`04_canvas_vector.c`**: HTML5 2D vector canvas demo (`<graphics_canvas.h>`) rendering anti-aliased geometry, orbiting shapes with matrix transformations (`canvas_rotate`, `canvas_scale`), drop shadows, and typography.
- **`05_canvas_pixels.c`**: HTML5 Canvas 2D pixel manipulation & image processing demo (`<graphics_canvas.h>`) combining vector scene underlay with direct pixel access and 2D spatial convolution filters in pure C (Sobel edge detection gradient filter, 3x3 box blur, grayscale & contrast adjustment, color inversion, and interactive mouse spotlight lens).
- **`06_turtle_canvas.c`**: Progressive turtle graphics demo using the default canvas-wasi backend (`<turtle.h>`, `<turtle_backend_canvas_wasi.h>`) drawing a multi-colored animated star spiral with stylized turtle cursor.
- **`07_turtle_raylib.c`**: Progressive turtle graphics demo using the Raylib backend (`<turtle.h>`, `<turtle_backend_raylib.h>`) drawing a geometric rosette pattern.
- **`examples/README.md`**: Step-by-step user compilation and running guide for each example.

### 9. Virtual File System & Storage
- **In-Memory VFS**: Fast hierarchical tree representation shared across the editor, shell, toolchain, and runtime execution worker.
- **IndexedDB Persistence**: Automatically persists `/workspace` across browser sessions and page refreshes.
- **Bidirectional Runtime Synchronization**: Changes made to `/workspace` files via C/C++ `fopen`/`fwrite`/`fputs` or C++ `<fstream>` automatically sync back to VFS in real-time and persist to IndexedDB, updating the file tree and editor tabs.
- **Zip Import & Export**: One-click export of `/workspace` into a standard `.zip` file using JSZip, and direct zip unpacking into the workspace.
- **Sysroot Protection**: Read-only protection on system root paths (`/usr`, `/bin`), pre-mounting standard C/C++ headers (`<stdio.h>`, `<stdlib.h>`, `<iostream>`, `<fstream>`, etc.), `<graphics.h>`, `<graphics_canvas.h>`, `<turtle.h>`, and runtime static libraries (`libc.a`, `libturtle.a`, and conditionally `libraylib.a`).

### 10. Progressive Web App (PWA) & Offline Execution
- **Installable Desktop/Mobile App**: Certified PWA with Web App Manifest (`manifest.webmanifest`), dark theme colors, and icons.
- **In-App Install Prompt**: Automatically reveals an **Install** button in the header toolbar when the browser detects installability.
- **100% Offline Capability**:
  - Unified Service Worker caches App Shell, fonts, editor modules, WebAssembly compiler binaries (`clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar.gz`), Raylib assets, and Turtle static archives.
  - Seamless offline execution with retained `COOP: same-origin` and `COEP: require-corp` isolation headers so `SharedArrayBuffer` remains operational without an internet connection.
  - Automatic connection status notifications when transitioning between online and offline modes.

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

> **Note**: `npm install` triggers a `postinstall` hook that automatically runs `scripts/download-sysroot.js`, downloading the required LLVM 19 WASI binaries (`clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar.gz`), Raylib 5.5 assets, and prebuilding `libturtle` static libraries (`libturtle.a`, `libturtle_canvas-wasi.a`, `libturtle_raylib.a`) from upstream GitHub releases into `public/sysroot/`. You can also manually trigger this download anytime with `npm run download:sysroot`.

### Development Server
Start the local Vite development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:5173`.

> **Note**: Vite is configured with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` HTTP headers to enable `SharedArrayBuffer` support out of the box during development.

### Running Tests
Execute the full unit test suite (covering VFS, Shell parser, Toolchain driver, Static Archiver, Runtime Atomics, Make engine, PWA Service Worker, Zoom controls, Pipelines & Redirections, Raylib graphics, Generic Graphics / Canvas 2D, Shared Objects, Turtle Graphics, and In-Code File I/O):

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

## License

This project is licensed under the [MIT License](LICENSE).
