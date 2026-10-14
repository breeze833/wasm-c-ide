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

/
├── SPEC.md                    # Technical specification & architectural ground truth
├── AGENTS.md                  # Agent operating protocols (this file)
├── README.md                  # User-facing project documentation & deployment guides
├── index.html                 # Main entry point (loads /coi-serviceworker.js)
├── package.json               # Development tooling, dependencies, and test scripts
├── vite.config.js             # Vite configuration (COOP/COEP headers, workers, wasm support)
├── src/
│   ├── main.js                # App bootstrap, DOM layout, and UI event binding
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
│   ├── coi-serviceworker.js   # Unified cross-origin isolation and CacheStorage offline worker
│   ├── manifest.webmanifest   # Web App Manifest for PWA installation
│   ├── icons/                 # PWA application icons (192, 512, svg)
│   └── sysroot/
│       ├── wasm/              # Prebuilt clang.wasm, lld.wasm, memfs.wasm, sysroot.tar
│       └── include/           # Minimal fallback libc headers
└── test/
    ├── make.test.js           # Makefile parsing and incremental build tests
    ├── runtime.test.js        # SharedArrayBuffer Atomics protocol tests
    ├── shell.test.js          # Shell argument parsing, globs, pushd/popd, and mv/cp tests
    ├── sw.test.js             # Service Worker, PWA manifest, and offline COOP/COEP tests
    ├── toolchain.test.js      # Toolchain driver, MemFS directory, and libc library tests
    ├── vfs.test.js            # VFS hierarchy, permissions, and zip round-trip tests
    └── zoom.test.js           # Editor & terminal font zoom, clamping, and persistence tests

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
| **Infinite Loop Interruption** | `while(1);` can be interrupted via `Ctrl+C` or UI Stop button; terminal returns to prompt. |
| **Refresh Persistence** | Modifying files, closing tab, and reopening keeps files intact via IndexedDB. |
| **Zip Round-Trip** | Exporting project to zip and re-importing preserves directory hierarchy. |
| **Font Zoom & Clamping** | Clicking +/- or pressing Ctrl+=/- zooms font size within 9px–36px limits; clicking label resets. |
| **Font Zoom Persistence** | Reloading page preserves configured font size for editor and terminal via localStorage. |
| **Sub-Path Asset Resolution** | Serving application under a sub-path resolves all assets without broken root `/` requests. |
| **Async Wasm Loading (8MB Limit)** | Clang (~20MB+) compiles and instantiates asynchronously without triggering main-thread synchronous size errors. |
| **Offline PWA Installation** | Application provides valid manifest, registers service worker with COOP/COEP headers, and operates offline. |
| **Portable Zip Distribution** | `npm run pack` creates a standalone `wasm-c-ide.zip` that runs in any static web server document root. |

