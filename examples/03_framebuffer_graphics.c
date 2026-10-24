/*
 * 03_framebuffer_graphics.c - Software Framebuffer Direct Pixel Program
 *
 * Demonstrates:
 * - Direct memory pixel buffer manipulation using <graphics.h>
 * - Real-time 60 FPS procedural plasma effect calculated per-pixel
 * - Interactive mouse drawing directly into pixel memory with persistent canvas layer
 * - Zero external dependencies; compiles in pure standard C without link flags!
 *
 * Controls:
 * - Mouse Move: Glowing cursor indicator follows pointer in real time
 * - Left Click & Drag: Paint glowing strokes onto the persistent canvas
 * - Press 'C' or Space: Clear painted strokes
 * - Press Left / Right Arrow: Slow down / speed up plasma animation
 *
 * Compilation in IDE Terminal:
 *   gcc 03_framebuffer_graphics.c -o a.out
 *   ./a.out
 */

#include <graphics.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

#define WIDTH  320
#define HEIGHT 240

// 32-bit RGBA pixel helper (0xAABBGGRR in little-endian)
static inline uint32_t make_rgba(uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
    return ((uint32_t)a << 24) | ((uint32_t)b << 16) | ((uint32_t)g << 8) | (uint32_t)r;
}

// Draw a filled circle directly into a pixel buffer
static void draw_brush(uint32_t *buf, int cx, int cy, int radius, uint32_t color) {
    int r2 = radius * radius;
    for (int dy = -radius; dy <= radius; dy++) {
        int py = cy + dy;
        if (py < 0 || py >= HEIGHT) continue;
        for (int dx = -radius; dx <= radius; dx++) {
            int px = cx + dx;
            if (px < 0 || px >= WIDTH) continue;
            if (dx * dx + dy * dy <= r2) {
                buf[py * WIDTH + px] = color;
            }
        }
    }
}

// Draw a distinct glowing cursor indicator
static void draw_cursor(uint32_t *pixels, int cx, int cy) {
    if (cx < 0 || cx >= WIDTH || cy < 0 || cy >= HEIGHT) return;

    // Draw bright yellow core
    draw_brush(pixels, cx, cy, 3, make_rgba(255, 255, 0, 255));

    // Draw outer outline ring
    int ringRadius = 6;
    int r2_inner = (ringRadius - 1) * (ringRadius - 1);
    int r2_outer = ringRadius * ringRadius;
    for (int dy = -ringRadius; dy <= ringRadius; dy++) {
        int py = cy + dy;
        if (py < 0 || py >= HEIGHT) continue;
        for (int dx = -ringRadius; dx <= ringRadius; dx++) {
            int px = cx + dx;
            if (px < 0 || px >= WIDTH) continue;
            int d2 = dx * dx + dy * dy;
            if (d2 >= r2_inner && d2 <= r2_outer) {
                pixels[py * WIDTH + px] = make_rgba(0, 0, 0, 255); // Black outline
            }
        }
    }
}

int main(void) {
    printf("Starting Software Framebuffer Graphics Demo (320x240 @ 60 FPS)...\n");
    printf("Controls:\n");
    printf(" - Move Mouse: Cursor follows pointer\n");
    printf(" - Left Click & Drag: Paint persistent white strokes\n");
    printf(" - Press 'C' or Space: Clear painted strokes\n");
    printf(" - Press Left/Right Arrow: Adjust animation speed\n\n");

    graphics_init(WIDTH, HEIGHT, "Software Framebuffer Plasma & Paint");

    uint32_t *pixels = (uint32_t*)malloc(WIDTH * HEIGHT * sizeof(uint32_t));
    uint32_t *paintCanvas = (uint32_t*)calloc(WIDTH * HEIGHT, sizeof(uint32_t));
    if (!pixels || !paintCanvas) {
        if (pixels) free(pixels);
        if (paintCanvas) free(paintCanvas);
        return 1;
    }

    // Precompute 512-entry sine lookup table for fluid 60 FPS performance
    static float sinTab[512];
    for (int i = 0; i < 512; i++) {
        sinTab[i] = sinf(((float)i / 512.0f) * 6.2831853f);
    }

    float time = 0.0f;
    int mouseX = -1, mouseY = -1, buttons = 0, wheel = 0;

    while (!graphics_should_close()) {
        // Poll mouse state
        graphics_get_mouse(&mouseX, &mouseY, &buttons, &wheel);

        // Check if user pressed 'C' (67) or Space (32) to clear canvas
        if (graphics_is_key_down('C') || graphics_is_key_down('c') || graphics_is_key_down(32)) {
            memset(paintCanvas, 0, WIDTH * HEIGHT * sizeof(uint32_t));
        }

        // Adjust animation speed with arrow keys
        float timeSpeed = 0.05f;
        if (graphics_is_key_down(262)) timeSpeed = 0.15f; // Right Arrow accelerates
        if (graphics_is_key_down(263)) timeSpeed = 0.01f; // Left Arrow slows down

        time += timeSpeed;
        int tOffset = (int)(time * 60.0f);

        // Render animated procedural plasma into pixel memory using lookup table
        for (int y = 0; y < HEIGHT; y++) {
            int rowOffset = y * WIDTH;
            int yIdx = (y * 3 + tOffset) & 511;
            float v2 = sinTab[yIdx];

            for (int x = 0; x < WIDTH; x++) {
                int xIdx = (x * 3 + tOffset) & 511;
                int diagIdx = ((x + y) * 2 - tOffset) & 511;
                float v1 = sinTab[xIdx];
                float v3 = sinTab[diagIdx];

                float val = (v1 + v2 + v3) * 0.333f; // -1.0 to 1.0

                // Vivid color mapping
                uint8_t r = (uint8_t)((val + 1.0f) * 0.5f * 255.0f);
                uint8_t g = (uint8_t)((sinTab[(xIdx + yIdx) & 511] + 1.0f) * 0.5f * 255.0f);
                uint8_t b = (uint8_t)((1.0f - (val + 1.0f) * 0.5f) * 255.0f);

                pixels[rowOffset + x] = make_rgba(r, g, b, 255);
            }
        }

        // Interactive mouse painting: If left button clicked or dragged, paint onto persistent canvas
        if ((buttons & 1) && mouseX >= 0 && mouseX < WIDTH && mouseY >= 0 && mouseY < HEIGHT) {
            draw_brush(paintCanvas, mouseX, mouseY, 10, make_rgba(255, 255, 255, 255));
        }

        // Blend persistent paint canvas layer on top of plasma
        for (int i = 0; i < WIDTH * HEIGHT; i++) {
            if (paintCanvas[i] != 0) {
                pixels[i] = paintCanvas[i];
            }
        }

        // Render hover cursor on top if mouse is inside the canvas
        if (mouseX >= 0 && mouseX < WIDTH && mouseY >= 0 && mouseY < HEIGHT) {
            draw_cursor(pixels, mouseX, mouseY);
        }

        // Present pixel buffer to the graphics display
        graphics_present(pixels);

        // Synchronize at 60 FPS
        graphics_wait_frame(60);
    }

    free(paintCanvas);
    free(pixels);
    graphics_close();
    return 0;
}
