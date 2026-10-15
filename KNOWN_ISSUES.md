# Known Issues & Architectural Constraints

This document catalogs technical limitations, toolchain version gaps, and platform-specific constraints in `wasm-c-ide` to serve as an architectural reference for future roadmap enhancements.

---

## 1. WebAssembly Relocatable Object ABI Mismatch (LLVM 8.0.1 vs. Modern Clang 15–19)

### Context & Impact
While final WebAssembly executable binaries (`.wasm`) are standardized and cross-platform across all compliant engines (V8, SpiderMonkey, JavaScriptCore, Wasmtime, Wasmer), **intermediate relocatable object files (`.o`) and static library archives (`.a`) are compiler-internal intermediate formats**.

When importing external prebuilt libraries—such as `@breeze833/raylib-wasi` via `npm install https://github.com/breeze833/raylib-wasi`—the prebuilt `libraylib.a` provided in upstream GitHub releases was compiled with modern **Clang 19**. Attempting to link this archive using `wasm-c-ide`'s in-browser linker (`lld.wasm`) fails.

### Detailed Root Causes

1. **Wasm Section 12 (`DataCount`) Rejection**:
   - Modern Clang (LLVM 15+) emits WebAssembly Section 12 (`DataCount` section) by default in relocatable object files to support the Bulk Memory Operations proposal.
   - `wasm-c-ide` bundles `lld.wasm` based on **LLVM 8.0.1** (circa 2019). When LLVM 8's `wasm-ld` encounters Section 12 in an object file, it aborts:
     ```
     wasm-ld: error: <object_file>: Bad section type: 12
     ```
   - *Note*: Naively stripping Section 12 from `.o` bytes corrupts the relative byte offsets of relocations in `.reloc.CODE`, causing memory corruption or invalid LEB128 relocation errors during linking.

2. **Relocation Record Types**:
   - Newer versions of LLVM introduced additional relocation types (such as `R_WASM_TABLE_INDEX_REL_SLEB` and new linking metadata versions) that older linkers cannot parse.

3. **Thread-Local Storage (TLS) in WASI libc**:
   - Upstream WASI libc in modern `wasi-sdk` uses thread-local storage models (`extern _Thread_local int errno;`).
   - LLVM 8 without thread support crashes with `GlobalTLSAddress<i32* @errno>`. To compile C files referencing `<errno.h>`, an override `__errno_location(void)` definition must be provided to avoid `_Thread_local`.

4. **Archive Symbol Table Index Requirement**:
   - In-browser `wasm-ld` requires static archives (`.a`) to have a valid symbol table index (e.g. generated via `llvm-ar s` or `ranlib`). Without an archive index, `wasm-ld` will report `undefined symbol` for symbols that exist inside the archive members.

5. **Host Function Imports and `--allow-undefined`**:
   - By default, `wasm-ld` treats any unresolved symbol as a fatal link error. For libraries that rely on WebGL and runtime host bindings (such as `raylib_host_*` and `gl*`), `--allow-undefined` must be passed to `wasm-ld` so that these unresolved symbols become imported functions in the final WebAssembly module.

### Current Workaround
- The static library [public/sysroot/wasm/libraylib.a](file:///home/breeze/work/projects/wasm-c-ide/public/sysroot/wasm/libraylib.a) is compiled directly using the LLVM 8 `WasmToolchain` against the bundled WASI sysroot with `-Wno-pedantic`, and indexed with `llvm-ar s`.

### Future Enhancement Roadmap
1. **Upgrade In-Browser Compiler Toolchain**: Upgrade `clang.wasm` and `lld.wasm` from LLVM 8.0.1 to modern LLVM (LLVM 18+ / `wasi-sdk` 22+). This will provide native Section 12 bulk-memory support, modern C++20/C23 features, and full binary compatibility with libraries published to npm by `@breeze833/raylib-wasi`.
2. **Upstream Multi-Target Build in `raylib-wasi` CI**: Add a legacy target matrix in `raylib-wasi` GitHub Actions CI to build and publish an LLVM-8-compatible `libraylib-llvm8.a` alongside the default modern Clang static library.

---

## 2. In-Browser Main Thread Synchronous Wasm Compilation Size Limit (8MB)

### Context & Impact
Browser engines (e.g., Chrome/V8, Safari/JavaScriptCore) impose an 8 MB file size limit on synchronous `new WebAssembly.Module(buffer)` and `WebAssembly.compile(buffer)` calls made on the main thread:
```
RangeError: WebAssembly.compile is disallowed on the main thread, if the buffer size is larger than 8MB
```

### Resolution
All toolchain components (`clang.wasm` ~20 MB, `lld.wasm` ~8 MB) must always be compiled and instantiated using asynchronous methods:
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
