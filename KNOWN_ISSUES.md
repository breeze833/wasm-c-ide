# Known Issues & Architectural Constraints

This document catalogs technical limitations, toolchain version gaps, and platform-specific constraints in `wasm-c-ide` to serve as an architectural reference for future roadmap enhancements.

---

## 1. WebAssembly Relocatable Object ABI Compatibility (Resolved in LLVM 19.1.0)

### Status: RESOLVED
The in-browser toolchain has been upgraded from legacy LLVM 8.0.1 to **LLVM 19.1.0** targeting **WASI Preview 1 (`wasm32-wasip1`)** using prebuilt binaries from [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi) and [`breeze833/raylib-wasi`](https://github.com/breeze833/raylib-wasi).

### Key Architectural Resolutions:
1. **Wasm Section 12 (`DataCount`) Support**:
   - Modern `wasm-ld` 19 natively parses and links object files containing Section 12 (`DataCount` section) emitted by modern Clang for bulk-memory operations.
2. **Relocation Record Types**:
   - Full support for modern relocation types (`R_WASM_TABLE_INDEX_REL_SLEB`, 64-bit table indices, modern linking metadata versions).
3. **Raylib 5.5 Linkage**:
   - `libraylib.a` compiled from `breeze833/raylib-wasi` links directly without ABI incompatibilities or section errors.
4. **Builtin Runtime**:
   - Builtin compiler runtime `libclang_rt.builtins.a` is included and automatically linked for WebAssembly operations.
5. **WebAssembly Shared Object (`.so`) Support**:
   - `wasm-ld` 19 supports creating dynamic shared libraries via `--shared` with `dylink.0` sections and position-independent code (`-fPIC`). Note that `wasm-ld` outputs an upstream informational warning (`wasm-ld: warning: creating shared libraries, with -shared, is not yet stable`), but `.so` creation, linkage, and execution function as intended.

---

## 2. In-Browser Main Thread Synchronous Wasm Compilation Size Limit (8MB)

### Context & Impact
Browser engines (e.g., Chrome/V8, Safari/JavaScriptCore) impose an 8 MB file size limit on synchronous `new WebAssembly.Module(buffer)` and `WebAssembly.compile(buffer)` calls made on the main thread:
```
RangeError: WebAssembly.compile is disallowed on the main thread, if the buffer size is larger than 8MB
```

### Resolution
All toolchain components (`clang.wasm` ~50 MB, `lld.wasm` ~25 MB) must always be compiled and instantiated using asynchronous methods:
```javascript
const module = await WebAssembly.compile(buffer);
const instance = await WebAssembly.instantiate(module, imports);
```
Or offloaded to Web Workers.

---

## 3. OffscreenCanvas Rendering Checkpoints in Web Workers

### Context & Impact
When standard Raylib games run their game loop (`while (!WindowShouldClose())`), execution is synchronous within the Web Worker.

If an `HTMLCanvasElement` is transferred to a worker via `canvas.transferControlToOffscreen()`, the browser only updates rendered frames during the worker's JavaScript **event loop checkpoint** ("Update the rendering" step). Because the synchronous C loop never yields back to the JavaScript event loop, and WebGL `gl.commit()` is deprecated and removed from modern browsers, the canvas remains blank.

### Resolution
- The **main thread** owns the onscreen `<canvas>` with an `ImageBitmapRenderingContext` (`canvas.getContext('bitmaprenderer')`).
- The **Web Worker** creates an independent `OffscreenCanvas` (`new OffscreenCanvas(width, height)`).
- On each frame swap, `canvas.transferToImageBitmap()` captures a GPU `ImageBitmap` and transfers it via `postMessage({ type: 'frame', bitmap }, [bitmap])` (zero-copy GPU buffer transfer).
- The main thread immediately renders the bitmap via `ctx.transferFromImageBitmap(bitmap)`.

---

## 4. MemFS (`memfs.wasm`) Inode Memory Reuse & Capacity (Resolved in Native WASI Preview 1 MemFS)

### Status: RESOLVED
The legacy 2019 `memfs.wasm` binary has been replaced with a modern, native WASI Preview 1 implementation built upstream and released via [`breeze833/clang-wasi`](https://github.com/breeze833/clang-wasi) (`v19.1.0`):
1. **Dynamic Node Allocation**:
   - Replaced fixed `MAX_NODES = 1024` with dynamically reallocated node vector (`Node** g_nodes`). Sysroot extraction with over 4,300 files now runs smoothly without running out of inodes.
2. **Explicit Memory Deallocation & Zeroing on Unlink**:
   - `DeleteNode` explicitly frees member buffers (`free(node->file.data)`, `free(node->name)`, `free(node->dir.dirents)`) and zeroes out node structures before placing them onto the free list. When an inode is recycled, its buffers and offsets begin at byte 0 cleanly.
3. **Safe Lookups**:
   - `FindNode` returns 0 if a node is not found rather than asserting and trapping with WebAssembly `unreachable`.
4. **WASI Preview 1 Alignment**:
   - Modern `__wasi_filestat_t` layout (`size` at byte offset 32), standard whence mapping (`0=SET, 1=CUR, 2=END`), and `path_link` export prevent all struct alignment and seek discrepancies.
5. **Architectural Guardrails Maintained**:
   - `MemFS.removeFile` maintains defensive truncation before unlinking as a safety invariant, and `executeGccCommand` synchronizes deleted workspace files and validates file existence.


