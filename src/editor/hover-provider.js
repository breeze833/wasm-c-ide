// Monaco Hover and Completion Provider for Custom Sysroot Headers (<turtle.h>, <graphics.h>, <graphics_canvas.h>)

export const CUSTOM_API_DOCS = {
  // =========================================================================
  // Turtle Graphics (<turtle.h>, <turtle_backend_canvas_wasi.h>)
  // =========================================================================
  turtle_begin: {
    signature: 'bool turtle_begin(void *context)',
    doc: `**turtle_begin(ctx)**
Initializes the turtle graphics subsystem and state machine with the given backend context.

*Note:* Expands via macro to \`<backend>_turtle_init(ctx) && turtle_begin_core()\`.
Requires linking with \`-lturtle\` (canvas-wasi backend) or \`-lturtle_raylib -lraylib\` (Raylib backend).

- **Origin**: Center of the canvas \`(0, 0)\`
- **Orientation**: \`+Y\` North, \`+X\` East, initial heading = \`0°\` (East)`
  },
  turtle_begin_core: {
    signature: 'bool turtle_begin_core(void)',
    doc: `**turtle_begin_core()**
Core state machine initializer called automatically by \`turtle_begin(ctx)\`.`
  },
  turtle_end: {
    signature: 'void turtle_end(void)',
    doc: `**turtle_end()**
Terminates turtle graphics, cleans up allocated rendering resources, and closes the canvas window.`
  },
  turtle_clear: {
    signature: 'void turtle_clear(uint32_t color)',
    doc: `**turtle_clear(color)**
Clears the entire canvas surface with the specified 32-bit RGBA background color (\`0xRRGGBBAA\`).`
  },
  turtle_home: {
    signature: 'void turtle_home(void)',
    doc: `**turtle_home()**
Returns the turtle to the origin center \`(0, 0)\` and resets heading to \`0°\` (Facing East).
Does not clear existing drawn lines.`
  },
  turtle_delay: {
    signature: 'void turtle_delay(double ms)',
    doc: `**turtle_delay(ms)**
Pauses execution for \`ms\` milliseconds, flushes line primitives to the display canvas, and paces interactive drawing.`
  },
  turtle_forward: {
    signature: 'void turtle_forward(double steps)',
    doc: `**turtle_forward(steps)**
Moves the turtle along its current heading by \`steps\` pixels.
If the pen is down, draws a line of current stroke width and color.
*Positive* = forward; *Negative* = backward.`
  },
  turtle_turn: {
    signature: 'void turtle_turn(double deg)',
    doc: `**turtle_turn(deg)**
Rotates the turtle heading by \`deg\` degrees following mathematical convention (Counter-Clockwise positive).`
  },
  turtle_turn_left: {
    signature: 'void turtle_turn_left(double deg)',
    doc: `**turtle_turn_left(deg)**
Rotates the turtle heading counter-clockwise (to the left) by \`deg\` degrees.`
  },
  turtle_turn_right: {
    signature: 'void turtle_turn_right(double deg)',
    doc: `**turtle_turn_right(deg)**
Rotates the turtle heading clockwise (to the right) by \`deg\` degrees.`
  },
  turtle_pen_down: {
    signature: 'void turtle_pen_down(void)',
    doc: `**turtle_pen_down()**
Lowers the drawing pen. Subsequent turtle movement will leave a colored stroke on the canvas.`
  },
  turtle_pen_up: {
    signature: 'void turtle_pen_up(void)',
    doc: `**turtle_pen_up()**
Lifts the drawing pen. Subsequent turtle movement will not draw lines.`
  },
  turtle_is_pen_down: {
    signature: 'int turtle_is_pen_down(void)',
    doc: `**turtle_is_pen_down()**
Returns \`1\` if the pen is currently down, or \`0\` if the pen is lifted.`
  },
  turtle_pen_stroke: {
    signature: 'void turtle_pen_stroke(double stroke)',
    doc: `**turtle_pen_stroke(stroke)**
Sets the pen stroke width (thickness) in pixels.`
  },
  turtle_pen_color: {
    signature: 'void turtle_pen_color(uint32_t color)',
    doc: `**turtle_pen_color(color)**
Sets the pen drawing color using a 32-bit packed RGBA value (\`0xRRGGBBAA\`).
Use \`TURTLE_RGBA(r, g, b, a)\` or standard constants: \`TURTLE_RED\`, \`TURTLE_BLUE\`, \`TURTLE_GREEN\`, etc.`
  },
  turtle_pen: {
    signature: 'void turtle_pen(double stroke, uint32_t color, int is_down)',
    doc: `**turtle_pen(stroke, color, is_down)**
Convenience function to set stroke width, color, and pen up/down state in a single call.`
  },
  turtle_set_visible: {
    signature: 'void turtle_set_visible(bool visible)',
    doc: `**turtle_set_visible(visible)**
Controls whether the stylized turtle cursor icon is rendered on the display canvas.`
  },
  turtle_is_visible: {
    signature: 'bool turtle_is_visible(void)',
    doc: `**turtle_is_visible()**
Returns \`true\` if the turtle cursor icon is currently visible.`
  },
  turtle_get_x: {
    signature: 'double turtle_get_x(void)',
    doc: `**turtle_get_x()**
Returns the current turtle X coordinate in pixels relative to center origin \`(0, 0)\` (\`+X\` is East/Right).`
  },
  turtle_get_y: {
    signature: 'double turtle_get_y(void)',
    doc: `**turtle_get_y()**
Returns the current turtle Y coordinate in pixels relative to center origin \`(0, 0)\` (\`+Y\` is North/Up).`
  },
  turtle_get_heading: {
    signature: 'double turtle_get_heading(void)',
    doc: `**turtle_get_heading()**
Returns the current turtle heading in degrees (\`0.0\` to \`360.0\`, where \`0°\` is East/Right and \`90°\` is North/Up).`
  },
  canvas_wasi_turtle_init: {
    signature: 'bool canvas_wasi_turtle_init(void *context)',
    doc: `**canvas_wasi_turtle_init(context)**
Backend initializer for Canvas-WASI. Links with \`-lturtle\`.`
  },
  raylib_turtle_init: {
    signature: 'bool raylib_turtle_init(void *context)',
    doc: `**raylib_turtle_init(context)**
Backend initializer for Raylib. Links with \`-lturtle_raylib -lraylib\`.`
  },

  // =========================================================================
  // Direct Software Framebuffer (<graphics.h>)
  // =========================================================================
  graphics_init: {
    signature: 'void graphics_init(int width, int height, const char *title)',
    doc: `**graphics_init(width, height, title)**
Initializes the graphics window with specified buffer width, height, and title bar text.`
  },
  graphics_present: {
    signature: 'void graphics_present(const uint32_t *pixels)',
    doc: `**graphics_present(pixels)**
Transfers a 32-bit little-endian RGBA (\`0xAABBGGRR\`) pixel buffer to the display canvas:
- Byte 0: Red (0 - 255)
- Byte 1: Green (0 - 255)
- Byte 2: Blue (0 - 255)
- Byte 3: Alpha (0 - 255)`
  },
  graphics_present_rgba: {
    signature: 'void graphics_present_rgba(const uint8_t *rgba, int width, int height)',
    doc: `**graphics_present_rgba(rgba, width, height)**
Presents a raw RGBA byte buffer with custom dimensions directly to the graphics window.`
  },
  graphics_should_close: {
    signature: 'bool graphics_should_close(void)',
    doc: `**graphics_should_close()**
Returns \`true\` if the user has requested closing the graphics window or pressed the close button.`
  },
  graphics_close: {
    signature: 'void graphics_close(void)',
    doc: `**graphics_close()**
Explicitly requests closing the graphics window.`
  },
  graphics_wait_frame: {
    signature: 'void graphics_wait_frame(int target_fps)',
    doc: `**graphics_wait_frame(target_fps)**
Paces the rendering loop to the specified target FPS (typically 60) via synchronous \`Atomics.wait()\`, preventing CPU busy-looping.`
  },
  graphics_get_mouse: {
    signature: 'void graphics_get_mouse(int *x, int *y, int *buttons, int *wheel)',
    doc: `**graphics_get_mouse(x, y, buttons, wheel)**
Reads current mouse coordinates \`(x, y)\`, button bitmask (bit 0 = left, bit 1 = right, bit 2 = middle), and scroll wheel delta.`
  },
  graphics_is_key_down: {
    signature: 'bool graphics_is_key_down(int key)',
    doc: `**graphics_is_key_down(key)**
Synchronously queries if the specified key is currently held down (e.g. 27 for ESC, 32 for Space, 37-40 for Arrows, or ASCII characters).`
  },

  // =========================================================================
  // HTML5 Canvas 2D Vector Primitives (<graphics_canvas.h>)
  // =========================================================================
  canvas_present: {
    signature: 'void canvas_present(void)',
    doc: `**canvas_present()**
Flushes and presents the vector drawing commands onto the active canvas window, preserving drawing buffer contents.`
  },
  canvas_clear_rect: {
    signature: 'void canvas_clear_rect(float x, float y, float w, float h)',
    doc: `**canvas_clear_rect(x, y, w, h)**
Clears the specified rectangular area to transparent black (\`rgba(0,0,0,0)\`).`
  },
  canvas_fill_rect: {
    signature: 'void canvas_fill_rect(float x, float y, float w, float h)',
    doc: `**canvas_fill_rect(x, y, w, h)**
Fills a rectangle at \`(x, y)\` with dimensions \`(w, h)\` using the current fill style.`
  },
  canvas_stroke_rect: {
    signature: 'void canvas_stroke_rect(float x, float y, float w, float h)',
    doc: `**canvas_stroke_rect(x, y, w, h)**
Strokes a rectangle outline at \`(x, y)\` with dimensions \`(w, h)\` using the current stroke style and line width.`
  },
  canvas_begin_path: {
    signature: 'void canvas_begin_path(void)',
    doc: `**canvas_begin_path()**
Starts a new path or resets the current path on the 2D canvas.`
  },
  canvas_close_path: {
    signature: 'void canvas_close_path(void)',
    doc: `**canvas_close_path()**
Adds a straight line segment from current path position to the start of the current subpath.`
  },
  canvas_move_to: {
    signature: 'void canvas_move_to(float x, float y)',
    doc: `**canvas_move_to(x, y)**
Moves the path cursor to coordinates \`(x, y)\` without drawing.`
  },
  canvas_line_to: {
    signature: 'void canvas_line_to(float x, float y)',
    doc: `**canvas_line_to(x, y)**
Adds a straight line segment from the current position to \`(x, y)\`.`
  },
  canvas_arc: {
    signature: 'void canvas_arc(float x, float y, float radius, float start_angle, float end_angle, bool counterclockwise)',
    doc: `**canvas_arc(x, y, radius, start_angle, end_angle, ccw)**
Adds an arc/circle segment centered at \`(x, y)\` with given radius and radian angles.`
  },
  canvas_fill: {
    signature: 'void canvas_fill(void)',
    doc: `**canvas_fill()**
Fills the current subpaths using the active fill style.`
  },
  canvas_stroke: {
    signature: 'void canvas_stroke(void)',
    doc: `**canvas_stroke()**
Strokes the current subpaths outline using the active stroke style and line width.`
  },
  canvas_set_fill_style: {
    signature: 'void canvas_set_fill_style(const char *style)',
    doc: `**canvas_set_fill_style(style)**
Sets the fill color or pattern using CSS color syntax (e.g. \`"#ff5722"\`, \`"rgba(0, 200, 255, 0.7)"\`, \`"orange"\`).`
  },
  canvas_set_stroke_style: {
    signature: 'void canvas_set_stroke_style(const char *style)',
    doc: `**canvas_set_stroke_style(style)**
Sets the stroke color using CSS color syntax (e.g. \`"#00e5ff"\`, \`"rgb(255, 0, 0)"\`).`
  },
  canvas_set_fill_rgb: {
    signature: 'void canvas_set_fill_rgb(uint8_t r, uint8_t g, uint8_t b)',
    doc: `**canvas_set_fill_rgb(r, g, b)**
Convenience function to set fill color via raw RGB integer components (0 - 255).`
  },
  canvas_set_line_width: {
    signature: 'void canvas_set_line_width(float width)',
    doc: `**canvas_set_line_width(width)**
Sets the line stroke width in pixels.`
  },
  canvas_set_line_cap: {
    signature: 'void canvas_set_line_cap(const char *cap)',
    doc: `**canvas_set_line_cap(cap)**
Sets line end caps: \`"butt"\`, \`"round"\`, or \`"square"\`.`
  },
  canvas_fill_text: {
    signature: 'void canvas_fill_text(const char *text, float x, float y)',
    doc: `**canvas_fill_text(text, x, y)**
Renders filled text characters at coordinate \`(x, y)\` using active font and fill style.`
  },
  canvas_stroke_text: {
    signature: 'void canvas_stroke_text(const char *text, float x, float y)',
    doc: `**canvas_stroke_text(text, x, y)**
Renders stroked text outlines at coordinate \`(x, y)\` using active font and stroke style.`
  },
  canvas_set_font: {
    signature: 'void canvas_set_font(const char *font)',
    doc: `**canvas_set_font(font)**
Sets the text font using standard CSS font syntax (e.g. \`"bold 20px monospace"\`, \`"16px sans-serif"\`).`
  },
  canvas_save: {
    signature: 'void canvas_save(void)',
    doc: `**canvas_save()**
Pushes the entire current transformation matrix, clipping path, and style properties onto the drawing state stack.`
  },
  canvas_restore: {
    signature: 'void canvas_restore(void)',
    doc: `**canvas_restore()**
Pops and restores the most recently saved drawing state from the stack.`
  },
  canvas_translate: {
    signature: 'void canvas_translate(float x, float y)',
    doc: `**canvas_translate(x, y)**
Modifies the current transformation matrix by translating origin coordinates by \`(x, y)\` pixels.`
  },
  canvas_rotate: {
    signature: 'void canvas_rotate(float radians)',
    doc: `**canvas_rotate(radians)**
Modifies the current transformation matrix by rotating coordinate space clockwise by given radians.`
  },
  canvas_scale: {
    signature: 'void canvas_scale(float sx, float sy)',
    doc: `**canvas_scale(sx, sy)**
Modifies the current transformation matrix by scaling coordinate units along X and Y axes.`
  },
  canvas_get_image_data: {
    signature: 'void canvas_get_image_data(int sx, int sy, int sw, int sh, uint32_t *pixels_out)',
    doc: `**canvas_get_image_data(sx, sy, sw, sh, pixels_out)**
Copies a sub-rectangle of canvas pixels into a little-endian \`0xAABBGGRR\` pixel array.`
  },
  canvas_put_image_data: {
    signature: 'void canvas_put_image_data(int dx, int dy, int dw, int dh, const uint32_t *pixels_in)',
    doc: `**canvas_put_image_data(dx, dy, dw, dh, pixels_in)**
Renders a little-endian \`0xAABBGGRR\` pixel array into a sub-rectangle on the canvas.`
  },
  canvas_get_pixels: {
    signature: 'void canvas_get_pixels(uint32_t *pixels_out)',
    doc: `**canvas_get_pixels(pixels_out)**
Reads the entire full-screen canvas into a \`width * height\` 32-bit pixel buffer (\`0xAABBGGRR\`).`
  },
  canvas_put_pixels: {
    signature: 'void canvas_put_pixels(const uint32_t *pixels_in)',
    doc: `**canvas_put_pixels(pixels_in)**
Overwrites the entire full-screen canvas from a \`width * height\` 32-bit pixel buffer (\`0xAABBGGRR\`).`
  },
  canvas_get_pixel: {
    signature: 'uint32_t canvas_get_pixel(int x, int y)',
    doc: `**canvas_get_pixel(x, y)**
Reads a single 32-bit pixel color at coordinate \`(x, y)\` (\`0xAABBGGRR\`).`
  },
  canvas_set_pixel: {
    signature: 'void canvas_set_pixel(int x, int y, uint32_t color)',
    doc: `**canvas_set_pixel(x, y, color)**
Writes a single 32-bit pixel color at coordinate \`(x, y)\` (\`0xAABBGGRR\`).`
  }
};

/**
 * Registers custom Hover, Completion, and Signature providers in Monaco for C/C++.
 * @param {import('monaco-editor')} monacoInstance 
 */
export function registerCustomApiHoverProviders(monacoInstance) {
  if (!monacoInstance?.languages) return;

  const languages = ['c', 'cpp'];

  for (const lang of languages) {
    // 1. Hover Provider
    monacoInstance.languages.registerHoverProvider(lang, {
      provideHover(model, position) {
        const wordInfo = model.getWordAtPosition(position);
        if (!wordInfo) return null;

        const info = CUSTOM_API_DOCS[wordInfo.word];
        if (!info) return null;

        return {
          range: new monacoInstance.Range(
            position.lineNumber,
            wordInfo.startColumn,
            position.lineNumber,
            wordInfo.endColumn
          ),
          contents: [
            { value: `\`\`\`c\n${info.signature}\n\`\`\`` },
            { value: info.doc }
          ]
        };
      }
    });

    // 2. Completion Item Provider
    monacoInstance.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(model, position) {
        const wordInfo = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordInfo.startColumn,
          endColumn: wordInfo.endColumn
        };

        const suggestions = Object.entries(CUSTOM_API_DOCS).map(([name, item]) => ({
          label: name,
          kind: monacoInstance.languages.CompletionItemKind.Function,
          detail: item.signature,
          documentation: { value: item.doc },
          insertText: `${name}()`,
          range
        }));

        return { suggestions };
      }
    });
  }
}
