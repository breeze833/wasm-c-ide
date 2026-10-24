/*
 * 02_raylib_interactive.c - Interactive Raylib 5.5 Graphics Program
 *
 * Demonstrates:
 * - Hardware-accelerated WebGL graphics via Raylib 5.5
 * - Keyboard input: WASD / Arrow keys for movement, Space bar for color pulse
 * - Mouse input: Cursor tracking, left click to place particle bursts
 * - Smooth frame pacing at 60 FPS
 *
 * Prerequisites:
 *   In IDE Project Settings, ensure "Enable Raylib" is ON.
 *
 * Compilation in IDE Terminal:
 *   gcc 02_raylib_interactive.c -lraylib -o a.out
 *   ./a.out
 */

#include "raylib.h"
#include <math.h>

#define MAX_PARTICLES 64

typedef struct {
    Vector2 position;
    Vector2 velocity;
    Color color;
    float alpha;
    float radius;
    bool active;
} Particle;

int main(void) {
    const int screenWidth = 800;
    const int screenHeight = 450;

    InitWindow(screenWidth, screenHeight, "Raylib Interactive Playground");
    SetTargetFPS(60);

    // Player state
    Vector2 playerPos = { (float)screenWidth / 2.0f, (float)screenHeight / 2.0f };
    float playerRadius = 24.0f;
    float playerSpeed = 5.0f;
    Color playerColor = SKYBLUE;

    // Particle burst array
    Particle particles[MAX_PARTICLES] = { 0 };

    while (!WindowShouldClose()) {
        // --- 1. Keyboard Input Handling ---
        if (IsKeyDown(KEY_RIGHT) || IsKeyDown(KEY_D)) playerPos.x += playerSpeed;
        if (IsKeyDown(KEY_LEFT) || IsKeyDown(KEY_A))  playerPos.x -= playerSpeed;
        if (IsKeyDown(KEY_DOWN) || IsKeyDown(KEY_S))  playerPos.y += playerSpeed;
        if (IsKeyDown(KEY_UP) || IsKeyDown(KEY_W))    playerPos.y -= playerSpeed;

        // Keep player inside screen boundaries
        if (playerPos.x < playerRadius) playerPos.x = playerRadius;
        if (playerPos.x > screenWidth - playerRadius) playerPos.x = screenWidth - playerRadius;
        if (playerPos.y < playerRadius) playerPos.y = playerRadius;
        if (playerPos.y > screenHeight - playerRadius) playerPos.y = screenHeight - playerRadius;

        // Space bar changes player color
        if (IsKeyPressed(KEY_SPACE)) {
            playerColor = (Color){ (unsigned char)GetRandomValue(80, 255),
                                   (unsigned char)GetRandomValue(80, 255),
                                   (unsigned char)GetRandomValue(80, 255), 255 };
        }

        // --- 2. Mouse Input Handling ---
        Vector2 mousePos = GetMousePosition();

        if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
            // Spawn particle burst at mouse position
            for (int i = 0; i < 16; i++) {
                for (int p = 0; p < MAX_PARTICLES; p++) {
                    if (!particles[p].active) {
                        particles[p].active = true;
                        particles[p].position = mousePos;
                        float angle = (float)GetRandomValue(0, 360) * (PI / 180.0f);
                        float speed = (float)GetRandomValue(2, 6);
                        particles[p].velocity = (Vector2){ cosf(angle) * speed, sinf(angle) * speed };
                        particles[p].radius = (float)GetRandomValue(4, 10);
                        particles[p].alpha = 1.0f;
                        particles[p].color = playerColor;
                        break;
                    }
                }
            }
        }

        // Update active particles
        for (int i = 0; i < MAX_PARTICLES; i++) {
            if (particles[i].active) {
                particles[i].position.x += particles[i].velocity.x;
                particles[i].position.y += particles[i].velocity.y;
                particles[i].alpha -= 0.025f;
                if (particles[i].alpha <= 0.0f) {
                    particles[i].active = false;
                }
            }
        }

        // --- 3. Rendering ---
        BeginDrawing();
            ClearBackground((Color){ 24, 24, 28, 255 });

            // Draw grid pattern in background
            for (int x = 0; x < screenWidth; x += 40) {
                DrawLine(x, 0, x, screenHeight, (Color){ 36, 36, 42, 255 });
            }
            for (int y = 0; y < screenHeight; y += 40) {
                DrawLine(0, y, screenWidth, y, (Color){ 36, 36, 42, 255 });
            }

            // Draw line connecting player and mouse
            DrawLineEx(playerPos, mousePos, 2.0f, Fade(LIGHTGRAY, 0.4f));

            // Draw mouse reticle
            DrawCircleLines((int)mousePos.x, (int)mousePos.y, 12, Fade(YELLOW, 0.8f));
            DrawCircle((int)mousePos.x, (int)mousePos.y, 3, YELLOW);

            // Draw particles
            for (int i = 0; i < MAX_PARTICLES; i++) {
                if (particles[i].active) {
                    DrawCircleV(particles[i].position, particles[i].radius, Fade(particles[i].color, particles[i].alpha));
                }
            }

            // Draw player
            DrawCircleV(playerPos, playerRadius + 4, Fade(playerColor, 0.3f));
            DrawCircleV(playerPos, playerRadius, playerColor);
            DrawCircleLines((int)playerPos.x, (int)playerPos.y, playerRadius, RAYWHITE);

            // UI Overlay & Instructions
            DrawRectangle(10, 10, 310, 100, Fade(BLACK, 0.6f));
            DrawRectangleLines(10, 10, 310, 100, DARKGRAY);
            DrawText("Raylib 5.5 Interactive Demo", 20, 18, 18, RAYWHITE);
            DrawText("- WASD / Arrows: Move player circle", 20, 42, 13, LIGHTGRAY);
            DrawText("- Space: Change player color", 20, 60, 13, LIGHTGRAY);
            DrawText("- Left Click: Spawn particle burst", 20, 78, 13, LIGHTGRAY);

            DrawFPS(screenWidth - 90, 15);
        EndDrawing();
    }

    CloseWindow();
    return 0;
}
