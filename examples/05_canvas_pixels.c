/*
 * 05_canvas_pixels.c - HTML5 Canvas Pixel-Level Manipulation & 2D Image Processing
 *
 * Demonstrates:
 * - Direct pixel-level framebuffer access from Canvas 2D using <graphics_canvas.h>
 * - canvas_get_pixels() / canvas_put_pixels() full framebuffer transfer
 * - canvas_get_image_data() / canvas_put_image_data() sub-rectangle transfer
 * - canvas_get_pixel() / canvas_set_pixel() single-pixel inspection and writing
 * - 2D Image Processing filters in pure C:
 *     1. 3x3 Sobel Edge Detection filter (horizontal/vertical gradient convolution)
 *     2. 3x3 Box Blur spatial convolution
 *     3. Grayscale & Contrast adjustment
 *     4. Color Inversion
 *     5. Interactive Lens / Spotlight tracking mouse cursor
 * - Hybrid rendering pipeline: Vector Scene -> Pixel Filter -> Vector HUD Overlay
 * - Zero external libraries; compiles in pure standard C without link flags!
 *
 * Compilation in IDE Terminal:
 *   gcc 05_canvas_pixels.c -o a.out
 *   ./a.out
 */

#include <graphics_canvas.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define WIDTH  320
#define HEIGHT 240
#define TOTAL_PIXELS (WIDTH * HEIGHT)

// Framebuffers for pixel manipulation
static uint32_t src_pixels[TOTAL_PIXELS];
static uint32_t dst_pixels[TOTAL_PIXELS];

// Pixel color unpacking & packing helpers (RGBA 32-bit little-endian)
#define PIXEL_R(p) ((uint8_t)((p) & 0xFF))
#define PIXEL_G(p) ((uint8_t)(((p) >> 8) & 0xFF))
#define PIXEL_B(p) ((uint8_t)(((p) >> 16) & 0xFF))
#define PIXEL_A(p) ((uint8_t)(((p) >> 24) & 0xFF))
#define PACK_RGBA(r, g, b, a) \
    (((uint32_t)(uint8_t)(a) << 24) | \
     ((uint32_t)(uint8_t)(b) << 16) | \
     ((uint32_t)(uint8_t)(g) << 8)  | \
      (uint32_t)(uint8_t)(r))

// Clamp helper
static inline int clamp_int(int val, int min, int max) {
    if (val < min) return min;
    if (val > max) return max;
    return val;
}

// -------------------------------------------------------------
// 2D Image Processing Filters
// -------------------------------------------------------------

// Mode 1: Grayscale & Contrast
static void filter_grayscale(const uint32_t *src, uint32_t *dst) {
    for (int i = 0; i < TOTAL_PIXELS; i++) {
        uint32_t p = src[i];
        int r = PIXEL_R(p);
        int g = PIXEL_G(p);
        int b = PIXEL_B(p);
        // Standard Rec. 601 luma coefficients
        int gray = (r * 77 + g * 150 + b * 29) >> 8;
        // Contrast enhancement
        gray = clamp_int((gray - 128) * 13 / 10 + 128, 0, 255);
        dst[i] = PACK_RGBA(gray, gray, gray, 255);
    }
}

// Mode 2: 3x3 Box Blur (Spatial Convolution)
static void filter_box_blur(const uint32_t *src, uint32_t *dst) {
    for (int y = 0; y < HEIGHT; y++) {
        for (int x = 0; x < WIDTH; x++) {
            if (x == 0 || x == WIDTH - 1 || y == 0 || y == HEIGHT - 1) {
                dst[y * WIDTH + x] = src[y * WIDTH + x];
                continue;
            }
            int r_sum = 0, g_sum = 0, b_sum = 0;
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    uint32_t p = src[(y + dy) * WIDTH + (x + dx)];
                    r_sum += PIXEL_R(p);
                    g_sum += PIXEL_G(p);
                    b_sum += PIXEL_B(p);
                }
            }
            dst[y * WIDTH + x] = PACK_RGBA(r_sum / 9, g_sum / 9, b_sum / 9, 255);
        }
    }
}

// Mode 3: 3x3 Sobel Edge Detection (Gradient Convolution)
static void filter_sobel(const uint32_t *src, uint32_t *dst) {
    static const int gx_mat[3][3] = {
        { -1, 0, 1 },
        { -2, 0, 2 },
        { -1, 0, 1 }
    };
    static const int gy_mat[3][3] = {
        { -1, -2, -1 },
        {  0,  0,  0 },
        {  1,  2,  1 }
    };

    for (int y = 0; y < HEIGHT; y++) {
        for (int x = 0; x < WIDTH; x++) {
            if (x == 0 || x == WIDTH - 1 || y == 0 || y == HEIGHT - 1) {
                dst[y * WIDTH + x] = PACK_RGBA(0, 0, 0, 255);
                continue;
            }

            int gx = 0, gy = 0;
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    uint32_t p = src[(y + dy) * WIDTH + (x + dx)];
                    int luma = (PIXEL_R(p) * 77 + PIXEL_G(p) * 150 + PIXEL_B(p) * 29) >> 8;
                    gx += luma * gx_mat[dy + 1][dx + 1];
                    gy += luma * gy_mat[dy + 1][dx + 1];
                }
            }

            int mag = abs(gx) + abs(gy);
            mag = clamp_int(mag, 0, 255);

            // Colorize edges: Cyan to White intensity
            uint8_t er = (uint8_t)(mag > 180 ? mag : mag / 3);
            uint8_t eg = (uint8_t)mag;
            uint8_t eb = (uint8_t)mag;
            dst[y * WIDTH + x] = PACK_RGBA(er, eg, eb, 255);
        }
    }
}

// Mode 4: Invert Colors
static void filter_invert(const uint32_t *src, uint32_t *dst) {
    for (int i = 0; i < TOTAL_PIXELS; i++) {
        uint32_t p = src[i];
        dst[i] = PACK_RGBA(255 - PIXEL_R(p), 255 - PIXEL_G(p), 255 - PIXEL_B(p), 255);
    }
}

// -------------------------------------------------------------
// Interactive Spotlight / Lens Application
// -------------------------------------------------------------
static void apply_lens(const uint32_t *base, const uint32_t *filtered, uint32_t *out, int mx, int my, int radius) {
    int r2 = radius * radius;
    for (int y = 0; y < HEIGHT; y++) {
        for (int x = 0; x < WIDTH; x++) {
            int idx = y * WIDTH + x;
            int dx = x - mx;
            int dy = y - my;
            int dist2 = dx * dx + dy * dy;

            if (dist2 <= r2) {
                // Inside lens: show filtered pixel
                out[idx] = filtered[idx];
            } else if (dist2 <= r2 + 2 * radius) {
                // Lens border: bright white ring
                out[idx] = PACK_RGBA(255, 255, 255, 255);
            } else {
                // Outside lens: normal base pixel
                out[idx] = base[idx];
            }
        }
    }
}

// Filter mode names
static const char *MODE_NAMES[] = {
    "Interactive Lens (Sobel)",
    "Interactive Lens (Blur)",
    "Full Screen: Sobel Edges",
    "Full Screen: 3x3 Box Blur",
    "Full Screen: Grayscale",
    "Full Screen: Color Invert",
    "Sub-rect ImageData Demo"
};
#define NUM_MODES 7

int main(void) {
    graphics_init(WIDTH, HEIGHT, "Canvas 2D Pixel Manipulation & Image Processing");

    int mode = 0;
    int last_button = 0;
    float time_sec = 0.0f;
    int mouseX = WIDTH / 2, mouseY = HEIGHT / 2, buttons = 0, wheel = 0;

    printf("=== HTML5 Canvas 2D Pixel Processing Demo ===\n");
    printf("Controls:\n");
    printf("  - Mouse Click / Space: Cycle Image Processing Modes\n");
    printf("  - Move Mouse: Move interactive filter spotlight lens\n");
    printf("  - Keys 1-7: Switch directly to mode 1 through 7\n");

    while (!graphics_should_close()) {
        time_sec += 0.03f;

        // Poll mouse input
        graphics_get_mouse(&mouseX, &mouseY, &buttons, &wheel);

        // Click to cycle mode
        int click_down = (buttons & 1);
        if (click_down && !last_button) {
            mode = (mode + 1) % NUM_MODES;
        }
        last_button = click_down;

        // Number keys 1-7 (Keycodes 49..55)
        for (int k = 0; k < NUM_MODES; k++) {
            if (graphics_is_key_down(49 + k)) {
                mode = k;
            }
        }
        // Space bar (Keycode 32)
        if (graphics_is_key_down(32)) {
            mode = (mode + 1) % NUM_MODES;
        }

        // =========================================================
        // Step 1: Render dynamic vector scene with Canvas 2D
        // =========================================================
        canvas_set_fill_style("#0f111a");
        canvas_fill_rect(0, 0, WIDTH, HEIGHT);

        // Draw animated concentric color discs
        for (int i = 5; i >= 1; i--) {
            float r = i * 22.0f;
            float cx = WIDTH / 2.0f + cosf(time_sec * 0.8f + i * 0.5f) * 45.0f;
            float cy = HEIGHT / 2.0f + sinf(time_sec * 1.1f + i * 0.4f) * 30.0f;

            canvas_begin_path();
            canvas_arc(cx, cy, r, 0, 6.28318f, false);
            if (i % 3 == 0) canvas_set_fill_style("#ff5370");
            else if (i % 3 == 1) canvas_set_fill_style("#82aaff");
            else canvas_set_fill_style("#c3e88d");
            canvas_fill();
        }

        // Draw rotating square
        canvas_save();
        canvas_translate(WIDTH / 2.0f, HEIGHT / 2.0f);
        canvas_rotate(time_sec * 0.7f);
        canvas_set_stroke_style("#ffcb6b");
        canvas_set_line_width(4.0f);
        canvas_stroke_rect(-35, -35, 70, 70);
        canvas_restore();

        // Vector text in background scene
        canvas_set_font("bold 16px sans-serif");
        canvas_set_fill_style("#f78c6c");
        canvas_fill_text("WASM-C-IDE", 20, 40);

        // =========================================================
        // Step 2: Pixel-Level Manipulation & 2D Image Processing
        // =========================================================
        if (mode == 6) {
            // Demonstrate canvas_get_image_data / canvas_put_image_data on a sub-region
            int sub_w = 120, sub_h = 80;
            int sub_x = 20, sub_y = 60;
            static uint32_t sub_buffer[120 * 80];

            canvas_get_image_data(sub_x, sub_y, sub_w, sub_h, sub_buffer);

            // Invert colors inside sub-region in-place
            for (int i = 0; i < sub_w * sub_h; i++) {
                uint32_t p = sub_buffer[i];
                sub_buffer[i] = PACK_RGBA(255 - PIXEL_R(p), 255 - PIXEL_G(p), 255 - PIXEL_B(p), 255);
            }

            // Blit inverted sub-region to the right side
            canvas_put_image_data(WIDTH - sub_w - 20, sub_y, sub_w, sub_h, sub_buffer);

            // Demonstrate canvas_set_pixel() by drawing a dotted grid
            for (int gy = 160; gy < 220; gy += 4) {
                for (int gx = 20; gx < 300; gx += 4) {
                    canvas_set_pixel(gx, gy, PACK_RGBA(255, 235, 59, 255));
                }
            }
        } else {
            // Read full canvas framebuffer into C memory
            canvas_get_pixels(src_pixels);

            // Apply selected image filter
            switch (mode) {
                case 0: // Interactive Lens with Sobel Edges
                    filter_sobel(src_pixels, dst_pixels);
                    apply_lens(src_pixels, dst_pixels, dst_pixels, mouseX, mouseY, 45);
                    canvas_put_pixels(dst_pixels);
                    break;

                case 1: // Interactive Lens with 3x3 Box Blur
                    filter_box_blur(src_pixels, dst_pixels);
                    apply_lens(src_pixels, dst_pixels, dst_pixels, mouseX, mouseY, 45);
                    canvas_put_pixels(dst_pixels);
                    break;

                case 2: // Full Sobel Edge Detection
                    filter_sobel(src_pixels, dst_pixels);
                    canvas_put_pixels(dst_pixels);
                    break;

                case 3: // Full 3x3 Box Blur
                    filter_box_blur(src_pixels, dst_pixels);
                    canvas_put_pixels(dst_pixels);
                    break;

                case 4: // Full Grayscale & Contrast
                    filter_grayscale(src_pixels, dst_pixels);
                    canvas_put_pixels(dst_pixels);
                    break;

                case 5: // Full Invert Colors
                    filter_invert(src_pixels, dst_pixels);
                    canvas_put_pixels(dst_pixels);
                    break;
            }
        }

        // =========================================================
        // Step 3: Overlay high-level Vector HUD on top of pixels
        // =========================================================
        // HUD Banner
        canvas_set_fill_style("rgba(0, 0, 0, 0.75)");
        canvas_fill_rect(0, HEIGHT - 32, WIDTH, 32);

        // Status text
        char status_buf[128];
        snprintf(status_buf, sizeof(status_buf), "[%d/%d] %s", mode + 1, NUM_MODES, MODE_NAMES[mode]);
        canvas_set_font("12px sans-serif");
        canvas_set_fill_style("#ffffff");
        canvas_fill_text(status_buf, 10, HEIGHT - 18);

        canvas_set_font("10px monospace");
        canvas_set_fill_style("#89ddff");
        snprintf(status_buf, sizeof(status_buf), "Pos:(%d,%d) Click:Next", mouseX, mouseY);
        canvas_fill_text(status_buf, 10, HEIGHT - 6);

        // Present canvas frame
        canvas_present();

        // 60 FPS frame pacing
        graphics_wait_frame(60);
    }

    graphics_close();
    return 0;
}
