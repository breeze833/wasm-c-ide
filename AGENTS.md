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
├── index.html                 # Main entry point (loads coi-serviceworker.js)
├── coi-serviceworker.js       # Cross-origin isolation shim for GitHub Pages
├── package.json               # Development tooling & build scripts
├── vite.config.js             # Vite configuration (headers, workers, wasm support)
├── src/
│   ├── main.js                # App bootstrap & layout setup
│   ├── components/            # UI components (Editor, Terminal, FileTree, Settings)
│   ├── editor/                # Monaco / CodeMirror controller & tabs manager
│   ├── terminal/              # xterm.js wrapper & command injection bridge
│   ├── vfs/                   # Virtual File System layer (MEMFS + IndexedDB sync)
│   ├── workers/               # Web Workers
│   │   ├── shell.worker.js    # Busybox/WASI worker
│   │   └── runtime.worker.js  # User app execution sandbox (Atomics stdin handler)
│   └── toolchain/             # Wasm toolchain wrappers (clang, wasm-ld, make)
└── public/
└── sysroot/               # Read-only libc headers and pre-built wasm binaries
├── include/           # Standard C/C++ headers
└── wasm/              # Clang, LLD, Busybox, and Make Wasm modules

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

