# Software Specification v2: In-Browser C/C++ Teaching IDE with Raylib Graphics (Pure Static Wasm)

## 1. Project Overview & Objectives
The goal of this project is to build an installation-free, zero-backend, multi-file C/C++ programming development and learning environment that runs entirely client-side in modern web browsers via WebAssembly (Wasm). 

SPECv2 extends the original specification to provide first-class, optional **Raylib 5.5** graphics and game development support via [`@breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi). Students can develop and run interactive 2D/3D graphical games with a dedicated canvas display and keyboard/mouse event handling while preserving concurrent standard terminal I/O (`printf`, `scanf`).

### Key Objectives:
- **Zero Backend / Pure Static**: Hostable on static hosting services (e.g., GitHub Pages, Cloudflare Pages, static Nginx).
- **Educational Transparency**: Demystify the compilation, assembly, and linking phases. Users can observe object files (`.o`), executables (`.wasm`/binary), paths, and compiler flags directly.
- **Pedagogical Discipline**: Enforce strict standard C mode when enabled, disallow automatic saving to foster explicit save habits, and direct all GUI operations into visible shell terminal commands.
- **Optional Graphical Game Engine (Raylib 5.5)**: Opt-in 2D/3D game programming support without Emscripten, utilizing pure `wasm32-wasi` static libraries and headers.
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
|                v (Explicit Save / Dirty Marker)   v  pushd/cd/popd cmd) |  Canvas)   |  |
|  +-------------+----------------------------------+------------------+  | bitmap-    |  |
|  |               xterm.js Virtual Terminal & Zoom (+/-)              |  | renderer   |  |
|  +------------------------------------+------------------------------+  +-----+------+  |
+---------------------------------------|---------------------------------------|---------+
                                        | (Pty Stdin / Stdout stream)           | (Zero-copy
+---------------------------------------v---------------------------------------v--+     ImageBitmap)
|                         Web Worker Execution Sandboxes                           |
|                                                                                  |
|  +--------------------------+          +--------------------------------------+  |
|  |    POSIX Shell Worker    |          |  Wasm Runtime (Target App + Raylib)  |  |
|  |  - History & Autocomplete|          |  - SharedArrayBuffer (Stdin & Input) |  |
|  |  - Directory Stack & Globs|         |  - Atomics.wait (Blocking IO & FPS)  |  |
|  +-------------+------------+          |  - OffscreenCanvas (WebGL Context)   |  |
|                | (executes commands)   |  - raylib-host.js (GLES2/Input Bridge)|  |
|                v                       +------------------+-------------------+  |
|  +--------------------------------------------------------+                      |
|  |  Clang / LLD / Make Wasm Toolchain (Async instantiate / MemFS sync)           |
|  +------------------------------------+------------------------------------------+
|                                       |
|                                       v
|  +------------------------------------+------------------------------------------+
|  | Virtual File System (VFS - Single Source of Truth)                            |
|  | - /workspace (Read-Write, IndexedDB Sync, .zip Export/Import)                |
|  | - /usr/include (Read-Only Standard C/C++ Headers & Optional raylib.h)         |
|  | - /usr/lib (Read-Only libc, libc++, and Optional libraylib.a)                 |
|  | - /bin & /usr/bin (Read-Only POSIX and Toolchain Binaries)                   |
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
  - Unsaved modifications display a prominent dirty marker (e.g., `*` or solid dot on tab).
  - **No Auto-Save**: Files MUST NOT auto-save on edit or build.
  - **Save Action**: Explicit `Ctrl+S` / `Cmd+S` or UI Save button writes content into the Virtual File System (VFS).
- **Build Pre-Condition Warning**:
  - If a user triggers "Compile Active File" or "Build" while the active file or any workspace file is dirty, show a non-blocking toast warning: `"Warning: File has unsaved changes. Build proceeds with last saved disk state."` (Do not block compilation, but never auto-save).

### 3.2 Terminal & Shell Subsystem
- **Terminal Emulator**: `xterm.js` with `xterm-addon-fit`.
- **Shell**: Dedicated Web Worker running interactive POSIX-compatible shell.
  - **Built-in CLI Utilities**: `sh`, `ls`, `cd`, `pwd`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `clear`, `echo` (with `>` and `>>` output redirection), `which`, `pushd`, `popd`, and `dirs`.
  - **External Toolchain Dispatch**: External commands (`gcc`, `clang`, `g++`, `clang++`, `wasm-ld`, `make`, `./a.out` or `./*`) are delegated to Wasm toolchain and runtime worker execution sandboxes.
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
    - **Pipes (`|`)**: Supports multi-stage pipeline command chaining (`cmd1 | cmd2 | cmd3`), connecting stdout of stage $k$ to stdin of stage $k+1$ across both built-in utilities and external binaries via deterministic sequential buffer staging.
    - **Stream Redirections (`<`, `>`, `>>`)**:
      - Output Redirection: `> target` (truncate/overwrite) and `>> target` (append) capture stdout of builtins (`echo`, `ls`, `cat`, etc.) and external commands (`./a.out`, `gcc`, `make`) to files in the VFS.
      - Input Redirection: `< source` feeds files from the VFS directly into the standard input of commands (`./a.out < input.txt`, `cat < input.txt`).
      - Operators within quoted strings are preserved as literal characters.
    - **Standard Input Closure (`Ctrl-D` / EOF)**:
      - Pressing `Ctrl-D` (`\x04`) while standard input is active cleanly transmits End-of-File (EOF) to the executing process without terminating the process or shell.
    - **Direct Shell Script Execution**:
      - Executing `./<script>`, `/<path>/<script>`, or any file ending in `.sh` directly (such as `./build.sh` or `/workspace/build.sh`) is automatically detected by inspecting file contents or extension.
      - If the target begins with a shebang (`#!`) or ends with `.sh`, it executes via the shell runner (`builtins.sh`) without requiring explicit `sh ./build.sh`.
      - Non-script executable files dispatched to the runtime worker are verified against the WebAssembly magic number (`\0asm` / `[0x00, 0x61, 0x73, 0x6d]`), returning descriptive diagnostics if invalid bytes are encountered.
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
    - **Compile**: `pushd . && cd /workspace && gcc -Iinclude -Wall -c <relPath> -o <objPath>; popd` (or `g++` when active project is in C++ mode)
    - **Build**: `pushd . && cd /workspace && make; popd` (or `pushd . && cd /workspace && sh build.sh; popd`)
    - **Run**: `pushd . && cd /workspace && ./a.out; popd`
  - The `; popd` delimiter ensures the user's working directory is always restored even when compilation or program execution fails with a non-zero exit code.

### 3.3 C/C++ Toolchain & Sysroot
- **Prebuilt Binaries**: Open-source prebuilt WebAssembly binaries are utilized for Clang, `wasm-ld`, Make, and BusyBox.
- **Compiler**: Clang / LLVM Wasm build mapped to commands `gcc`, `clang`, `g++`, and `clang++`. In C++ mode or when invoked via `g++` / `clang++`, C++ compilation flags and `libc++` linkage are automatically selected.
- **Linker**: `wasm-ld` mapped to handle object linking.
- **Sysroot & Standard Libraries**:
  - Bundles minimal `wasi-libc` (`libc.a`, `crt1.o`, Musl libc headers under `/usr/include`, static libraries under `/usr/lib`).
  - Full C++ standard library support (`libc++.a`, `libc++abi.a`, C++ headers under `/usr/include/c++/v1`).
- **Toolchain MemFS Lifecycle, Directory Auto-Creation & Inode Unlink Guardrails**:
  - The toolchain initializes an in-memory virtual filesystem (`MemFS`) for Clang/LLD execution.
  - Toolchain initialization is pre-warmed on application boot and guarded against re-entrance.
  - Adding files or directories to MemFS automatically ensures all ancestor parent directory nodes are created sequentially to prevent WebAssembly `unreachable` assertion traps.
  - **MemFS Unlinking Invariant**: `path_unlink_file` is strictly restricted to unmounting global sysroot headers and libraries (e.g., removing `include/raylib.h` and `usr/lib/libraylib.a` when Raylib is disabled). Workspace build files (`workspace/*.o`, `workspace/a.out`) must **never** be unlinked in MemFS when deleted from VFS, as `memfs.wasm` suffers from an inode memory reuse bug that corrupts file write offsets and emits corrupted object headers. Workspace files are instead overwritten cleanly on recompile.
  - Missing-file probes safely verify existence (`hasFileInMemfs`) prior to calling `getFileFromMemfs` to prevent triggering `lookup.node` assertion traps.
- **Language Dialects**:
  - **Pure C Mode**: Automatically injects `-x c -std=c11 -pedantic-errors -Wall -Wextra`. Forbids C++ syntax extensions and disallows `#include <iostream>`, `<vector>`, etc.
  - **C++ Mode**: Injects `-x c++ -std=c++17 -Wall -Wextra` linking against `libc++`. Preferred wrapper command is `g++`.
- **Include Paths**: Default configuration includes `-I/workspace/include -I/workspace`. System headers resolve to `/usr/include` and `/usr/include/c++/v1`.

### 3.4 Build Systems (Dual-Track Mechanism) & Project Settings
Users can select between two build strategies in the Project Settings UI:

1. **Decoupled Settings Modal Actions**:
   - **Save Button**: Persists configuration state (mode, build system, compiler flags, include paths, target name, and Raylib toggle) and dynamically mounts/unmounts sysroot headers and libraries without overwriting existing files in `/workspace`.
   - **Generate Build Script Button**: Scans source files in `/workspace` and generates or updates `/workspace/build.sh` and `/workspace/Makefile`.
2. **Track 1: Shell Script (`build.sh`)**
   - The UI generates `/workspace/build.sh` reflecting compiler command (`gcc` in Pure C mode, `g++` in C++ mode), compiler flags, source files, and output paths.
   - When Raylib is enabled, `-lraylib` is automatically included in the final link command.
   - Triggering "Build" injects `pushd . && cd /workspace && sh build.sh; popd` to the terminal.
3. **Track 2: Makefile & Incremental Make**
   - The UI generates a standard `/workspace/Makefile` defining explicit targets (`all`, `clean`, `%.o: %.c` or `%.o: %.cpp`) using `CC = gcc` in Pure C mode and `CXX = g++` in C++ mode.
   - When Raylib is enabled, `LDFLAGS += -lraylib` is automatically configured.
   - Incremental Makefile runner evaluates file modification timestamps (`mtime`) to rebuild only stale prerequisites.
   - Triggering "Build" injects `pushd . && cd /workspace && make; popd` to the terminal.

### 3.5 Runtime & Interactive Standard I/O
- Target binaries (`.wasm` executables, e.g., `./a.out` or `./bin/app`) run in a dedicated Web Worker instance.
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
  - `/usr/include`: Read-only sysroot standard C and C++ headers. When Raylib is enabled, contains `raylib.h`, `raymath.h`, and `rlgl.h`.
  - `/usr/lib`: Read-only Musl/libc/libc++ static runtime archives (`crt1.o`, `libc.a`, `libc++.a`, `libc++abi.a`, `libm.a`, `libpthread.a`). When Raylib is enabled, contains `libraylib.a`.
  - `/bin`: Read-only POSIX utilities (`sh`, `ls`, `cat`, `rm`, `mkdir`, `cp`, `mv`, `pwd`, `clear`, `echo`, `pushd`, `popd`, `dirs`).
  - `/usr/bin`: Read-only toolchain binaries (`gcc`, `clang`, `g++`, `clang++`, `make`, `wasm-ld`).
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
    2. `CacheStorage` offline caching engine (Cache-First for App Shell, Wasm toolchain assets, and Raylib precompiled distribution assets).
- **Progressive Web App (PWA) & Offline Execution**:
  - Provides `manifest.webmanifest` defining standalone display, theme colors, and icons.
  - Supports desktop and mobile home screen installation via `#btn-install` and `beforeinstallprompt`.
  - Enables 100% offline development: cached toolchain and Raylib assets execute locally without network access.

---

### 3.8 Milestone 8: Usability Enhancements, Sub-Path Hosting & Production Delivery

#### 3.8.1 Independent Pane Font Zoom & Scaling
- **Multi-Pane Independence**: Monaco Editor and `xterm.js` terminal maintain isolated font scaling configurations rather than a shared global IDE zoom.
- **Interactive UI Controls**:
  - Zoom in/out buttons and clickable font size label with clamping (9px–36px) and `localStorage` persistence.
  - Dynamic geometry synchronization via `fitAddon.fit()` and Monaco `updateOptions`.

#### 3.8.2 Sub-Path Deployment & Relative Asset Resolution
- Supports arbitrary sub-path deployments (`base: process.env.BASE_URL || './'`) without hardcoded absolute paths.

#### 3.8.3 Asynchronous Toolchain WebAssembly Instantiation
- Clang (~20MB+), LLD, and MemFS compile and instantiate asynchronously without triggering Chromium's 8MB main-thread limit.

#### 3.8.4 Production CI/CD Pipeline & Automated Release Packaging
- GitHub Actions workflow runs automated tests, builds bundle, packages `wasm-c-ide.zip`, and deploys to GitHub Pages and Releases.

---

### 3.9 Milestone 9: Advanced Shell Pipelines, Stream Redirections & EOF Handling
- Sequential multi-stage pipeline buffer staging (`|`).
- Stream redirections (`<`, `>`, `>>`) for builtins and binaries.
- Clean `Ctrl-D` (`\x04`) interactive EOF handling via `SharedArrayBuffer` for `scanf`, `getchar`, `cin`.

---

### 3.10 Milestone 10: Raylib 5.5 Graphics Subsystem & Dedicated Graphical Console

#### 3.10.1 Project Settings & Opt-in Configuration
- **Optional Support**: In Project Settings (`SettingsModal`), users configure `enableRaylib: boolean` (checkbox: `Enable Raylib Graphics Support`).
- **Dynamic VFS Sysroot Integration**:
  - When enabled:
    - Mounts `/usr/include/raylib.h`, `/usr/include/raymath.h`, and `/usr/include/rlgl.h`.
    - Mounts `/usr/lib/libraylib.a` in VFS and registers it in Toolchain MemFS (`lib/wasm32-wasi/libraylib.a`).
    - Build script generator (`build.sh`) and Makefile generator append `-lraylib` to the link step.
    - An action button `#btn-graphics-window` (`[🎮 Canvas]`) is enabled in the top action bar.
  - When disabled (default):
    - Sysroot remains pure C/C++ without graphics headers or library overhead.

#### 3.10.2 Dual-Thread Canvas Rendering Pipeline
Because standard Raylib games run in a continuous synchronous loop (`while (!WindowShouldClose())`), rendering must not block the main browser thread.
1. **DOM Canvas (`main.js` / `graphics-window.js`)**:
   - The main UI thread hosts the visible `<canvas id="raylib-canvas">`.
   - Initializes an `ImageBitmapRenderingContext`:
     ```javascript
     const ctx = canvas.getContext('bitmaprenderer');
     ```
2. **Worker Canvas (`runtime.worker.js`)**:
   - The Web Worker creates an independent `OffscreenCanvas(width, height)`.
   - Acquires a standard `webgl` context on the offscreen canvas.
   - Connects to `@breeze833/raylib-wasi` host bridge (`createRaylibHost`).
3. **Zero-Copy Frame Transfer**:
   - On every frame swap (`raylib_host_swap_buffers`), the runtime captures a GPU-backed `ImageBitmap` via `canvas.transferToImageBitmap()`.
   - The worker transfers the bitmap to the main thread via:
     ```javascript
     self.postMessage({ type: 'frame', bitmap }, [bitmap]);
     ```
   - The main thread renders the bitmap with zero memory copying:
     ```javascript
     ctx.transferFromImageBitmap(bitmap);
     ```
4. **Frame Pacing & CPU Conservation**:
   - `SetTargetFPS(fps)` calculates the frame duration budget (e.g. 16.6ms for 60 FPS).
   - In `EndDrawing()`, `raylib-host.js` invokes `Atomics.wait(sharedInt32, SYNC_IDX, 0, delayMs)` on the shared buffer to sleep the worker for the remainder of the frame, preventing 100% CPU utilization.

#### 3.10.3 Dedicated Graphical Console Window
- **In-Page Floating Window (`.graphics-window`)**:
  - Draggable, resizable container with dark theme matching the IDE.
  - Header displays game title (set dynamically by `InitWindow(width, height, title)`), resolution badge (`800x450`), and real-time FPS counter.
  - **Dynamic Dimension Sizing**: The canvas and outer window frame size adapt dynamically to the dimensions passed to `InitWindow(width, height, title)` (e.g. `450x450`, `800x450`). Toggling the graphics window closed and open preserves the configured canvas dimensions rather than resetting to hardcoded default window frames.
  - Control buttons:
    - **Pop Out (`↗`)**: Detaches the canvas into a standalone browser popup window (`window.open`), transferring frame updates and input listeners to the external window for multi-monitor setups.
    - **Dock Back (`↙`)**: Restores the canvas into the floating in-page window inside the IDE.
    - **Minimize (`_`)**: Collapses the window to the top action bar.
    - **Close (`&times;`)**: Sets `WindowShouldClose() = true` via `SharedArrayBuffer`, allowing standard Raylib loops to terminate gracefully.
- **Input Isolation, Lifecycle & Focus Safety**:
  - When the canvas window is clicked/focused, it attaches keyboard and mouse listeners.
  - Mouse `(x, y)` position, button states (left, right, middle), and keypress states are encoded into a 512-byte `SharedArrayBuffer`.
  - Gaming keys (WASD, arrows, space, numbers) are captured by the canvas without injecting keystrokes into `xterm.js`.
  - On launch, cleanup, and window blur events, `inputCoordinator` state is cleanly reset and `shouldClose` is cleared so that focusing the canvas does not prematurely terminate `WindowShouldClose()`.
  - When `xterm.js` is focused, typing routes to the shell or `scanf`.
- **Hybrid Program Concurrency**:
  - A single program can combine standard text I/O with graphics:
    ```c
    #include <stdio.h>
    #include "raylib.h"
    int main() {
        int radius;
        printf("Enter circle radius: ");
        scanf("%d", &radius); // Interactively captured in xterm.js
        InitWindow(640, 480, "My Game");
        SetTargetFPS(60);
        while (!WindowShouldClose()) {
            BeginDrawing();
            ClearBackground(RAYWHITE);
            DrawCircle(320, 240, radius, MAROON);
            EndDrawing();
        }
        CloseWindow();
        printf("Finished!\n");
        return 0;
    }
    ```

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
|   - main.c            | 2 | int main() {                                                |
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

### UI Controls & Ergonomics:
1. **Primary Header Action Buttons**:
   - **Save**: Sky blue / cyan (`#0284c7`) (`#btn-save`)
   - **Compile**: Violet / purple (`#7c3aed`) (`#btn-compile`)
   - **Build**: Primary blue (`#0e639c`) (`#btn-build`)
   - **Run**: Success green (`#388a34`) (`#btn-run`)
   - **Stop**: Danger red (`#c72e2e`) (`#btn-stop`)
   - **Canvas Toggle**: Amber / orange (`#d97706`) (`#btn-graphics-window`)
   - **Settings**: Neutral gray (`#btn-settings`)
2. **Settings Modal Checkbox**:
   - `[x] Enable Raylib Graphics Support` toggles Raylib integration.
3. **Graphics Window Controls**:
   - Floating draggable window with `#raylib-canvas`.
   - Title dynamically synchronized with `InitWindow`.
   - Real-time FPS indicator and resolution badge.
   - Pop-Out (`↗`) button for external OS window detach and Dock (`↙`) to return.

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
| **Raylib Settings Toggle** | Toggling Raylib in Settings modal persists to config and conditionally mounts `raylib.h`, `raymath.h`, `rlgl.h`, and `libraylib.a`. |
| **Makefile & Build Script Generation** | When Raylib is enabled, generated `Makefile` and `build.sh` include `-lraylib` in link commands. |
| **Raylib Pure C Compilation** | `gcc -Iinclude -Wall -c src/main.c -o build/main.o` compiles Raylib C code without errors. |
| **Linkage with `-lraylib`** | `gcc build/main.o -lraylib -o a.out` produces a runnable `.wasm` binary without unresolved symbol errors. |
| **Interactive Canvas Window Creation** | Calling `InitWindow(640, 480, "Demo")` opens the Graphical Console at 640x480 with title "Demo". |
| **Zero-Copy Frame Rendering** | Shapes and text render to canvas at ~60 FPS without WebGL errors or browser UI freeze. |
| **Frame Pacing & CPU Yield** | `SetTargetFPS(60)` sleeps the worker between frames via `Atomics.wait()`, keeping idle CPU low. |
| **Canvas Input Capture** | Arrow keys and mouse movements interact with game objects when canvas is focused without typing into xterm.js. |
| **Concurrent Terminal I/O** | `printf` and `scanf` in the same program interact with xterm.js while graphics render on the canvas. |
| **Clean Close Termination** | Clicking the graphics window close button or pressing Escape sets `WindowShouldClose() = true` and exits loop cleanly. |
| **Window Pop-Out & Dock** | Clicking Pop-Out moves rendering to a standalone OS window; clicking Dock restores it to the IDE without interrupting the running game. |
| **Dynamic Canvas Dimensions** | Initializing window at custom resolution (e.g. 450x450) sets canvas and window frame accordingly; toggling window maintains custom dimensions without resetting to default. |
| **Direct Shell Script Execution** | `./build.sh` or `/workspace/script.sh` executes shell commands without manual `sh` prefix; Wasm validation verifies executable binaries. |
| **Settings Modal Action Decoupling** | Clicking Save updates state and mounts/unmounts libraries without modifying `/workspace`; Generate Build Script creates/updates build files. |
| **MemFS Recompilation Invariant** | Deleting an object file (`build/calc.o`) and re-running `make` cleanly recompiles and relinks without node reuse header corruption. |
| **Offline PWA Operation** | Raylib binaries compile and run while disconnected from the internet via Service Worker caching. |
