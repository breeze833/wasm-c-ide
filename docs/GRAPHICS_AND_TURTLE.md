# Architectural Specification: Graphics, WebGL & Turtle Graphics Subsystems

This document details the graphics architecture, windowing protocols, and hardware abstraction layers in `wasm-c-ide`, including **`canvas-wasi`**, **`raylib-wasi`**, and **`libturtle`**.

---

## 1. Multi-Tier Graphics Architecture

Graphics in `wasm-c-ide` are decoupled across execution sandboxes to maintain 60 FPS UI responsiveness and zero-copy presentation:

```
+-------------------------------------------------------------------------+
|                        Browser Main Thread                              |
|  - GraphicsWindowUI (canvas-wasi): Floating draggable & popout window   |
|  - InputCoordinator: Synchronizes mouse & keyboard state                |
|  - AudioReceiver (raylib-wasi): Dispatches Web Audio nodes & playback   |
+--------------------+----------------------------------------------------+
                     | SharedArrayBuffer (512B input / 8KB stdin)
                     | ImageBitmap Transfer (Zero-copy postMessage)
                     v
+-------------------------------------------------------------------------+
|                  Runtime Worker (src/workers/runtime.worker.js)         |
|  - User WebAssembly Binary (a.out)                                      |
|  - OffscreenCanvas & WebGL Context                                      |
|  - Frame Pacing: Atomics.wait() clamp to 60 FPS                         |
|  - Host Import Bridges (env.gl*, env.raylib*, env.graphics*)            |
+-------------------------------------------------------------------------+
```

---

## 2. Software Framebuffer & 2D Vector Canvas (`canvas-wasi`)

`canvas-wasi` provides two zero-dependency C programming models:
1. **Software 32-bit RGBA Framebuffer (`<graphics.h>`)**:
   - Pixel buffer layout: little-endian `0xAABBGGRR` (Red = byte 0, Green = byte 1, Blue = byte 2, Alpha = byte 3).
   - Functions (8 total): `graphics_init(w, h, title)`, `graphics_present(pixels)`, `graphics_present_rgba(rgba, w, h)`, `graphics_wait_frame(fps)`, `graphics_should_close()`, `graphics_close()`, `graphics_get_mouse(&x, &y, &btn, &wheel)`, `graphics_is_key_down(key)`.
2. **HTML5 2D Vector Primitives (`<graphics_canvas.h>`)**:
   - Canvas 2D API (30 total): Frame presentation (`canvas_present`), rectangles & clearing (`canvas_clear_rect`, `canvas_fill_rect`, `canvas_stroke_rect`), path drawing (`canvas_begin_path`, `canvas_close_path`, `canvas_move_to`, `canvas_line_to`, `canvas_arc`, `canvas_fill`, `canvas_stroke`), styling & colors (`canvas_set_fill_style`, `canvas_set_stroke_style`, `canvas_set_fill_rgb`, `canvas_set_line_width`, `canvas_set_line_cap`), typography (`canvas_fill_text`, `canvas_stroke_text`, `canvas_set_font`), matrix transforms (`canvas_save`, `canvas_restore`, `canvas_translate`, `canvas_rotate`, `canvas_scale`), and pixel-level manipulation (`canvas_get_image_data`, `canvas_put_image_data`, `canvas_get_pixels`, `canvas_put_pixels`, `canvas_get_pixel`, `canvas_set_pixel`).
   - Retained Blitting: Preserves drawing surfaces across frames without flashing or flickering.

---

## 3. WebGL 3D & Immediate-Mode GUI Engine (`raylib-wasi`)

`raylib-wasi` compiles upstream Raylib 5.5 to WASI Preview 1 without modifying upstream C sources (`vendor/raylib`):
- **OpenGL ES 2.0 / WebGL Bridge**: State machine and handle table in `src/host/gl-context.js` mapping C pointers and integer handles to native `WebGLBuffer`, `WebGLTexture`, `WebGLProgram`, and `WebGLShader` instances.
- **Audio Subsystem**: Web Audio bridge in `src/host/audio-context.js` supporting procedural waveform synthesis, WAV/MP3 decoding, and real-time streaming sound buffers.
- **Immediate-Mode GUI (`raygui.h`)**: Full support for controls (buttons, sliders, toggles, text boxes, message boxes) rendered at 60 FPS.

---

## 4. Turtle Graphics Pedagogical Library (`libturtle`)

`libturtle` provides an educational graphics abstraction designed for beginning students:

### 4.1 Cartesian Coordinate Convention
- Center of canvas is $(0, 0)$.
- Angle $0^\circ$ points North ($+Y$), $90^\circ$ points East ($+X$), rotating clockwise.
- Coordinates use high-precision `double` floating-point math internally.

### 4.2 Dual Backends
1. **Canvas-WASI Backend (`libturtle_canvas-wasi.a` / `libturtle.a`)**:
   - Compiles with `<turtle.h>` and `-lturtle`.
   - Lightweight, zero-dependency 2D vector renderer targeting HTML5 canvas.
2. **Raylib Backend (`libturtle_raylib.a`)**:
   - Compiles with `<turtle.h>` and `-lturtle_raylib -lraylib`.
   - Persistent `RenderTexture2D` line drawing with stylized turtle cursor overlays.

### 4.3 Pedagogical Invariants
- `turtle_goto()` and `turtle_backward()` are **deliberately omitted** from the core library as reserved student assignment problems.
- Backend initialization uses unique link-time symbols (`raylib_turtle_init` vs `canvas_wasi_turtle_init`) wrapped by `#define turtle_begin(ctx)`.
