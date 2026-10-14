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
|  | (Monaco Editor & Zoom +/-)|  | (Save/Compile/Build/Run/Install PWA|  |
|  +-------------+-------------+  +-----------------+------------------+  |
|                |                                  | (Transparent        |
|                v (Explicit Save / Dirty Marker)   v  pushd/cd/popd cmd) |
|  +-------------+----------------------------------+------------------+  |
|  |               xterm.js Virtual Terminal & Zoom (+/-)              |  |
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
|  |  Clang / LLD / Make Wasm Toolchain (Async instantiate / MemFS sync)|  |
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
| Offline Engine: Unified PWA Service Worker (COOP/COEP & CacheStorage)   |
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
- **Shell**: Dedicated Web Worker running interactive POSIX-compatible shell.
  - **Built-in CLI Utilities**: `sh`, `ls`, `cd`, `pwd`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `clear`, `echo` (with `>` and `>>` output redirection), `which`, `pushd`, `popd`, and `dirs`.
  - **External Toolchain Dispatch**: External commands (`gcc`, `clang`, `wasm-ld`, `make`, `./a.out` or `./*`) are delegated to Wasm toolchain and runtime worker execution sandboxes.
  - **Interactive Features**: Interactive prompt (`$ ` with cwd display), command history (Up/Down arrows), autocompletion (Tab), line editing, and ANSI colors.
  - **Directory Stack & Navigation**:
    - `pushd <dir>`: Saves current working directory onto stack and navigates to target.
    - `pushd .`: Pushes current directory onto stack.
    - `pushd` (parameterless): Swaps current directory with top of directory stack.
    - `popd`: Pops the top directory from stack and restores working directory.
    - `dirs`: Displays current directory stack formatted with `~` representing `/workspace`.
    - `cd -`: Swaps to the previous working directory (`oldPwd`).
  - **Command Chaining & Operators**:
    - The shell command interpreter supports operator chaining: sequential `;`, conditional `&&`, and conditional `||`, properly respecting quoted strings.
  - **Glob Pattern Expansion**:
    - Unquoted command arguments containing glob wildcards (`*`, `?`) are recursively expanded against the VFS file tree before command execution. Unmatched patterns are preserved as literal strings.
  - **File-Aware & Multi-Target `ls`**:
    - Supports multiple target paths, listing individual files directly with metadata and directory contents under section headers.
  - **File Operations (`mv` and `cp`) Semantics**:
    - **Directory Destination Variants**: `mv <src> <dest_dir>` and `mv <src> <dest_dir>/` move `<src>` inside `<dest_dir>` using the source basename.
    - **Multi-Source Support**: `mv file1 file2 <dest_dir>/` and `cp file1 file2 <dest_dir>/`.
    - **Trailing Slash Enforcement**: If a target ends with `/`, it must exist and be a directory.
    - **Atomic File Overwriting**: Moving a file onto an existing regular file replaces it cleanly without error.
    - **Directory Safety**: Prohibits overwriting directories with non-directories, non-empty directories, or moving a directory into a subdirectory of itself.
    - **Recursive Copy**: `cp -r` / `cp -R` recursively copies directory hierarchies.
- **UI Button Action Redirection (Strict Principle & Working Directory Transparency)**:
  - GUI action buttons (Compile, Build, Run, Stop) **MUST NOT** invoke hidden internal APIs.
  - Action buttons dynamically construct shell command sequences and inject them directly into `xterm.js` via `terminal.injectCommand(cmd)`.
  - **Directory Stack Preservation**: Because the student may be navigating arbitrary directories in the shell (e.g. `src/` or `/usr/include`), UI action buttons MUST transparently switch to `/workspace` and restore the user's directory upon completion using the directory stack:
    - **Compile**: `pushd . && cd /workspace && gcc -Iinclude -Wall -c <relPath> -o <objPath>; popd`
    - **Build**: `pushd . && cd /workspace && make; popd` (or `pushd . && cd /workspace && sh build.sh; popd`)
    - **Run**: `pushd . && cd /workspace && ./a.out; popd`
  - The `; popd` delimiter ensures the user's working directory is always restored even when compilation or program execution fails with a non-zero exit code.

### 3.3 C/C++ Toolchain & Sysroot
- **Prebuilt Binaries**: Open-source prebuilt WebAssembly binaries are utilized for Clang, `wasm-ld`, Make, and BusyBox.
- **Compiler**: Clang / LLVM Wasm build mapped to commands `gcc` and `clang`.
- **Linker**: `wasm-ld` mapped to handle object linking.
- **Sysroot & Standard Libraries**:
  - Bundles minimal `wasi-libc` (`libc.a`, `crt1.o`, Musl libc headers under `/usr/include`, static libraries under `/usr/lib`).
  - Full C++ standard library support (`libc++.a`, `libc++abi.a`, C++ headers under `/usr/include/c++/v1`).
- **Toolchain MemFS Lifecycle & Ancestor Directory Auto-Creation**:
  - The toolchain initializes an in-memory virtual filesystem (`MemFS`) for Clang/LLD execution.
  - Toolchain initialization is pre-warmed on application boot and guarded against re-entrance.
  - Adding files or directories to MemFS automatically ensures all ancestor parent directory nodes are created sequentially to prevent WebAssembly `unreachable` assertion traps.
  - Missing-file probes safely return without trapping.
- **Language Dialects**:
  - **Pure C Mode**: Automatically injects `-x c -std=c11 -pedantic-errors -Wall -Wextra`. Forbids C++ syntax extensions and disallows `#include <iostream>`, `<vector>`, etc.
  - **C++ Mode**: Injects `-x c++ -std=c++17 -Wall -Wextra` linking against `libc++`.
- **Include Paths**: Default configuration includes `-I/workspace/include -I/workspace`. System headers resolve to `/usr/include` and `/usr/include/c++/v1`.

### 3.4 Build Systems (Dual-Track Mechanism)
Users can select between two build strategies in the Project Settings UI:

1. **Default Track: Shell Script (`build.sh`)**
   - The UI generates `/workspace/build.sh` reflecting compiler flags, source files, and output paths.
   - Triggering "Build" injects `pushd . && cd /workspace && sh build.sh; popd` to the terminal.
2. **Alternative Track: Makefile & Incremental Make**
   - The UI generates a standard `/workspace/Makefile` defining explicit targets (`all`, `clean`, `%.o: %.c`).
   - Incremental Makefile runner evaluates file modification timestamps (`mtime`) to rebuild only stale prerequisites.
   - Triggering "Build" injects `pushd . && cd /workspace && make; popd` to the terminal.

### 3.5 Runtime & Interactive Standard I/O
- Target binaries (`.wasm` executables, e.g., `./a.out` or `./bin/app`) run in a dedicated Web Worker instance.
- **Blocking Standard Input (`stdin`)**:
  - Handled via `SharedArrayBuffer` and `Atomics.wait()`.
  - When the runtime executes WASI `fd_read` on file descriptor 0, the worker pauses without blocking the browser main UI thread until `xterm.js` receives user input and signals `SharedArrayBuffer` via `Atomics.notify()`.
- **Execution Interruption**:
  - `Ctrl+C` in the terminal or GUI "Stop" button immediately issues worker interruption/termination and resets terminal state.

### 3.6 Virtual File System (VFS) & Storage
- Single Source of Truth shared across Editor, Shell Worker, and Toolchain.
- **Directory Layout**:
  - `/workspace`: Root of the user project (Read-Write, persisted in IndexedDB).
  - `/usr/include`: Read-only sysroot standard C and C++ headers.
  - `/usr/lib`: Read-only Musl/libc/libc++ static runtime archives (`crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libm.a`, `libpthread.a`).
  - `/bin`: Read-only POSIX utilities (`sh`, `ls`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `pwd`, `clear`, `echo`, `pushd`, `popd`, `dirs`).
  - `/usr/bin`: Read-only toolchain binaries (`gcc`, `clang`, `make`, `wasm-ld`).
- **File System Operations**:
  - `rename(oldPath, newPath)`: Supports directory target resolution (moving into existing destination folder), atomic replacement when overwriting existing files, and circular directory protection.
  - `writeFile(path, content)`: Protected against replacing existing directory nodes.
- **Persistence**:
  - Synchronized with browser `IndexedDB`. Survives page refreshes.
- **Import / Export**:
  - Export: Bundles `/workspace` exclusively into a `.zip` archive downloaded to the client.
  - Import: Extracts a user `.zip` archive directly into `/workspace`. System files outside `/workspace` cannot be overwritten.

### 3.7 Static Hosting, Security Isolation & Offline PWA Capabilities
- **Cross-Origin Isolation**:
  - `SharedArrayBuffer` requires:
    - `Cross-Origin-Opener-Policy: same-origin`
    - `Cross-Origin-Embedder-Policy: require-corp`
- **GitHub Pages / Zero-Config Static Server Compatibility & Unified PWA Service Worker**:
  - Bundles `coi-serviceworker.js` in `public/coi-serviceworker.js` (loaded via `<script src="/coi-serviceworker.js">` in `index.html`) which serves as a unified Service Worker providing both:
    1. Cross-Origin Isolation header injection (`COOP: same-origin` and `COEP: require-corp`) across static hosting environments.
    2. `CacheStorage` offline caching engine (Cache-First for App Shell and Wasm toolchain assets, with automatic fallback for navigation).
- **Progressive Web App (PWA) & Offline Execution**:
  - Provides `manifest.webmanifest` defining standalone display, theme colors, and icons.
  - Supports desktop and mobile home screen installation via `#btn-install` and `beforeinstallprompt`.
  - Enables 100% offline development: when disconnected, cached HTML, JS/CSS bundles, sysroot headers, and Wasm binaries (`clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar`) execute locally without network access.

### 3.8 Milestone 8: Usability Enhancements, Sub-Path Hosting & Production Delivery

#### 3.8.1 Independent Pane Font Zoom & Scaling
- **Multi-Pane Independence**: Monaco Editor and `xterm.js` terminal maintain isolated font scaling configurations rather than a shared global IDE zoom.
- **Header Control Bar Integration**:
  - **Editor**: Zoom controls are positioned on the right side of `.editor-header-bar` (`.pane-zoom-controls`) adjacent to editor tabs.
  - **Terminal**: Zoom controls are embedded in `.terminal-header` within `.terminal-actions` alongside the clear terminal button (`#btn-clear-term`).
- **Interactive UI Controls**:
  - **Zoom In (`+`)**: Buttons `#btn-editor-zoom-in` and `#btn-term-zoom-in` increase font size by 1px.
  - **Zoom Out (`-`)**: Buttons `#btn-editor-zoom-out` and `#btn-term-zoom-out` decrease font size by 1px.
  - **Font Size Display & Reset**: Current size is rendered inside `#editor-font-size-label` and `#term-font-size-label` (e.g., `14px`, `13px`). Clicking the label resets the pane to its default font size (14px for Monaco, 13px for xterm.js).
- **Keyboard Shortcuts**:
  - **Zoom In**: `Ctrl+=` / `Cmd+=` (including `+` and `NumpadAdd`).
  - **Zoom Out**: `Ctrl+-` / `Cmd+-` (including `NumpadSubtract`).
  - **Reset Zoom**: `Ctrl+0` / `Cmd+0`.
  - Terminal shortcuts are captured via `term.attachCustomKeyEventHandler` to override browser defaults and xterm.js interception.
- **Clamping Boundaries**: Font sizes are strictly bounded between `9px` (minimum readability) and `36px` (maximum upper bound). Values are rounded to integers.
- **LocalStorage Persistence**: Font size selections persist across sessions using keys `wasm_ide_editor_font_size` and `wasm_ide_term_font_size`.
- **Dynamic Geometry Synchronization**: Font changes in terminal dynamically trigger `fitAddon.fit()` and notify listeners; Monaco updates via `editor.updateOptions({ fontSize })`.

#### 3.8.2 Sub-Path Deployment & Relative Asset Resolution
- **Zero-Config Sub-Path Portability**: The application supports root (`/`) or arbitrary sub-path deployments (e.g., `https://<owner>.github.io/<repo>/` or reverse-proxied paths like `/cpp-ide/`) without code modification.
- **Base Configuration**: Vite build configuration sets `base: process.env.BASE_URL || './'`.
- **Relative Resource Addressing**:
  - Script and stylesheet links in `index.html` resolve relatively (`./src/style.css`, `./src/main.js`).
  - Web App Manifest specifies `start_url: './'` and `scope: './'`.
  - Toolchain and Sysroot asset fetches (`clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar`) dynamically calculate the root path based on base paths rather than hardcoded `/sysroot/wasm/...`.

#### 3.8.3 Asynchronous Toolchain WebAssembly Instantiation
- **V8 / Chromium 8MB Main-Thread Limit Mitigation**: Modern browser engines (e.g., Chromium / V8) reject synchronous WebAssembly compilation (`new WebAssembly.Module()` or `new WebAssembly.Instance()`) on the main thread if the buffer exceeds 8MB.
- **Asynchronous Pipeline**:
  - Clang (~20MB+), LLD, and MemFS are fetched and instantiated using `WebAssembly.instantiate(buffer, imports)` and `WebAssembly.compile(buf)` asynchronously.
  - `MemFS.create(memfsBuffer, hostWrite)` and `AppInstance.create(module, memfs, name, ...args)` provide async factory initializers.
  - Background pre-warming (`toolchain.init()`) begins on application load without freezing UI interactivity.

#### 3.8.4 Production CI/CD Pipeline & Automated Release Packaging
- **Automated Continuous Integration & Deployment**:
  - GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers on push to `main`.
  - Verifies all unit test suites (`npm test`).
  - Builds the production bundle (`npm run build`).
  - Deploys static build to GitHub Pages via `actions/deploy-pages`.
- **Portable Offline Zip Packaging**:
  - Dedicated script `npm run pack` builds and packages `dist/` into `wasm-c-ide.zip`.
  - CI workflow uploads the zip archive as a GitHub Actions artifact and publishes it to the repository's **Latest Release** (`softprops/action-gh-release@v2`), allowing users to run the IDE fully offline with any local web server.

---

## 4. UI Layout & User Experience
+---------------------------------------------------------------------------+
| [Header] App Title | Mode: [Pure C | C++] | Build System: [sh | make]     |
| [Actions] [💾 Save] [⚙ Compile] [🔨 Build] [▶ Run] [⏹ Stop] | [⚙ Settings] |
|                                                    [📲 Install PWA (opt)] |
+-----------------------+---------------------------------------------------+
| Workspace File Tree   | Editor Tabs: [main.c *] [calc.c]      [- 14px +]  |
| [📄+] [📁+] [📥] [📤]   +---------------------------------------------------+
| - src/                | 1 | #include <stdio.h>                            |
|   - main.c            | 2 | #include "calc.h"                             |
| - include/            | 3 | int main() { ... }                            |
|   - calc.h            |                                                   |
| - build/              +---------------------------------------------------+
|   - calc.o            | Integrated Terminal (xterm.js)        [- 13px +]  |
|   - main.o            | ide:~$ pushd . && cd /workspace && gcc ...; popd  |
| - a.out               | ide:~$ ./a.out                                    |
| - build.sh / Makefile | Enter number: 42_                                 |
+-----------------------+---------------------------------------------------+

### UI Controls & Ergonomics:
1. **Sidebar Action Buttons (Icon-Only with Tooltips)**:
   - **Add File**: Displayed as file-plus icon, with tooltip `New File`.
   - **Add Folder**: Displayed as folder-plus icon, with tooltip `New Folder`.
   - **Import Zip**: Displayed as archive upload icon, with tooltip `Import Zip`.
   - **Export Zip**: Displayed as archive download icon, with tooltip `Export Zip`.
   - Tooltips are provided via native `title`, `aria-label`, and styled dark-themed CSS tooltips (`data-tooltip`).
2. **Primary Header Action Buttons (Icon & Text Label)**:
   - All primary action buttons feature both an SVG icon and a descriptive text label:
     - **Save**: Floppy disk icon + "Save" (`#btn-save`)
     - **Compile**: Translation/gear icon + "Compile" (`#btn-compile`)
     - **Build**: Hammer icon + "Build" (`#btn-build`)
     - **Run**: Play triangle icon + "Run" (`#btn-run`)
     - **Stop**: Stop square icon + "Stop" (`#btn-stop`)
     - **Settings**: Sliders icon + "Settings" (`#btn-settings`)
3. **Visual Color Hierarchy**:
   - **Save**: Sky blue / cyan (`#0284c7`)
   - **Compile**: Violet / purple (`#7c3aed`)
   - **Build**: Primary blue (`#0e639c`)
   - **Run**: Success green (`#388a34`)
   - **Stop**: Danger red (`#c72e2e`)
4. **Pane Font Zoom Widgets**:
   - Visual `+` / `-` buttons and clickable font size label displayed in editor tab bar (`.pane-zoom-controls`) and terminal header (`.terminal-actions`).
   - Clicking size label resets to default size (`14px` for editor, `13px` for terminal).
5. **Progressive Web App (PWA) Install Prompt**:
   - In-app install button (`#btn-install`) conditionally rendered in the top header upon receiving browser `beforeinstallprompt` event.
   - Disappears upon successful installation (`appinstalled` event).
6. **Draggable Pane Splitter**:
   - Draggable horizontal separator (`#split-resizer`) between editor and terminal permitting dynamic vertical pane height adjustment.

---

## 5. Non-Functional Requirements
- **Bundle Size Optimization**: Toolchain and assets must be lazy-loaded with clear progress indicators during initial initialization.
- **Clean Browser Compatibility**: Tested and operable on recent Chromium, Firefox, and Safari (Safari 15.2+ supporting `SharedArrayBuffer`).
- **No Remote Telemetry**: Strict local client execution; zero remote code telemetry or cloud dependencies.
- **Sub-Path Hosting Compatibility**: Ready for zero-config sub-directory hosting without hardcoded absolute URLs.
- **Main-Thread Asynchronous Wasm Compilation**: Zero synchronous instantiation of Wasm modules >8MB on the main thread, ensuring compliance with browser performance constraints.
- **100% Offline Autonomy**: Full offline PWA execution with Cache-First Service Worker and offline COOP/COEP isolation injection.

