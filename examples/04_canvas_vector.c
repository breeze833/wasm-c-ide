/*
 * 04_canvas_vector.c - HTML5 2D Vector Canvas Graphics Program
 *
 * Demonstrates:
 * - High-level 2D vector graphics using <graphics_canvas.h>
 * - Native browser Canvas 2D rendering (anti-aliased shapes, arcs, text, transforms)
 * - Rotating matrix transform shapes (canvas_save, canvas_rotate, canvas_restore)
 * - Multiple bouncing balls with physics simulation
 * - Interactive mouse tracking and vector lines
 * - Zero external libraries; compiles in pure standard C without link flags!
 *
 * Compilation in IDE Terminal:
 *   gcc 04_canvas_vector.c -o a.out
 *   ./a.out
 */

#include <graphics_canvas.h>
#include <math.h>

#define WIDTH  640
#define HEIGHT 480
#define NUM_BALLS 8

typedef struct {
    float x, y;
    float vx, vy;
    float radius;
    const char *color;
} Ball;

int main(void) {
    graphics_init(WIDTH, HEIGHT, "HTML5 2D Vector Canvas Demo");

    Ball balls[NUM_BALLS] = {
        { 100, 150,  3.2f,  2.5f, 20.0f, "#ff4d4f" },
        { 200, 220, -2.8f,  3.1f, 24.0f, "#40a9ff" },
        { 300, 100,  3.5f, -2.2f, 18.0f, "#73d13d" },
        { 400, 300, -2.0f,  3.8f, 28.0f, "#ffa940" },
        { 150, 350,  4.0f,  1.8f, 16.0f, "#9254de" },
        { 450, 180, -3.1f, -2.7f, 22.0f, "#f759ab" },
        { 250, 280,  2.5f, -3.4f, 26.0f, "#36cfc9" },
        { 350, 380, -3.8f,  2.0f, 19.0f, "#ffec3d" },
    };

    float rotation = 0.0f;
    int mouseX = 0, mouseY = 0, buttons = 0, wheel = 0;

    while (!graphics_should_close()) {
        // Poll mouse state
        graphics_get_mouse(&mouseX, &mouseY, &buttons, &wheel);

        // Update physics
        for (int i = 0; i < NUM_BALLS; i++) {
            balls[i].x += balls[i].vx;
            balls[i].y += balls[i].vy;

            // Bounce off left/right walls
            if (balls[i].x - balls[i].radius < 0) {
                balls[i].x = balls[i].radius;
                balls[i].vx = -balls[i].vx;
            } else if (balls[i].x + balls[i].radius > WIDTH) {
                balls[i].x = WIDTH - balls[i].radius;
                balls[i].vx = -balls[i].vx;
            }

            // Bounce off top/bottom walls
            if (balls[i].y - balls[i].radius < 0) {
                balls[i].y = balls[i].radius;
                balls[i].vy = -balls[i].vy;
            } else if (balls[i].y + balls[i].radius > HEIGHT) {
                balls[i].y = HEIGHT - balls[i].radius;
                balls[i].vy = -balls[i].vy;
            }
        }

        rotation += 0.02f;

        // --- 1. Clear & Background ---
        canvas_set_fill_style("#141416");
        canvas_fill_rect(0, 0, WIDTH, HEIGHT);

        // --- 2. Rotating Vector Star in Center ---
        canvas_save();
        canvas_translate(WIDTH / 2.0f, HEIGHT / 2.0f);
        canvas_rotate(rotation);

        canvas_set_line_width(3.0f);
        canvas_set_stroke_style("rgba(255, 255, 255, 0.15)");
        for (int i = 0; i < 8; i++) {
            canvas_rotate(3.14159f / 4.0f);
            canvas_stroke_rect(-60, -60, 120, 120);
        }
        canvas_restore();

        // --- 3. Interactive Vector Lines to Mouse ---
        if (mouseX > 0 && mouseX < WIDTH && mouseY > 0 && mouseY < HEIGHT) {
            canvas_set_line_width(1.5f);
            for (int i = 0; i < NUM_BALLS; i++) {
                float dx = balls[i].x - mouseX;
                float dy = balls[i].y - mouseY;
                float dist = sqrtf(dx * dx + dy * dy);
                if (dist < 180.0f) {
                    canvas_begin_path();
                    canvas_move_to(mouseX, mouseY);
                    canvas_line_to(balls[i].x, balls[i].y);
                    canvas_set_stroke_style("rgba(255, 255, 255, 0.35)");
                    canvas_stroke();
                }
            }

            // Draw glowing cursor ring
            canvas_begin_path();
            canvas_arc(mouseX, mouseY, 12.0f, 0, 6.283f, false);
            canvas_set_stroke_style("#52c41a");
            canvas_set_line_width(2.0f);
            canvas_stroke();
        }

        // --- 4. Render Bouncing Balls ---
        for (int i = 0; i < NUM_BALLS; i++) {
            canvas_begin_path();
            canvas_arc(balls[i].x, balls[i].y, balls[i].radius, 0, 6.283f, false);
            canvas_set_fill_style(balls[i].color);
            canvas_fill();

            // Ball outline
            canvas_set_line_width(2.0f);
            canvas_set_stroke_style("#ffffff");
            canvas_stroke();
        }

        // --- 5. Typography / HUD ---
        canvas_set_fill_style("rgba(0, 0, 0, 0.55)");
        canvas_fill_rect(10, 10, 320, 85);
        canvas_set_stroke_style("#333333");
        canvas_stroke_rect(10, 10, 320, 85);

        canvas_set_font("bold 16px sans-serif");
        canvas_set_fill_style("#ffffff");
        canvas_fill_text("HTML5 Canvas 2D Vector Demo", 20, 34);

        canvas_set_font("13px sans-serif");
        canvas_set_fill_style("#aaaaaa");
        canvas_fill_text("Rendering via OffscreenCanvas 2D context", 20, 56);
        canvas_fill_text("Move mouse over canvas to connect nodes", 20, 76);

        // Present vector frame
        canvas_present();

        // 60 FPS pacing
        graphics_wait_frame(60);
    }

    graphics_close();
    return 0;
}
