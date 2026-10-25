#include <turtle.h>
#include <turtle_backend_raylib.h>

/**
 * 07_turtle_raylib.c - Turtle Graphics with Raylib Backend
 *
 * Demonstrates the Raylib-backed turtle graphics subsystem powered by
 * <turtle.h> and <turtle_backend_raylib.h>. Requires Raylib support to be
 * enabled in Project Settings.
 *
 * Compilation:
 *   gcc 07_turtle_raylib.c -lturtle_raylib -lraylib -o a.out
 *   ./a.out
 */
int main(void) {
    turtle_raylib_context_t ctx = {
        .width = 800,
        .height = 600,
        .title = "Turtle Graphics - Raylib Demo",
        .target_fps = 60
    };

    if (!turtle_begin(&ctx)) {
        return 1;
    }

    /* Clear canvas background to white */
    turtle_clear(TURTLE_WHITE);

    /* 6-color palette for geometric rosette */
    const uint32_t colors[] = {
        TURTLE_RED,
        TURTLE_GREEN,
        TURTLE_BLUE,
        TURTLE_YELLOW,
        TURTLE_MAGENTA,
        TURTLE_CYAN
    };
    const int num_colors = sizeof(colors) / sizeof(colors[0]);

    turtle_pen_stroke(2.0);

    /* Draw progressive geometric rosette */
    for (int i = 0; i < 72; i++) {
        turtle_pen_color(colors[i % num_colors]);
        turtle_forward(i * 3.5);
        turtle_turn_left(59.0);
        turtle_delay(25.0); /* 25ms progressive animation pacing */
    }

    turtle_end();
    return 0;
}
