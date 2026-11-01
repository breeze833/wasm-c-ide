/*
 * 08_ansi_terminal.c - Comprehensive ANSI Escape Sequence & Screen Control Demo
 *
 * Demonstrates VT100 / ANSI escape sequence terminal capabilities in WebAssembly WASI:
 *   - Screen clearing & cursor positioning: \033[2J, \033[H, \033[<r>;<c>H
 *   - Cursor visibility toggling: \033[?25l (hide), \033[?25h (show)
 *   - Text styling (SGR): Bold, Dim, Italic, Underline, Inverse, Strikethrough
 *   - 16-color ANSI palette and 256-color RGB spectrum bars
 *   - Structured multi-window TUI layout tailored for 80x24 detached terminal mode
 *   - In-place smooth animated progress bar and telemetry updates
 *
 * Compilation & Execution:
 *   gcc 08_ansi_terminal.c -o a.out
 *   ./a.out
 */

#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* ANSI Escape Code Constants */
#define ESC_RESET       "\033[0m"
#define ESC_BOLD        "\033[1m"
#define ESC_DIM         "\033[2m"
#define ESC_ITALIC      "\033[3m"
#define ESC_UNDERLINE   "\033[4m"
#define ESC_REVERSE     "\033[7m"
#define ESC_STRIKE      "\033[9m"

#define ESC_CLEAR_SCR   "\033[2J"
#define ESC_CLEAR_EOL   "\033[K"
#define ESC_CURSOR_HOME "\033[H"
#define ESC_HIDE_CURSOR "\033[?25l"
#define ESC_SHOW_CURSOR "\033[?25h"

/* Terminal Cursor Movement Helper (ANSI CUP - Cursor Position) */
static void move_to(int row, int col) {
    printf("\033[%d;%dH", row, col);
}

/* Draw a styled box with single or double line characters */
static void draw_box(int top, int left, int width, int height, const char *title, int double_border) {
    const char *tl = double_border ? "╔" : "┌";
    const char *tr = double_border ? "╗" : "┐";
    const char *bl = double_border ? "╚" : "└";
    const char *br = double_border ? "╝" : "┘";
    const char *hz = double_border ? "═" : "─";
    const char *vt = double_border ? "║" : "│";

    /* Top border */
    move_to(top, left);
    printf("%s", tl);
    for (int i = 0; i < width - 2; i++) {
        printf("%s", hz);
    }
    printf("%s", tr);

    /* Side borders */
    for (int r = 1; r < height - 1; r++) {
        move_to(top + r, left);
        printf("%s", vt);
        move_to(top + r, left + width - 1);
        printf("%s", vt);
    }

    /* Bottom border */
    move_to(top + height - 1, left);
    printf("%s", bl);
    for (int i = 0; i < width - 2; i++) {
        printf("%s", hz);
    }
    printf("%s", br);

    /* Optional Title */
    if (title && strlen(title) > 0) {
        move_to(top, left + 3);
        printf("┤ " ESC_BOLD "%s" ESC_RESET " ├", title);
    }
}

/* Sleep milliseconds wrapper using standard POSIX nanosleep */
static void delay_ms(int ms) {
    struct timespec ts;
    ts.tv_sec = ms / 1000;
    ts.tv_nsec = (long)(ms % 1000) * 1000000L;
    nanosleep(&ts, NULL);
}

int main(void) {
    /* 1. Initialize screen: Clear display and hide hardware cursor */
    printf(ESC_CLEAR_SCR ESC_CURSOR_HOME ESC_HIDE_CURSOR);
    fflush(stdout);

    /* 2. Outer Window Frame (80x24 geometry) */
    printf("\033[38;5;39m"); /* Bright Cyan Border */
    draw_box(1, 1, 80, 24, "WASM-C-IDE :: ANSI SCREEN CONTROL DEMO (80x24)", 1);
    printf(ESC_RESET);

    /* 3. Top Banner & Subtitle */
    move_to(2, 4);
    printf(ESC_BOLD "\033[38;5;220mDEC VT100 / xterm.js Showcase" ESC_RESET);
    move_to(2, 62);
    printf(ESC_DIM "Geometry: 80x24" ESC_RESET);

    /* 4. Left Pane: System Telemetry (rows 4 to 14, left 3, width 36, ends col 38) */
    printf("\033[38;5;75m");
    draw_box(4, 3, 36, 11, "Telemetry & Host", 0);
    printf(ESC_RESET);

    move_to(6, 5);
    printf(ESC_BOLD "Architecture:" ESC_RESET " wasm32-wasip1");
    move_to(7, 5);
    printf(ESC_BOLD "WASI Runtime:" ESC_RESET " Zero-MemFS VFS");
    move_to(8, 5);
    printf(ESC_BOLD "Terminal:    " ESC_RESET " xterm.js 5.5");
    move_to(9, 5);
    printf(ESC_BOLD "Color Mode:  " ESC_RESET " 24-bit TrueColor");
    move_to(10, 5);
    printf(ESC_BOLD "Layout:      " ESC_RESET " Detached Floating");
    move_to(11, 5);
    printf(ESC_BOLD "Sync Stdin:  " ESC_RESET " SharedArrayBuffer");
    move_to(12, 5);
    printf(ESC_BOLD "Virtual VFS: " ESC_RESET " In-Memory IDB");

    /* 5. Right Pane: ANSI Text Attributes & 16-Color Palette (rows 4 to 14, left 41, width 37, ends col 77) */
    printf("\033[38;5;178m");
    draw_box(4, 41, 37, 11, "SGR Styles & ANSI 16 Colors", 0);
    printf(ESC_RESET);

    move_to(6, 43);
    printf(ESC_BOLD "Bold" ESC_RESET "  " ESC_DIM "Dim" ESC_RESET "  "
           ESC_ITALIC "Italic" ESC_RESET "  " ESC_UNDERLINE "Underline" ESC_RESET "  "
           ESC_REVERSE "Inv" ESC_RESET);

    move_to(8, 43);
    printf(ESC_BOLD "Standard 8 Colors:" ESC_RESET);
    move_to(9, 43);
    for (int i = 0; i < 8; i++) {
        printf("\033[4%dm  ", i);
    }
    printf(ESC_RESET " (30-37)");

    move_to(11, 43);
    printf(ESC_BOLD "High-Intensity 8 Colors:" ESC_RESET);
    move_to(12, 43);
    for (int i = 0; i < 8; i++) {
        printf("\033[10%dm  ", i);
    }
    printf(ESC_RESET " (90-97)");

    /* 6. Middle: 256-Color Gradient Bar (row 15, ends at col 77) */
    move_to(15, 3);
    printf(ESC_BOLD "256 Colors: " ESC_RESET);
    for (int i = 16; i <= 78; i++) {
        printf("\033[48;5;%dm ", i);
    }
    printf(ESC_RESET);

    /* 7. Bottom Pane: In-Place Live Screen Updates & Animation (rows 16 to 22, left 3, width 75, ends col 77) */
    printf("\033[38;5;113m");
    draw_box(16, 3, 75, 6, "In-Place Live Screen Animation (Flicker-Free)", 0);
    printf(ESC_RESET);

    move_to(18, 5);
    printf(ESC_BOLD "Task Processing: " ESC_RESET "Rendering procedural ANSI frame buffer...");

    /* 8. Animated Progress Bar Simulation */
    const int bar_width = 46;
    for (int percent = 0; percent <= 100; percent += 5) {
        int filled = (percent * bar_width) / 100;

        move_to(19, 5);
        printf("[");
        printf("\033[38;5;48m");
        for (int i = 0; i < filled; i++) {
            printf("━");
        }
        printf("\033[38;5;238m");
        for (int i = filled; i < bar_width; i++) {
            printf("─");
        }
        printf(ESC_RESET "] %3d%%  ", percent);

        /* Moving spinner indicator */
        const char *spinner = "|/-\\";
        printf("\033[38;5;226m%c\033[0m", spinner[(percent / 5) % 4]);

        /* Dynamic status message */
        move_to(20, 5);
        printf(ESC_DIM "Buffer coordinate updates: row 19, col %-2d | ESC count: %-3d" ESC_RESET,
               5 + filled, 120 + percent * 4);

        fflush(stdout);
        delay_ms(30);
    }

    move_to(20, 5);
    printf(ESC_BOLD "\033[38;5;46m[OK] Processing Complete! All 80x24 coordinates rendered cleanly." ESC_CLEAR_EOL ESC_RESET);
    printf("\033[38;5;113m");
    move_to(20, 77);
    printf("│" ESC_RESET);

    /* 9. Footer Prompt */
    move_to(23, 4);
    printf(ESC_BOLD "Press Enter to exit demo..." ESC_RESET);
    fflush(stdout);

    /* Wait for user input or Enter */
    getchar();

    /* 10. Clean exit: restore cursor visibility, reset styles, and park cursor at bottom */
    printf(ESC_RESET ESC_SHOW_CURSOR);
    move_to(24, 1);
    printf("\n");
    fflush(stdout);

    return 0;
}
