/*
 * 10_raylib_gui_audio.c - Interactive Raylib GUI, Waveform Animation & Audio Synthesizer
 *
 * Demonstrates:
 *   1. Immediate-mode GUI controls with raygui.h (buttons, sliders, checkboxes, group boxes)
 *   2. Procedural audio synthesis without external files via Raylib Audio (InitAudioDevice, LoadSoundFromWave, PlaySound)
 *   3. Real-time dynamic audio visualization (harmonic equalizer spectrum, peak gravity meters, orbital particles)
 *   4. Audio-driven interactive shockwave ripples and pulsating core animation
 *
 * Compilation & Execution in IDE:
 *   gcc 10_raylib_gui_audio.c -lraylib -o a.out
 *   ./a.out
 *
 * Controls:
 *   - Click GUI buttons [Chime], [Laser], [Pop], [Synth] or press keys [1], [2], [3], [4]
 *   - Click directly on the pulsating central orb to trigger interactive audio
 *   - Adjust Volume, Pitch, and Animation Speed using immediate-mode sliders
 *   - Toggle Equalizer Spectrum and Orbital Particles using checkboxes
 *   - Switch color themes between Cyan, Sunset, and Emerald
 */

#include "raylib.h"

#define RAYGUI_IMPLEMENTATION
#include "raygui.h"

#include <math.h>
#include <stdlib.h>

#define MAX_SHOCKWAVES 8
#define NUM_SPECTRUM_BARS 16
#define NUM_ORBITAL_PARTICLES 24

typedef struct {
    Vector2 center;
    float radius;
    float maxRadius;
    float alpha;
    bool active;
    Color color;
} Shockwave;

typedef struct {
    float height;
    float targetHeight;
    float peakHeight;
    float peakVelocity;
} SpectrumBar;

typedef enum {
    THEME_CYAN = 0,
    THEME_SUNSET,
    THEME_EMERALD
} ColorTheme;

// --- Procedural Audio Generators ---

static Sound GenerateChime(void) {
    const int sampleRate = 44100;
    const int frameCount = (int)(sampleRate * 1.1f);
    short *samples = (short *)malloc(frameCount * sizeof(short));
    if (!samples) return (Sound){ 0 };

    for (int i = 0; i < frameCount; i++) {
        float t = (float)i / (float)sampleRate;
        float decay = expf(-3.5f * t);
        // Harmonic major chord: C5 (523.25), E5 (659.25), G5 (783.99), C6 (1046.50)
        float tone = sinf(2.0f * PI * 523.25f * t) * 0.40f +
                     sinf(2.0f * PI * 659.25f * t) * 0.30f +
                     sinf(2.0f * PI * 783.99f * t) * 0.20f +
                     sinf(2.0f * PI * 1046.50f * t) * 0.10f;
        samples[i] = (short)(tone * decay * 28000.0f);
    }

    Wave wave = {
        .frameCount = frameCount,
        .sampleRate = sampleRate,
        .sampleSize = 16,
        .channels = 1,
        .data = samples
    };
    Sound sound = LoadSoundFromWave(wave);
    UnloadWave(wave);
    return sound;
}

static Sound GenerateLaser(void) {
    const int sampleRate = 44100;
    const float duration = 0.28f;
    const int frameCount = (int)(sampleRate * duration);
    short *samples = (short *)malloc(frameCount * sizeof(short));
    if (!samples) return (Sound){ 0 };

    float phase = 0.0f;
    for (int i = 0; i < frameCount; i++) {
        float t = (float)i / (float)sampleRate;
        float progress = t / duration;
        float freq = 1100.0f * (1.0f - progress * 0.78f);
        phase += 2.0f * PI * freq * (1.0f / (float)sampleRate);
        float env = 1.0f - progress;
        float tone = sinf(phase);
        samples[i] = (short)(tone * env * 28000.0f);
    }

    Wave wave = {
        .frameCount = frameCount,
        .sampleRate = sampleRate,
        .sampleSize = 16,
        .channels = 1,
        .data = samples
    };
    Sound sound = LoadSoundFromWave(wave);
    UnloadWave(wave);
    return sound;
}

static Sound GeneratePop(void) {
    const int sampleRate = 44100;
    const float duration = 0.22f;
    const int frameCount = (int)(sampleRate * duration);
    short *samples = (short *)malloc(frameCount * sizeof(short));
    if (!samples) return (Sound){ 0 };

    float phase = 0.0f;
    for (int i = 0; i < frameCount; i++) {
        float t = (float)i / (float)sampleRate;
        float progress = t / duration;
        float freq = 280.0f * expf(-14.0f * progress) + 70.0f;
        phase += 2.0f * PI * freq * (1.0f / (float)sampleRate);
        float env = expf(-12.0f * progress);
        float tone = sinf(phase) + 0.25f * sinf(phase * 2.0f);
        samples[i] = (short)(tone * env * 30000.0f);
    }

    Wave wave = {
        .frameCount = frameCount,
        .sampleRate = sampleRate,
        .sampleSize = 16,
        .channels = 1,
        .data = samples
    };
    Sound sound = LoadSoundFromWave(wave);
    UnloadWave(wave);
    return sound;
}

static Sound GenerateSynth(void) {
    const int sampleRate = 44100;
    const float duration = 0.75f;
    const int frameCount = (int)(sampleRate * duration);
    short *samples = (short *)malloc(frameCount * sizeof(short));
    if (!samples) return (Sound){ 0 };

    float phase = 0.0f;
    for (int i = 0; i < frameCount; i++) {
        float t = (float)i / (float)sampleRate;
        float vibrato = sinf(2.0f * PI * 5.5f * t) * 9.0f;
        float freq = 440.0f + vibrato;
        phase += 2.0f * PI * freq * (1.0f / (float)sampleRate);
        float env = (t < 0.04f) ? (t / 0.04f) : expf(-2.8f * (t - 0.04f));
        float tone = sinf(phase) * 0.70f + sinf(2.0f * phase) * 0.20f + sinf(3.0f * phase) * 0.10f;
        samples[i] = (short)(tone * env * 26000.0f);
    }

    Wave wave = {
        .frameCount = frameCount,
        .sampleRate = sampleRate,
        .sampleSize = 16,
        .channels = 1,
        .data = samples
    };
    Sound sound = LoadSoundFromWave(wave);
    UnloadWave(wave);
    return sound;
}

int main(void) {
    const int screenWidth = 800;
    const int screenHeight = 450;

    InitWindow(screenWidth, screenHeight, "raylib [gui + audio + animation] Synthesizer Demo");
    SetTargetFPS(60);

    InitAudioDevice();

    Sound sndChime = GenerateChime();
    Sound sndLaser = GenerateLaser();
    Sound sndPop = GeneratePop();
    Sound sndSynth = GenerateSynth();

    float masterVolume = 0.80f;
    float soundPitch = 1.0f;
    float animSpeed = 1.0f;
    bool showEqualizer = true;
    bool showOrbital = true;
    ColorTheme activeTheme = THEME_CYAN;

    Shockwave shockwaves[MAX_SHOCKWAVES] = { 0 };
    SpectrumBar bars[NUM_SPECTRUM_BARS] = { 0 };

    float pulseIntensity = 0.0f;
    const char *lastPlayedSound = "None";

    Vector2 stageCenter = { 555.0f, 215.0f };
    Rectangle stageRect = { 325, 50, 460, 385 };

    while (!WindowShouldClose()) {
        float dt = GetFrameTime();
        float time = (float)GetTime();

        SetSoundVolume(sndChime, masterVolume);
        SetSoundVolume(sndLaser, masterVolume);
        SetSoundVolume(sndPop, masterVolume);
        SetSoundVolume(sndSynth, masterVolume);

        SetSoundPitch(sndChime, soundPitch);
        SetSoundPitch(sndLaser, soundPitch);
        SetSoundPitch(sndPop, soundPitch);
        SetSoundPitch(sndSynth, soundPitch);

        Color primaryColor;
        Color secondaryColor;
        Color accentColor;

        switch (activeTheme) {
            case THEME_SUNSET:
                primaryColor = (Color){ 255, 120, 40, 255 };
                secondaryColor = (Color){ 240, 60, 90, 255 };
                accentColor = (Color){ 255, 210, 80, 255 };
                break;
            case THEME_EMERALD:
                primaryColor = (Color){ 20, 210, 140, 255 };
                secondaryColor = (Color){ 10, 160, 180, 255 };
                accentColor = (Color){ 140, 240, 100, 255 };
                break;
            case THEME_CYAN:
            default:
                primaryColor = (Color){ 30, 190, 255, 255 };
                secondaryColor = (Color){ 140, 60, 255, 255 };
                accentColor = (Color){ 80, 240, 255, 255 };
                break;
        }

        bool triggerChime = false;
        bool triggerLaser = false;
        bool triggerPop = false;
        bool triggerSynth = false;

        if (IsKeyPressed(KEY_ONE)) triggerChime = true;
        if (IsKeyPressed(KEY_TWO)) triggerLaser = true;
        if (IsKeyPressed(KEY_THREE)) triggerPop = true;
        if (IsKeyPressed(KEY_FOUR)) triggerSynth = true;

        if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
            Vector2 mPos = GetMousePosition();
            if (CheckCollisionPointCircle(mPos, stageCenter, 50.0f)) {
                triggerChime = true;
            }
        }

        #define SPAWN_RIPPLE(col) do { \
            for (int r = 0; r < MAX_SHOCKWAVES; r++) { \
                if (!shockwaves[r].active) { \
                    shockwaves[r].active = true; \
                    shockwaves[r].center = stageCenter; \
                    shockwaves[r].radius = 28.0f; \
                    shockwaves[r].maxRadius = 160.0f; \
                    shockwaves[r].alpha = 0.95f; \
                    shockwaves[r].color = col; \
                    break; \
                } \
            } \
            pulseIntensity = 1.0f; \
        } while (0)

        if (triggerChime) {
            PlaySound(sndChime);
            lastPlayedSound = "Chime (Harmonic)";
            SPAWN_RIPPLE(accentColor);
        } else if (triggerLaser) {
            PlaySound(sndLaser);
            lastPlayedSound = "Laser (Sweep)";
            SPAWN_RIPPLE(secondaryColor);
        } else if (triggerPop) {
            PlaySound(sndPop);
            lastPlayedSound = "Pop (Percussion)";
            SPAWN_RIPPLE(primaryColor);
        } else if (triggerSynth) {
            PlaySound(sndSynth);
            lastPlayedSound = "Synth (Vibrato)";
            SPAWN_RIPPLE(Fade(accentColor, 0.8f));
        }

        for (int r = 0; r < MAX_SHOCKWAVES; r++) {
            if (shockwaves[r].active) {
                shockwaves[r].radius += 180.0f * animSpeed * dt;
                shockwaves[r].alpha -= 1.4f * animSpeed * dt;
                if (shockwaves[r].alpha <= 0.0f || shockwaves[r].radius >= shockwaves[r].maxRadius) {
                    shockwaves[r].active = false;
                }
            }
        }

        pulseIntensity -= 2.2f * dt;
        if (pulseIntensity < 0.0f) pulseIntensity = 0.0f;

        for (int b = 0; b < NUM_SPECTRUM_BARS; b++) {
            float phase = (float)b * 0.45f;
            float harmonic = sinf(time * animSpeed * 4.0f + phase) * 0.5f + 0.5f;
            float harmonic2 = sinf(time * animSpeed * 7.5f - phase * 1.5f) * 0.3f;
            float target = (harmonic + harmonic2) * 65.0f + 12.0f;
            target += pulseIntensity * (70.0f + sinf((float)b) * 20.0f);

            bars[b].targetHeight = target;
            bars[b].height += (bars[b].targetHeight - bars[b].height) * 12.0f * dt;

            if (bars[b].height > bars[b].peakHeight) {
                bars[b].peakHeight = bars[b].height;
                bars[b].peakVelocity = 0.0f;
            } else {
                bars[b].peakVelocity += 250.0f * dt;
                bars[b].peakHeight -= bars[b].peakVelocity * dt;
                if (bars[b].peakHeight < bars[b].height) {
                    bars[b].peakHeight = bars[b].height;
                }
            }
        }

        BeginDrawing();
            ClearBackground((Color){ 16, 20, 28, 255 });

            DrawText("RAYLIB AUDIO & GUI SYNTHESIZER", 20, 15, 20, RAYWHITE);
            DrawText("raygui immediate-mode controls, procedural Web Audio, and multi-tier animation", 360, 18, 12, GRAY);

            // Left Panel: Group 1 - Sound FX & Trigger Deck
            GuiGroupBox((Rectangle){ 15, 50, 295, 180 }, "Audio Synthesizer & FX");

            if (GuiButton((Rectangle){ 25, 75, 130, 32 }, "#131#Chime [1]")) {
                PlaySound(sndChime);
                lastPlayedSound = "Chime (Harmonic)";
                SPAWN_RIPPLE(accentColor);
            }
            if (GuiButton((Rectangle){ 165, 75, 135, 32 }, "#134#Laser [2]")) {
                PlaySound(sndLaser);
                lastPlayedSound = "Laser (Sweep)";
                SPAWN_RIPPLE(secondaryColor);
            }
            if (GuiButton((Rectangle){ 25, 115, 130, 32 }, "#133#Pop [3]")) {
                PlaySound(sndPop);
                lastPlayedSound = "Pop (Percussion)";
                SPAWN_RIPPLE(primaryColor);
            }
            if (GuiButton((Rectangle){ 165, 115, 135, 32 }, "#138#Synth [4]")) {
                PlaySound(sndSynth);
                lastPlayedSound = "Synth (Vibrato)";
                SPAWN_RIPPLE(Fade(accentColor, 0.8f));
            }

            GuiLabel((Rectangle){ 25, 158, 60, 20 }, "Volume:");
            (void)GuiSlider((Rectangle){ 85, 158, 145, 20 }, "0%", "100%", &masterVolume, 0.0f, 1.0f);
            DrawText(TextFormat("%.0f%%", masterVolume * 100.0f), 245, 160, 13, RAYWHITE);

            GuiLabel((Rectangle){ 25, 192, 60, 20 }, "Pitch:");
            (void)GuiSlider((Rectangle){ 85, 192, 145, 20 }, "0.5x", "2.0x", &soundPitch, 0.5f, 2.0f);
            DrawText(TextFormat("%.2fx", soundPitch), 245, 194, 13, RAYWHITE);

            // Left Panel: Group 2 - Visualizer & Animation Controls
            GuiGroupBox((Rectangle){ 15, 245, 295, 190 }, "Animation & Themes");

            (void)GuiCheckBox((Rectangle){ 25, 272, 18, 18 }, "Spectrum Equalizer", &showEqualizer);
            (void)GuiCheckBox((Rectangle){ 165, 272, 18, 18 }, "Orbital Particles", &showOrbital);

            GuiLabel((Rectangle){ 25, 308, 60, 20 }, "Speed:");
            (void)GuiSlider((Rectangle){ 85, 308, 145, 20 }, "0.5x", "3.0x", &animSpeed, 0.5f, 3.0f);
            DrawText(TextFormat("%.1fx", animSpeed), 245, 310, 13, RAYWHITE);

            GuiLabel((Rectangle){ 25, 345, 60, 20 }, "Themes:");
            if (GuiButton((Rectangle){ 85, 342, 65, 26 }, "Cyan")) activeTheme = THEME_CYAN;
            if (GuiButton((Rectangle){ 155, 342, 65, 26 }, "Sunset")) activeTheme = THEME_SUNSET;
            if (GuiButton((Rectangle){ 225, 342, 65, 26 }, "Emerald")) activeTheme = THEME_EMERALD;

            DrawText("Audio State:", 25, 385, 13, GRAY);
            DrawText(IsAudioDeviceReady() ? "READY (Web Audio)" : "INACTIVE", 110, 385, 13, GREEN);
            DrawText(TextFormat("Last Played: %s", lastPlayedSound), 25, 408, 13, accentColor);

            // Right Stage: Live Interactive Visualizer
            GuiGroupBox(stageRect, "Interactive Visualizer Stage");
            DrawRectangleRec((Rectangle){ 326, 65, 458, 368 }, (Color){ 10, 12, 18, 255 });

            // 1. Shockwaves
            for (int r = 0; r < MAX_SHOCKWAVES; r++) {
                if (shockwaves[r].active) {
                    DrawCircleLines((int)shockwaves[r].center.x, (int)shockwaves[r].center.y, shockwaves[r].radius, Fade(shockwaves[r].color, shockwaves[r].alpha));
                    DrawCircleLines((int)shockwaves[r].center.x, (int)shockwaves[r].center.y, shockwaves[r].radius + 2.0f, Fade(shockwaves[r].color, shockwaves[r].alpha * 0.5f));
                }
            }

            // 2. Orbital Particles
            if (showOrbital) {
                float baseR = 85.0f + pulseIntensity * 25.0f;
                for (int p = 0; p < NUM_ORBITAL_PARTICLES; p++) {
                    float theta = time * animSpeed * 1.5f + (float)p * (2.0f * PI / (float)NUM_ORBITAL_PARTICLES);
                    float r = baseR + sinf(theta * 3.0f + time * 2.0f) * 12.0f;
                    float px = stageCenter.x + cosf(theta) * r;
                    float py = stageCenter.y + sinf(theta) * r;
                    float pSize = 3.0f + sinf(theta * 2.0f) * 1.5f + pulseIntensity * 2.0f;

                    DrawCircle((int)px, (int)py, pSize, Fade(primaryColor, 0.85f));
                    DrawLine((int)stageCenter.x, (int)stageCenter.y, (int)px, (int)py, Fade(secondaryColor, 0.12f));
                }
            }

            // 3. Central Core Orb
            float coreRadius = 36.0f + sinf(time * animSpeed * 3.0f) * 5.0f + pulseIntensity * 16.0f;
            DrawCircleV(stageCenter, coreRadius + 10.0f, Fade(primaryColor, 0.15f));
            DrawCircleV(stageCenter, coreRadius + 4.0f, Fade(primaryColor, 0.35f));
            DrawCircleV(stageCenter, coreRadius, primaryColor);
            DrawCircleV(stageCenter, coreRadius * 0.55f, RAYWHITE);
            DrawText("CLICK", (int)stageCenter.x - 18, (int)stageCenter.y - 6, 11, DARKBLUE);

            // 4. Equalizer Spectrum Bars
            if (showEqualizer) {
                int barW = 18;
                int barGap = 8;
                int totalW = NUM_SPECTRUM_BARS * barW + (NUM_SPECTRUM_BARS - 1) * barGap;
                int startX = (int)(stageRect.x + (stageRect.width - totalW) / 2.0f);
                int baseY = (int)(stageRect.y + stageRect.height - 20);

                for (int b = 0; b < NUM_SPECTRUM_BARS; b++) {
                    int bx = startX + b * (barW + barGap);
                    int bh = (int)bars[b].height;
                    int by = baseY - bh;

                    Color barCol = Fade(primaryColor, 0.75f + ((float)b / (float)NUM_SPECTRUM_BARS) * 0.25f);
                    DrawRectangle(bx, by, barW, bh, barCol);
                    DrawRectangleLines(bx, by, barW, bh, Fade(RAYWHITE, 0.3f));

                    // Peak cap line
                    int peakY = baseY - (int)bars[b].peakHeight;
                    DrawRectangle(bx - 1, peakY - 3, barW + 2, 3, accentColor);
                }
            }

            DrawText(TextFormat("FPS: %i", GetFPS()), 725, 75, 12, GRAY);
            DrawText("Keys [1..4] / Click Orb", 625, 412, 12, GRAY);

        EndDrawing();
    }

    UnloadSound(sndChime);
    UnloadSound(sndLaser);
    UnloadSound(sndPop);
    UnloadSound(sndSynth);

    CloseAudioDevice();
    CloseWindow();

    return 0;
}
