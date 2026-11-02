# C/C++ Web IDE Examples

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
## 6. Turtle Graphics with Canvas-WASI Backend
* **File**: [`06_turtle_canvas.c`](./06_turtle_canvas.c)
* **API Used**: `<turtle.h>`, `<turtle_backend_canvas_wasi.h>`
* **Features**:
  * Cartesian coordinate system centered at `(0, 0)` with standard mathematical counter-clockwise angles
  * Progressive animated drawing via `turtle_delay(35.0)`
  * Visual stylized turtle cursor indicator with carapace, flippers, head, and eyes
  * Enabled by default with zero external configuration!
* **How to Compile & Run**:
  ```bash
  gcc 06_turtle_canvas.c -lturtle -o a.out
  ./a.out
  ```

---

## 7. Turtle Graphics with Raylib Backend
* **File**: [`07_turtle_raylib.c`](./07_turtle_raylib.c)
* **API Used**: `<turtle.h>`, `<turtle_backend_raylib.h>`
* **Features**:
  * Hardware-accelerated Raylib 5.5 rendering loop driving turtle geometry
  * 72-segment geometric rosette with progressive sub-frame animation
  * Non-destructive overlay cursor rendering over persistent canvas
* **Prerequisite**:
  * In the IDE header bar, click **Settings** and ensure **Enable Raylib** is checked.
* **How to Compile & Run**:
  ```bash
  gcc 07_turtle_raylib.c -lturtle_raylib -lraylib -o a.out
  ./a.out
  ```

---

## 8. ANSI Terminal & Screen Control Demo
* **File**: [`08_ansi_terminal.c`](./08_ansi_terminal.c)
* **API Used**: Standard C `<stdio.h>`, `<stdlib.h>`, `<unistd.h>` (DEC VT100 / xterm.js ANSI sequences)
* **Features**:
  * Full-screen 80×24 text-mode TUI layout with Unicode/VT100 double-line box drawing
  * Direct cursor coordinate positioning (`\033[<r>;<c>H`) and cursor hiding/restoring (`\033[?25l` / `\033[?25h`)
  * SGR text styling: Bold, Dim, Italic, Underline, and Reverse video
  * 16-color standard ANSI color palette and 256-color gradient spectrum bar
  * Smooth in-place animated progress bar with telemetry counter without screen flicker
  * Zero external libraries or link flags needed!
* **Recommended Mode**:
  * Click the **Detach Terminal** button (`↗`) on the Terminal pane header (or press `Ctrl+Shift+D`) to pop the terminal into its default **80×24 floating mode**.
* **How to Compile & Run**:
  ```bash
  gcc 08_ansi_terminal.c -o a.out
  ./a.out
  ```

---

## 9. SQLite 3 Database & CLI Integration
* **File**: [`09_sqlite_database.c`](./09_sqlite_database.c)
* **API Used**: SQLite 3 `<sqlite3.h>`
* **Features**:
  * Relational database engine embedded directly in WebAssembly
  * Creates and manages disk-backed database files (`demo.db`) inside `/workspace` with real-time VFS synchronization
  * Table schema definition with constraints and auto-increment primary keys
  * Parameterized prepared statements (`sqlite3_prepare_v2`, `sqlite3_bind_*`, `sqlite3_step`) protecting against injection
  * Formatted record queries and statistical aggregations (`COUNT`, `AVG`, `MAX`, `MIN`)
  * Direct inspection from xterm using the built-in `sqlite3` CLI utility!
* **How to Compile & Run**:
  ```bash
  gcc 09_sqlite_database.c -lsqlite3 -o a.out
  ./a.out
  ```
* **CLI Inspection**:
  ```bash
  sqlite3 demo.db "SELECT * FROM learners;"
  sqlite3 demo.db ".schema"
  ```


