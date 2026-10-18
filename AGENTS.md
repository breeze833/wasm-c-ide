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
├── AGENTS.md                  # Agent operating protocols (this file)
├── KNOWN_ISSUES.md            # Documented toolchain version gaps, limits, and MemFS invariants
├── README.md                  # User-facing project documentation & deployment guides
├── index.html                 # Main entry point (loads /coi-serviceworker.js)
├── package.json               # Development tooling, dependencies, and test scripts
├── vite.config.js             # Vite configuration (COOP/COEP headers, workers, wasm support)
├── src/
│   ├── main.js                # App bootstrap, DOM layout, and UI event binding
│   ├── style.css              # Dark theme styling, button color hierarchy, tooltips
│   ├── components/
│   │   ├── filetree.js        # File tree sidebar, directory expansion, file operations
│   │   ├── graphics-window.js # Dedicated floating/pop-out canvas console with FPS & dimensions
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
│   │   ├── raylib-host.js     # Raylib GLES2 / WebGL host calls and input coordination
│   │   ├── tar.js             # Sysroot tarball extractor
│   │   └── wasm-clang.js      # Clang, LLD, and MemFS WebAssembly wrappers
│   ├── vfs/
│   │   ├── archive.js         # JSZip project export and import routines
│   │   ├── storage.js         # IndexedDB synchronization and default project seed
│   │   ├── sysroot.js         # Standard C/C++ sysroot header and binary mount definitions
│   │   └── vfs.js             # In-memory virtual filesystem with path normalization
│   └── workers/
│       ├── runtime.worker.js  # WASI host executing user binaries with Atomics stdin & OffscreenCanvas
│       └── shell.worker.js    # Interactive POSIX shell worker (pushd/popd, globs, mv/cp, direct scripts)
├── public/
│   ├── coi-serviceworker.js   # Unified cross-origin isolation and CacheStorage offline worker
│   ├── manifest.webmanifest   # Web App Manifest for PWA installation
│   ├── icons/                 # PWA application icons (192, 512, svg)
│   └── sysroot/
│       ├── wasm/              # Prebuilt clang.wasm, lld.wasm, memfs.wasm, libraylib.a, sysroot.tar.gz
│       └── include/           # Minimal fallback libc headers & raylib headers
└── test/
    ├── ar.test.js             # Static archiver creation, extraction, table, and wasm-ld linkage tests
    ├── make.test.js           # Makefile parsing and incremental build tests
    ├── pipeline.test.js       # Command pipeline (|) and file redirection (<, >, >>) tests
    ├── raylib.test.js         # Raylib graphics compilation, input sync, and canvas UI tests
    ├── runtime.test.js        # SharedArrayBuffer Atomics protocol and Ctrl-D EOF tests
    ├── shell.test.js          # Shell argument parsing, globs, pushd/popd, mv/cp, and direct scripts
    ├── so.test.js             # WebAssembly shared object (.so) compilation, linking, and runtime execution tests
    ├── sw.test.js             # Service Worker, PWA manifest, and offline COOP/COEP tests
    ├── toolchain.test.js      # Toolchain driver, MemFS directory, unlink guardrails, and libc tests
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

### Milestone 10: Raylib 5.5 Graphics Subsystem & Dual Console Integration
- Integrate Raylib 5.5 WASI static library (`libraylib.a`) and headers (`raylib.h`, `raymath.h`, `rlgl.h`) with opt-in project settings toggle.
- Implement dual-thread rendering: offscreen WebGL canvas in `runtime.worker.js` transferring zero-copy GPU `ImageBitmap` frames to main thread `<canvas id="raylib-canvas">`.
- Implement frame pacing with `Atomics.wait()` in `EndDrawing()` based on `SetTargetFPS()`.
- Implement `GraphicsWindowUI` draggable/resizable floating window, pop-out to separate browser window (`window.open`), dock back, dynamic dimension adaptation to `InitWindow()`, and dimension preservation across window toggles.
- Implement 512-byte `SharedArrayBuffer` keyboard and mouse input coordination with clean focus/blur lifecycle resets.
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
- Upgrade `sysroot.tar.gz` to modern LLVM 19 WASI Preview 1 sysroot with libc, libc++, compiler-rt runtime builtins (`libclang_rt.builtins.a`), and headers (`/include/wasm32-wasip1`, `/lib/clang/19/include`), compressed with gzip to 30MB for GitHub file size compliance and fast client loading.
- Upgrade `libraylib.a` to Raylib 5.5 WASI compiled with LLVM 19 from [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi).
- Integrate native WASI Preview 1 `memfs.wasm` from `clang-wasi` with dynamic node allocation, standard WASI Preview 1 ABI alignment, safe `FindNode`, explicit buffer deallocation on unlink, and `path_link` export.
- Remove redundant repository-local build files and maintain single-source upstream toolchain integration.

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
| **Infinite Loop Interruption** | `while(1);` can be interrupted via `Ctrl+C` or UI Stop button; terminal returns to prompt. |
| **Refresh Persistence** | Modifying files, closing tab, and reopening keeps files intact via IndexedDB. |
| **Zip Round-Trip** | Exporting project to zip and re-importing preserves directory hierarchy. |
| **Font Zoom & Clamping** | Clicking +/- or pressing Ctrl+=/- zooms font size within 9px–36px limits; clicking label resets. |
| **Font Zoom Persistence** | Reloading page preserves configured font size for editor and terminal via localStorage. |
| **Sub-Path Asset Resolution** | Serving application under a sub-path resolves all assets without broken root `/` requests. |
| **Async Wasm Loading (8MB Limit)** | Clang (~20MB+) compiles and instantiates asynchronously without triggering main-thread synchronous size errors. |
| **Raylib Sysroot Mount/Unmount** | Toggling Raylib mounts/unmounts headers and `libraylib.a` in VFS and MemFS cleanly. |
| **Raylib Compilation & Linking** | Programs using `InitWindow` and drawing primitives link with `-lraylib` and run in runtime worker. |
| **Dynamic Canvas Dimensions** | Initializing window sets canvas and window frame to requested size; toggling canvas preserves dimensions. |
| **Settings Action Decoupling** | Clicking Save updates state and sysroot without modifying `/workspace`; Generate Build Script creates build files. |
| **MemFS Recompilation Invariant** | Deleting an object file (`build/calc.o`) or deleted source file purges MemFS without ghost files; re-running `make` re-compiles and relinks without corrupted object headers. |
| **Offline PWA Installation** | Application provides valid manifest, registers service worker with COOP/COEP headers, and operates offline. |
| **Portable Zip Distribution** | `npm run pack` creates a standalone `wasm-c-ide.zip` that runs in any static web server document root. |

