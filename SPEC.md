# Software Specification: In-Browser C/C++ Teaching IDE (Pure Static Wasm)

## 1. Project Overview & Objectives
The goal of this project is to build an installation-free, zero-backend, multi-file C/C++ programming development and learning environment that runs entirely client-side in modern web browsers via WebAssembly (Wasm). 

### Key Objectives:
- **Zero Backend / Pure Static**: Hostable on static hosting services (e.g., GitHub Pages, Cloudflare Pages, static Nginx).
- **Educational Transparency**: Demystify the compilation, assembly, and linking phases. Users can observe object files (`.o`), executables (`.wasm`/binary), paths, and compiler flags directly.
- **Pedagogical Discipline**: Enforce strict standard C mode when enabled, disallow automatic saving to foster explicit save habits, and direct all GUI operations into visible shell terminal commands.

---

## 2. System Architecture
+-------------------------------------------------------------------------+
|                               Browser UI                                |
|  +---------------------------+  +------------------------------------+  |
|  | Multi-tab Code Editor     |  | Project Settings & Build Action Bar|  |
|  | (Monaco / CodeMirror 6)   |  | (Build / Link / Compile Active)    |  |
|  +-------------+-------------+  +-----------------+------------------+  |
|                |                                  | (Inject command)    |
|                v (Sync on Save / Dirty marker)    v                     |
|  +-------------+----------------------------------+------------------+  |
|  |                     xterm.js Virtual Terminal                     |  |
|  +------------------------------------+------------------------------+  |
+---------------------------------------|---------------------------------+
| (Pty / Stdin / Stdout stream)
+---------------------------------------v---------------------------------+
|                         Web Worker Execution Sandboxes                  |
|                                                                         |
|  +--------------------------+          +-----------------------------+  |
|  |   BusyBox-Wasi Shell     |          |  Wasm Runtime (Target App)  |  |
|  |   - CLI history & Tab    |          |  - SharedArrayBuffer        |  |
|  |   - Built-in posix tools |          |  - Atomics.wait blocking IO |  |
|  +-------------+------------+          +--------------+--------------+  |
|                | (executes toolchain)                 |                 |
|                v                                      v                 |
|  +-------------------------------------------------------------------+  |
|  |  Clang / LLD / Make Wasm Toolchain                                 |  |
|  +------------------------------------+------------------------------+  |
|                                       |                                 |
|                                       v                                 |
|  +------------------------------------+------------------------------+  |
|  | Virtual File System (Single Source of Truth)                      |  |
|  | - /usr/include (Read-Only Headers)                                |  |
|  | - /workspace (Read-Write, IndexedDB Sync, .zip Export/Import)     |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+

---

## 3. Detailed Component Specifications

### 3.1 Code Editor Component
- **Engine**: Monaco Editor.
- **Implementation**: Pure Vanilla JS / DOM with standard ES modules.
- **Multi-File / Multi-Tab**: Tabbed interface corresponding to files under `/workspace`.
- **Dirty State Indicator**:
  - Unsaved modifications display a prominent dirty marker (e.g., `*` or solid dot on tab).
  - **No Auto-Save**: Files MUST NOT auto-save on edit or build.
  - **Save Action**: Explicit `Ctrl+S` / `Cmd+S` or UI Save button writes content into the Virtual File System (VFS).
- **Build Pre-Condition Warning**:
  - If a user triggers "Compile Active File" or "Build" while the active file or any workspace file is dirty, show a non-blocking toast warning: `"Warning: File has unsaved changes. Build proceeds with last saved disk state."` (Do not block compilation, but never auto-save).

### 3.2 Terminal & Shell Subsystem
- **Terminal Emulator**: `xterm.js` with `xterm-addon-fit`.
- **Shell**: `busybox-wasi` compiled to Wasm running inside a Dedicated Web Worker, or hybrid command execution worker.
  - Execution Model (Hybrid / Intercepted Worker): Built-in shell capabilities (`ls`, `cd`, `pwd`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `clear`, `sh`, pipelines, redirect) are serviced in the shell environment. External toolchain commands (`gcc`, `clang`, `wasm-ld`, `make`, `./a.out` or `./*`) are intercepted and dispatched to dedicated Wasm toolchain/runtime workers executing against the shared VFS.
  - Interactive prompt (`$ `), command history (Up/Down arrows), autocompletion (Tab), line editing, and ANSI colors.
- **UI Button Action Redirection (Strict Principle)**:
  - GUI action buttons (Compile, Link, Build, Clean, Run) **MUST NOT** invoke hidden internal APIs.
  - Instead, clicking any action button dynamically translates project settings into the exact shell command string and types/pastes it directly into `xterm.js` followed by `\r\n`.
  - Example: Clicking "Compile Active File" pastes `gcc -Wall -c src/calc.c -o build/calc.o` into the shell.

### 3.3 C/C++ Toolchain & Sysroot
- **Prebuilt Binaries**: Open-source prebuilt WebAssembly binaries are utilized for Clang, `wasm-ld`, Make, and BusyBox (built from source if prebuilt unavailable).
- **Compiler**: Clang / LLVM Wasm build mapped to command `gcc` / `clang`.
- **Linker**: `wasm-ld` mapped to handle object linking.
- **Sysroot & Standard Libraries**:
  - Bundles minimal `wasi-libc` (`libc.a`, `crt1.o`, Musl libc headers under `/usr/include`).
  - Full C++ standard library support (`libc++.a`, `libc++abi.a`, C++ standard library headers `<iostream>`, `<vector>`, `<string>`, etc.).
- **Language Dialects**:
  - **Pure C Mode**: Automatically injects `-x c -std=c11 -pedantic-errors -Wall -Wextra`. Forbids C++ syntax extensions and disallows `#include <iostream>`, `<vector>`, etc.
  - **C++ Mode**: Injects `-x c++ -std=c++17 -Wall -Wextra` linking against `libc++`.
- **Include Paths**: Default configuration includes `-I/workspace/include -I/workspace`. System headers resolve to `/usr/include` and `/usr/include/c++/v1`.

### 3.4 Build Systems (Dual-Track Mechanism)
Users can select between two build strategies in the Project Settings UI:

1. **Default Track: Shell Script (`build.sh`)**
   - The UI generates `/workspace/build.sh` reflecting compiler flags, source files, and output paths.
   - Triggering "Build" sends `sh build.sh` to the terminal.
2. **Alternative Track: Makefile & Lightweight Make**
   - The UI generates a standard `/workspace/Makefile` defining explicit targets (`all`, `clean`, `%.o: %.c`).
   - A lightweight `make` Wasm binary (or `pdmake`) is invoked.
   - Triggering "Build" sends `make` to the terminal. Triggering "Clean" sends `make clean`.

### 3.5 Runtime & Interactive Standard I/O
- Target binaries (`.wasm` executables, e.g., `./a.out` or `./bin/app`) run in a dedicated Web Worker instance.
- **Blocking Standard Input (`stdin`)**:
  - Handled via `SharedArrayBuffer` and `Atomics.wait()`.
  - When the runtime executes WASI `fd_read` on file descriptor 0, the worker pauses until `xterm.js` receives input and signals the `SharedArrayBuffer` via `Atomics.notify()`.
- **Execution Interruption**:
  - `Ctrl+C` in the terminal or a GUI "Stop / Kill" button immediately issues `worker.terminate()` and resets terminal state.

### 3.6 Virtual File System (VFS) & Storage
- Single Source of Truth shared across Editor, BusyBox Shell, and Toolchain.
- **Directory Layout**:
  - `/usr/include`: Read-only. Holds C standard library headers (Musl/WASI libc) and C++ headers. Hidden from the user workspace file tree.
  - `/usr/lib`: Read-only. Holds `libc.a`, `crt1.o`, `libc++.a`, `libc++abi.a`. Hidden from workspace file tree.
  - `/workspace`: Root of the user project.
- **Persistence**:
  - Synchronized with browser `IndexedDB`. Survives page refreshes.
- **Import / Export**:
  - Export: Bundles `/workspace` exclusively into a `.zip` archive downloaded to the client.
  - Import: Extracts a user `.zip` archive directly into `/workspace` (erasing or merging existing contents upon confirmation). System files outside `/workspace` cannot be overwritten.

### 3.7 Static Hosting & Security Isolation
- **Cross-Origin Isolation**:
  - `SharedArrayBuffer` requires:
    - `Cross-Origin-Opener-Policy: same-origin`
    - `Cross-Origin-Embedder-Policy: require-corp`
- **GitHub Pages / Zero-Config Static Server Compatibility**:
  - Must bundle `coi-serviceworker.js` in root `index.html` to dynamically spoof these headers on hosts that do not support custom HTTP response headers.
  - Provide sample configurations for Nginx and Caddy in documentation.

---

## 4. UI Layout & User Experience
+---------------------------------------------------------------------------+
| [Header] App Title | Mode: [Pure C | C++] | Build System: [sh | make]     |
| [Actions] [Save] [Compile File] [Build] [Run] [Stop] | [Project Settings] |
+-----------------------+---------------------------------------------------+
| Workspace File Tree   | Editor Tabs: [main.c *] [calc.c] [calc.h]         |
| - src/                +---------------------------------------------------+
|   - main.c            | 1 | #include <stdio.h>                            |
|   - calc.c            | 2 | #include "calc.h"                             |
| - include/            | 3 | int main() { ... }                            |
|   - calc.h            |                                                   |
| - build/              +---------------------------------------------------+
|   - calc.o            | Integrated Terminal (xterm.js)                    |
|   - main.o            | $ gcc -Iinclude -Wall -c src/main.c -o build/main.o|
| - a.out               | $ ./a.out                                         |
| - build.sh / Makefile | Enter number: 42_                                 |
+-----------------------+---------------------------------------------------+

---

## 5. Non-Functional Requirements
- **Bundle Size Optimization**: Toolchain and assets must be lazy-loaded with clear progress indicators during initial initialization.
- **Clean Browser Compatibility**: Tested and operable on recent Chromium, Firefox, and Safari (Safari 15.2+ supporting `SharedArrayBuffer`).
- **No Remote Telemetry**: Strict local client execution; zero remote code telemetry or cloud dependencies.

