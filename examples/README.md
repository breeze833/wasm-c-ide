# Wasm C/C++ IDE Examples

This directory provides ready-to-run, single-file C programs demonstrating the different execution and graphics capabilities of the in-browser IDE.

You can copy and paste the code from any of these files into the IDE editor (`workspace/main.c`) to test them manually.

---

## 1. Standard I/O Console Program
* **File**: [`01_stdio.c`](./01_stdio.c)
* **API Used**: Standard C `<stdio.h>`, `<stdlib.h>`
* **Features**:
  * Interactive terminal input and output (`printf`, `scanf`)
  * Interactive menu with Fibonacci, Factorial, and Prime number computations
  * Demonstrates synchronous `scanf` in the xterm.js virtual terminal via `SharedArrayBuffer`
* **How to Compile & Run**:
  ```bash
  gcc 01_stdio.c -o a.out
  ./a.out
  ```

---

## 2. Interactive Raylib 5.5 Program
* **File**: [`02_raylib_interactive.c`](./02_raylib_interactive.c)
* **API Used**: Raylib 5.5 `<raylib.h>`
* **Features**:
  * Hardware-accelerated WebGL 2D/3D graphics engine
  * Keyboard input: WASD / Arrow keys move player avatar, Space bar changes colors
  * Mouse input: Cursor position tracking and left-click particle burst effects
  * Real-time FPS counter and smooth 60 FPS pacing
* **Prerequisite**:
  * In the IDE header bar, click **Settings** and ensure **Enable Raylib** is checked (or use `-lraylib` in your compile command).
* **How to Compile & Run**:
  ```bash
  gcc 02_raylib_interactive.c -lraylib -o a.out
  ./a.out
  ```

---

## 3. Direct Framebuffer Graphics Program
* **File**: [`03_framebuffer_graphics.c`](./03_framebuffer_graphics.c)
* **API Used**: `<graphics.h>`
* **Features**:
  * Direct software framebuffer manipulation in memory (`uint32_t *pixels`)
  * Real-time procedural color plasma effect calculated per-pixel
  * Interactive mouse brush directly writing into pixel memory
  * Zero external libraries or link flags needed!
* **How to Compile & Run**:
  ```bash
  gcc 03_framebuffer_graphics.c -o a.out
  ./a.out
  ```

---

## 4. HTML5 2D Vector Canvas Program
* **File**: [`04_canvas_vector.c`](./04_canvas_vector.c)
* **API Used**: `<graphics_canvas.h>`
* **Features**:
  * High-level 2D vector drawing backed by the browser's native `OffscreenCanvas` 2D context (`CanvasRenderingContext2D`)
  * Bouncing ball physics with anti-aliased vector circles (`canvas_arc`)
  * Rotating matrix transform star (`canvas_save`, `canvas_rotate`, `canvas_restore`)
  * Vector typography (`canvas_set_font`, `canvas_fill_text`)
  * Interactive mouse proximity web lines
  * Zero external libraries or link flags needed!
* **How to Compile & Run**:
  ```bash
  gcc 04_canvas_vector.c -o a.out
  ./a.out
  ```

---

## 5. Canvas Pixel Manipulation & 2D Image Processing Program
* **File**: [`05_canvas_pixels.c`](./05_canvas_pixels.c)
* **API Used**: `<graphics_canvas.h>`
* **Features**:
  * Direct pixel-level framebuffer access from Canvas 2D (`canvas_get_pixels`, `canvas_put_pixels`)
  * Sub-rectangle pixel data transfer (`canvas_get_image_data`, `canvas_put_image_data`) and single pixel operations (`canvas_get_pixel`, `canvas_set_pixel`)
  * 2D spatial convolution and image processing filters implemented in pure C:
    * 3x3 Sobel Edge Detection (horizontal/vertical gradient magnitude)
    * 3x3 Box Blur (spatial convolution averaging)
    * Grayscale conversion with contrast adjustment
    * Color inversion / negative
  * Real-time interactive spotlight lens tracking the mouse cursor
  * Hybrid pipeline combining vector scene underlay, pixel filter passes, and crisp vector HUD overlay
  * Zero external libraries or link flags needed!
* **How to Compile & Run**:
  ```bash
  gcc 05_canvas_pixels.c -o a.out
  ./a.out
  ```

