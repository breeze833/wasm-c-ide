#include <turtle.h>
#include <turtle_backend_canvas_wasi.h>

/**
 * 06_turtle_canvas.c - Turtle Graphics with Canvas-WASI Backend
 *
 * Demonstrates the default browser-hosted HTML5 Canvas 2D turtle graphics
 * powered by <turtle.h> and <turtle_backend_canvas_wasi.h>.
 *
 * Compilation:
 *   gcc 06_turtle_canvas.c -lturtle -o a.out
 *   ./a.out
 */
int main(void) {
    turtle_canvas_wasi_context_t ctx = {
        .width = 800,
        .height = 600,
        .title = "Turtle Graphics - Canvas WASI Demo"
    };

    if (!turtle_begin(&ctx)) {
        return 1;
    }

    /* Clear viewport to white */
    turtle_clear(TURTLE_WHITE);

    /* 6-color palette for vibrant star spiral */
    const uint32_t colors[] = {
        TURTLE_RED,
        TURTLE_YELLOW,
        TURTLE_GREEN,
        TURTLE_CYAN,
        TURTLE_BLUE,
        TURTLE_MAGENTA
    };
    const int num_colors = sizeof(colors) / sizeof(colors[0]);

    turtle_pen_stroke(2.5);

    /* Draw progressive animated star spiral */
    for (int i = 0; i < 60; i++) {
        turtle_pen_color(colors[i % num_colors]);
        turtle_forward(i * 4.0);
        turtle_turn_right(144.0);
        turtle_delay(35.0); /* 35ms progressive animation pacing */
    }

    turtle_end();
    return 0;
}
