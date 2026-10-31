# Known Issues & Architectural Constraints

This document catalogs technical limitations, toolchain version gaps, and platform-specific constraints in `wasm-c-ide` to serve as an architectural reference for future roadmap enhancements.

---

## 1. In-Browser Main Thread Synchronous Wasm Compilation Size Limit (8MB)

### Context & Impact
Modern browser JavaScript engines (V8 in Chromium, JavaScriptCore in WebKit/Safari, SpiderMonkey in Firefox) enforce an 8 MB size limit on synchronous WebAssembly module compilation on the main thread:
```
RangeError: WebAssembly.compile is disallowed on the main thread, if the buffer size is larger than 8MB
```
Or synchronously via `new WebAssembly.Module(buffer)`.

Because the IDE's toolchain module is substantial (`llvm-box.wasm` ~60 MB), any attempt to compile or instantiate it synchronously on the UI thread causes an immediate fatal `RangeError`.

### Architectural Invariant & Resolution
All toolchain modules must always be compiled and instantiated using asynchronous methods:
```javascript
const module = await WebAssembly.compile(buffer);
const instance = await WebAssembly.instantiate(module, imports);
```
Or offloaded entirely to Web Workers. In `src/toolchain/wasm-clang.js`, `AppInstance.create()` strictly uses asynchronous `WebAssembly.instantiate` / `WebAssembly.compile`.

---

## 2. OffscreenCanvas Rendering Checkpoints & Synchronous C Game Loops in Web Workers

### Context & Impact
Standard interactive Raylib and graphics game loops in C/C++ run continuous synchronous loops:
```c
while (!WindowShouldClose()) {
    BeginDrawing();
    // ... drawing operations ...
    EndDrawing();
}
```
When executing inside a Web Worker, this synchronous C loop runs continuously on the worker's thread and never yields back to the JavaScript event loop.

Modern browsers do not support deprecated WebGL `gl.commit()`. If an `HTMLCanvasElement` is transferred to a worker via `canvas.transferControlToOffscreen()`, the browser compositor only updates rendered frames during the worker's JavaScript **event loop checkpoint** ("Update the rendering" microtask step). Because the synchronous loop never yields, transferred canvases remain blank. Furthermore, Promise-based frame capture APIs (`createImageBitmap().then(...)`) suffer microtask starvation and never resolve during synchronous Wasm execution.

### Architectural Invariant & Resolution
The IDE implements a dual-thread rendering architecture:
1. **Main Thread Canvas Ownership**: The main UI thread owns the onscreen `<canvas>` elements (`#graphics-canvas` and `#graphics-popup-canvas`) with an `ImageBitmapRenderingContext` (`canvas.getContext('bitmaprenderer')`).
2. **Worker OffscreenCanvas**: The Web Worker creates an independent `OffscreenCanvas` (`new OffscreenCanvas(width, height)`).
3. **Synchronous Frame Capture**: In `presentBuffer` and `canvas_present` (`canvas-wasi` and `raylib-wasi`), the worker calls `offscreen.transferToImageBitmap()`, creating an `ImageBitmap` **synchronously** without Promises.
4. **Zero-Copy Frame Transfer**: The bitmap is immediately transferred to the main thread via `self.postMessage({ type: 'frame', bitmap }, [bitmap])` (zero-copy GPU buffer transfer).
5. **Universal Fallback**: In environments where 2D `transferToImageBitmap()` is unsupported, raw pixel buffers are transferred synchronously via transferable `ArrayBuffer` (`postMessage({ type: 'frame_buffer', buffer, width, height }, [buffer])`).
6. **Frame Pacing**: Frame rate throttling is maintained via `Atomics.wait()` in `graphics_wait_frame` and `EndDrawing()`.

---

## 3. WASI Preview 1 Filesystem Sandbox Scope & Special Device Constraints

### Context & Implementation
User binaries (`./a.out`) run inside a WASI Preview 1 (`wasm32-wasip1`) sandbox in `runtime.worker.js`.

The runtime bridges the IDE's Virtual File System (VFS) to WASI Preview 1 filesystem syscalls:
- **Capability Pre-Opens**: Directory descriptors are pre-opened for `.` (working directory), `/workspace`, and `/`.
- **In-Code Standard File I/O**: Full support for standard C (`<stdio.h>`) and C++ (`<fstream>`) file operations (`fopen`, `fread`, `fwrite`, `fseek`, `ftell`, `fgetc`, `fputc`, `fgets`, `fputs`, `fprintf`, `fscanf`, `fclose`, `remove`, `rename`, `std::ifstream`, `std::ofstream`).
- **All Standard Access Modes**: Supports `"r"`, `"w"`, `"a"`, `"rb"`, `"wb"`, `"ab"`, `"r+"`, `"w+"`, `"a+"`, `"r+b"`, `"w+b"`, `"a+b"`.
- **Bi-Directional VFS Synchronization**: Files created, written, or removed by user programs inside `/workspace` automatically update the host VFS, refresh the File Tree UI, update open editor tabs, and persist to IndexedDB.

### Platform Constraints & Out-of-Scope Operations
Because the runtime executes entirely client-side within the browser sandbox:
1. **No POSIX Permissions / Ownership**: Calls modifying permissions (`chmod`, `chown`) or querying POSIX user/group IDs are non-functional or simulated with default permissions.
2. **No Hardware Device Access or ioctl**: Devices under `/dev` (aside from character streams `stdin`, `stdout`, `stderr`), raw block devices, and driver `ioctl()` calls are not available.
3. **No Network Sockets**: Standard Berkeley socket calls (`socket()`, `connect()`, `bind()`, `listen()`) are not supported in WASI Preview 1 client-side execution.

---

## 4. WebAssembly Dynamic Shared Object (`.so`) Linker & Runtime Loader Scope

### Context & Impact
The LLVM 19 toolchain fully supports compiling position-independent code (`-fPIC`, `-fpic`) and generating WebAssembly shared objects (`.so`) via `wasm-ld --shared`:
```bash
gcc -shared -fPIC src/math.c -o build/libmath.so
gcc src/main.c build/libmath.so -o a.out
```
This produces compliant WebAssembly binaries containing standard `dylink.0` custom sections and dynamic import entries.

However:
1. **Upstream Linker Warning**: Modern `wasm-ld` outputs an informational notice during shared library creation:
   ```
   wasm-ld: warning: creating shared libraries, with -shared, is not yet stable
   ```
2. **Runtime Dynamic Linker (`dlopen`/`ld.so`)**: The in-worker user binary execution runtime (`runtime.worker.js`) does not bundle a runtime dynamic linker to automatically discover, inspect, and instantiate `.so` dependencies from `/workspace` when `./a.out` is launched from the shell prompt.

### Recommended Architectural Practice
For educational teaching and multi-file projects, **static libraries (`.a`) using the built-in `ar` archiver** are the recommended, fully supported mechanism:
```bash
gcc -c src/calc.c -o build/calc.o
ar rcs build/libcalc.a build/calc.o
gcc build/main.o -Lbuild -lcalc -o a.out
```
Static linking produces self-contained executables that execute seamlessly across all browsers and execution targets.

---

## 5. Single-Threaded WASI Sandbox & Lack of Process Forking / Threading

### Context & Impact
The WASI Preview 1 specification (`wasm32-wasip1`) is fundamentally a single-process, single-threaded architecture:
- **No Process Forking**: Syscalls such as `fork()`, `execve()`, `waitpid()`, and POSIX signal handling do not exist in WASI Preview 1 and cannot run client-side in the browser.
- **Stubbed Threading**: `pthread_create`, `pthread_join`, and C++ `std::thread` cannot spawn operating system threads. The sysroot provides a minimal stub `libpthread.a` satisfying symbol resolution for single-threaded binaries.

### Process Lifecycle & Runaway Loop Interruption
Process lifecycle and cancellation are handled out-of-band by the host `RuntimeManager`:
- An infinite loop (e.g. `while(1);`) will not freeze the browser UI thread because user code executes inside a dedicated Web Worker.
- Pressing `Ctrl+C` in `xterm.js` or clicking the UI **Stop** button terminates the Web Worker immediately, safely reclaiming WebAssembly memory and resetting the graphical window and terminal prompt.

---

## 6. Cross-Origin Isolation (COOP/COEP) Prerequisite for Synchronous Stdin

### Context & Impact
Interactive blocking terminal input (`scanf`, `cin`, `getchar`) and zero-latency mouse/keyboard coordination rely on `SharedArrayBuffer` and `Atomics.wait()` / `Atomics.notify()`.

Following modern browser security specifications (Spectre mitigations), browsers disable `SharedArrayBuffer` unless the page is hosted in a **Cross-Origin Isolated** environment with the following HTTP response headers:
```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Fallbacks & Behavioral Constraints
- **Static Hosting via Service Worker**: The IDE bundles `coi-serviceworker.js` to inject COOP/COEP headers on static hosting environments like GitHub Pages.
- **First-Load Unisolated Window**: On the initial uncached page load before the Service Worker registers and claims clients, `window.crossOriginIsolated` may be `false` until the page reloads.
- **Restricted Environments**: When running inside environments that prohibit Service Workers (e.g. `file://` URLs, sandboxed iframes without `allow-same-origin`, or restrictive enterprise private browsing modes), `SharedArrayBuffer` cannot be instantiated.
- **Degraded Execution Mode**: When unisolated, the IDE displays a `"Not Isolated (SharedArrayBuffer Disabled)"` warning badge in the settings toolbar. Graphics input falls back to asynchronous `postMessage` event streams, but synchronous `Atomics.wait()` stdin is disabled. Programs requiring input should use stream redirection (`./a.out < input.txt`).

---

## 7. High-Frequency Canvas 2D Single-Pixel Updates (`canvas_set_pixel`)

### Context & Impact
When using `<graphics_canvas.h>`, programs can invoke `canvas_set_pixel(x, y, color)`.

In standard HTML5 Canvas 2D implementations, modifying individual pixels via `ctx.putImageData(ctx.createImageData(1, 1), x, y)` inside tight C loops (e.g., thousands of times per frame) causes severe GPU command buffer stalls and pipeline flushes in Chromium/V8, dropping frame rates to single digits.

### Architectural Invariant & Optimization
1. **FillRect Optimization**: The runtime worker optimizes `canvas_set_pixel` by converting the 32-bit RGBA integer to an `rgba(...)` fill style and invoking `ctx.fillRect(x, y, 1, 1)`, avoiding `ImageData` overhead.
2. **Direct Framebuffer Recommendation**: For procedural pixel effects, raytracers, or 2D image filters (such as Sobel edge detection or blur), developers should avoid per-pixel host calls and instead use:
   - **Direct Linear Memory Raster Buffers**: Fetch and commit pixel buffers in bulk via `canvas_get_pixels()` / `canvas_put_pixels()` or `canvas_get_image_data()` / `canvas_put_image_data()`.
   - **Generic Software Framebuffer**: Use `<graphics.h>` (`graphics_present()`), which writes directly to a continuous C memory array and transfers the entire frame in a single host call.
