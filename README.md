# WebAssembly C/C++ Teaching IDE

A zero-backend, installation-free, multi-file C/C++ development and learning environment running entirely client-side in the browser via WebAssembly (Wasm).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cross-Origin Isolated](https://img.shields.io/badge/Cross--Origin_Isolation-COOP%2FCOEP-green.svg)](#cross-origin-isolation--deployment)
[![Client-Side Wasm](https://img.shields.io/badge/Architecture-100%25_Static_Wasm-orange.svg)](#architecture)

---

## Table of Contents

- [Purpose & Pedagogical Vision](#purpose--pedagogical-vision)
- [Key Features](#key-features)
  - [Editor & Workspace UI](#1-editor--workspace-ui)
  - [Interactive POSIX Shell & Terminal](#2-interactive-posix-shell--terminal)
  - [Clang & LLD WebAssembly Toolchain](#3-clang--lld-webassembly-toolchain)
  - [Dual Build Systems (Shell Script & Makefile)](#4-dual-build-systems-shell-script--makefile)
  - [Execution Sandbox with Synchronous Stdin](#5-execution-sandbox-with-synchronous-stdin)
  - [Virtual File System & Storage](#6-virtual-file-system--storage)
- [Architecture](#architecture)
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
- [Directory Structure](#directory-structure)

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
  - **Standard C++ Support**: Seamlessly toggleable to C++ mode (`-std=c++17`) with full standard library support (`<iostream>`, `<vector>`, `<string>`, etc.).

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
  - **Command Chaining**: Supports `;`, `&&`, and `||` operators respecting quotes.
  - **Glob Pattern Expansion**: Expands `*` and `?` wildcards against the VFS file tree (e.g., `ls build/*`, `gcc src/*.c`).
  - **Advanced File Operations**: `mv` and `cp` support directory destinations (`mv a.out src/`), multi-source operands (`mv a.c b.c src/`), atomic file replacement, and recursive directory copying (`cp -r src backup/`).
- **Transparent Working Directory Preservation**:
  - UI action buttons inject transparent directory stack commands into the terminal:
    - **Compile**: `pushd . && cd /workspace && gcc -Iinclude -Wall -c src/main.c -o build/main.o; popd`
    - **Build**: `pushd . && cd /workspace && make; popd` (or `sh build.sh`)
    - **Run**: `pushd . && cd /workspace && ./a.out; popd`
  - Guarantees that the student's shell working directory is preserved even if compilation or execution exits with an error code.

### 3. Clang & LLD WebAssembly Toolchain
- **Real Clang & LLD Binaries**: Uses prebuilt WebAssembly builds of LLVM Clang and `wasm-ld` running in the browser.
- **Sysroot & Standard Libraries**:
  - Bundles Musl libc standard headers under `/usr/include/` and C++ headers under `/usr/include/c++/v1/`.
  - Pre-mounted static runtime archives in `/usr/lib/`: `crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libm.a`, `libpthread.a`.
- **Multi-File Separate Compilation**:
  - Separate object generation: `gcc -c src/calc.c -o build/calc.o`
  - Separate linking: `gcc build/main.o build/calc.o -o a.out`
- **Robust MemFS Layer**: Automatically creates ancestor directories and handles missing file probes safely without WebAssembly assertion traps.

### 4. Dual Build Systems (Shell Script & Makefile)
- **Track 1: Shell Script (`build.sh`)**:
  - Generates `/workspace/build.sh` reflecting active compiler flags, include directories, and output binaries.
- **Track 2: Standard Makefile (`Makefile`)**:
  - Generates a modular Makefile with `all`, `clean`, and pattern rules (`%.o: %.c`).
  - Built-in incremental `make` engine checks modification timestamps (`mtime`) against prerequisites to avoid redundant rebuilds.
- **Project Settings Modal**: Configure language mode, include directories, compiler warning flags, default build track, and target binary name.

### 5. Execution Sandbox with Synchronous Stdin
- **Dedicated Runtime Web Worker**: User executables run in an isolated WebAssembly execution sandbox with WASI emulation.
- **Synchronous Blocking Input (`scanf` / `cin`)**:
  - Employs `SharedArrayBuffer` and `Atomics.wait()` / `Atomics.notify()`.
  - When the user's C program invokes `scanf("%d", &val)` or `getchar()`, the runtime worker suspends synchronously without locking the main browser UI thread.
  - Characters typed into `xterm.js` are forwarded to the worker via shared memory upon pressing Enter.
- **Execution Interruption**:
  - Pressing `Ctrl+C` in `xterm.js` or clicking the UI **Stop** button terminates the runtime worker immediately, returning control to the shell prompt.

### 6. Virtual File System & Storage
- **In-Memory VFS**: Fast hierarchical tree representation shared across the editor, shell, and toolchain.
- **IndexedDB Persistence**: Automatically persists `/workspace` across browser sessions and page refreshes.
- **Zip Import & Export**: One-click export of `/workspace` into a standard `.zip` file using JSZip, and direct zip unpacking into the workspace.
- **Sysroot Protection**: Read-only protection on system root paths (`/usr`, `/bin`).

---

## Architecture

```
+-------------------------------------------------------------------------+
|                               Browser UI                                |
|  +---------------------------+  +------------------------------------+  |
|  | Multi-tab Code Editor     |  | Project Settings & Build Action Bar|  |
|  | (Monaco Editor)           |  | (Save / Compile / Build / Run)     |  |
|  +-------------+-------------+  +-----------------+------------------+  |
|                |                                  | (Transparent        |
|                v (Explicit Save / Dirty Marker)   v  pushd/cd/popd cmd) |
|  +-------------+----------------------------------+------------------+  |
|  |                     xterm.js Virtual Terminal                     |  |
|  +------------------------------------+------------------------------+  |
+---------------------------------------|---------------------------------+
                                        | (Pty Stdin / Stdout stream)
+---------------------------------------v---------------------------------+
|                         Web Worker Execution Sandboxes                  |
|                                                                         |
|  +--------------------------+          +-----------------------------+  |
|  |    POSIX Shell Worker    |          |  Wasm Runtime (Target App)  |  |
|  |  - History & Autocomplete|          |  - SharedArrayBuffer        |  |
|  |  - Directory Stack & Globs          |  - Atomics.wait blocking IO |  |
|  +-------------+------------+          +--------------+--------------+  |
|                | (executes commands)                  |                 |
|                v                                      v                 |
|  +-------------------------------------------------------------------+  |
|  |  Clang / LLD / Make Wasm Toolchain (with MemFS synchronization)   |  |
|  +------------------------------------+------------------------------+  |
|                                       |                                 |
|                                       v                                 |
|  +------------------------------------+------------------------------+  |
|  | Virtual File System (VFS - Single Source of Truth)                 |  |
|  | - /workspace (Read-Write, IndexedDB Sync, .zip Export/Import)     |  |
|  | - /usr/include & /usr/lib (Read-Only Headers and Static Libraries)|  |
|  | - /bin & /usr/bin (Read-Only POSIX and Toolchain Binaries)        |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

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

### Development Server
Start the local Vite development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:5173`.

> **Note**: Vite is configured with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` HTTP headers to enable `SharedArrayBuffer` support out of the box during development.

### Running Tests
Execute the full unit test suite (covering VFS, Shell parser, Toolchain driver, Runtime Atomics, and Make engine):

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

1. Build the production assets:
   ```bash
   npm run build
   ```
2. Push the contents of `dist/` to your `gh-pages` branch (or configure GitHub Actions to deploy the `dist/` folder).
3. `public/coi-serviceworker.js` is automatically loaded by `index.html` to spoof cross-origin isolation headers on GitHub Pages.

### Nginx

Configure your Nginx server block to serve the `dist/` folder with the necessary isolation headers:

```nginx
server {
    listen 80;
    server_name ide.example.com;
    root /var/www/wasm-c-ide/dist;
    index index.html;

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

## Directory Structure

```
/
├── SPEC.md                    # Technical specification & architectural ground truth
├── AGENTS.md                  # Development and operational protocols for agents
├── README.md                  # Project overview, features, and deployment instructions
├── index.html                 # Main entry point (loads coi-serviceworker.js)
├── package.json               # Development tooling, dependencies, and test scripts
├── vite.config.js             # Vite configuration (COOP/COEP headers, workers)
├── src/
│   ├── main.js                # Application bootstrap, DOM scaffolding, and UI event binding
│   ├── style.css              # Dark theme styling, button color hierarchy, tooltips
│   ├── components/
│   │   ├── filetree.js        # File tree sidebar, directory expansion, file operations
│   │   ├── settings.js        # Project settings modal, build.sh & Makefile generation
│   │   └── toast.js           # Non-blocking notification toasts
│   ├── editor/
│   │   ├── editor.js          # Monaco editor instance controller and save actions
│   │   ├── monaco-setup.js    # Monaco worker environment setup
│   │   └── tabs.js            # Tab bar manager and dirty mark (*) tracking
│   ├── terminal/
│   │   ├── terminal.js        # xterm.js wrapper and command injection bridge
│   │   └── runtime.js         # Host-side runtime manager and SharedArrayBuffer coordinator
│   ├── toolchain/
│   │   ├── driver.js          # gcc / clang command parser and execution coordinator
│   │   ├── make.js            # Incremental Makefile runner evaluating mtimes
│   │   ├── tar.js             # Sysroot tarball extractor
│   │   └── wasm-clang.js      # Clang, LLD, and MemFS WebAssembly wrappers
│   ├── vfs/
│   │   ├── archive.js         # JSZip project export and import routines
│   │   ├── storage.js         # IndexedDB synchronization and default project seed
│   │   ├── sysroot.js         # Standard C/C++ sysroot header and binary mount definitions
│   │   └── vfs.js             # In-memory virtual filesystem with path normalization
│   └── workers/
│       ├── runtime.worker.js  # WASI host executing user binaries with Atomics stdin
│       └── shell.worker.js    # Interactive POSIX shell worker (pushd/popd, globs, mv/cp)
├── public/
│   ├── coi-serviceworker.js   # Service worker providing cross-origin isolation fallback
│   └── sysroot/
│       ├── wasm/              # Prebuilt clang.wasm, lld.wasm, memfs.wasm, sysroot.tar
│       └── include/           # Minimal fallback libc headers
└── test/
    ├── make.test.js           # Makefile parsing and incremental build tests
    ├── runtime.test.js        # SharedArrayBuffer Atomics protocol tests
    ├── shell.test.js          # Shell argument parsing, globs, pushd/popd, and mv/cp tests
    ├── toolchain.test.js      # Toolchain driver, MemFS directory, and libc library tests
    └── vfs.test.js            # VFS hierarchy, permissions, and zip round-trip tests
```

---

## License

This project is licensed under the [MIT License](LICENSE).
