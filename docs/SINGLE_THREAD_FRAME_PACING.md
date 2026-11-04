# Single-Threaded WebAssembly Graphics & Frame Pacing: Case Study on Progressive Delays

This document provides an in-depth architectural and mathematical analysis of frame pacing in `wasm-c-ide`. It explores the fundamental constraints of single-threaded WebAssembly execution and investigates why a progressive animation delay (such as `turtle_delay(25.0)`) produces an apparent ~47 FPS during drawing before returning to 60 FPS upon completion.

---

## 1. Architectural Foundation: The Single-Threaded Sandbox

In desktop environments, high-performance graphics engines (e.g., Unreal Engine, Unity, or multi-threaded Raylib configurations) often decouple application logic from frame presentation:
- **Game/Logic Thread**: Updates physics, user input, and game state.
- **Render Thread**: Translates draw calls into GPU command buffers.
- **Display Compositor / VSync**: Flips the swap chain at the display's native refresh rate (e.g., 60 Hz or 144 Hz).

Under this multi-threaded model, if the user logic thread sleeps or experiences delays, the display loop can continue presenting frames at an invariant 60 FPS (rendering repeated frames or static scenes).

### The WebAssembly & WASI Reality

In `wasm-c-ide`, client-side C/C++ applications compile to WASI Preview 1 (`wasm32-wasip1`) and execute inside a dedicated browser Web Worker (`src/workers/runtime.worker.js`). Within this environment:

1. **Strictly Single-Threaded**: The user's C code, standard library (`wasi-libc`), graphics abstraction layer (`libturtle`), and the Raylib engine (`raylib-wasi`) execute sequentially on **one single thread**.
2. **No Background Display Loop**: Raylib has no independent timer interrupt or background thread. Frames are not pushed automatically at 60 Hz.
3. **Synchronous Frame Production**: A frame is rasterized, transferred, and counted towards the application's FPS **only when `EndDrawing()` is explicitly invoked**.
4. **Additive Execution Costs**: Any computational workload (`turtle_forward()`), state calculation (`turtle_turn_left()`), or deliberate sleep (`turtle_delay()`) directly blocks the thread and delays the next invocation of `EndDrawing()`.

---

## 2. Problem Statement: The 25ms Progressive Delay Scenario

Consider the pedagogical Raylib turtle graphics demo (`examples/07_turtle_raylib.c`):

```c
int main(void) {
    turtle_raylib_context_t ctx = {
        .width = 800,
        .height = 600,
        .title = "Turtle Graphics - Raylib Demo",
        .target_fps = 60
    };

    if (!turtle_begin(&ctx)) return 1;

    turtle_clear(TURTLE_WHITE);
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
```

### The Observed Phenomenon
- **During Drawing (0.0s – 1.8s)**: The graphical window FPS badge fluctuates around **~47 FPS**.
- **After Drawing Finishes (1.8s+)**: The FPS badge jumps immediately to a solid, invariant **60 FPS**.

### The Common Intuition & Why It Fails
A developer might intuitively expect:
> *"The FPS should remain locked at 60 FPS throughout the entire run because the context sets `target_fps = 60`. Raylib's main loop should govern the 60 Hz refresh rate, and any delay or line drawing caused by libturtle should just dictate how fast the turtle advances without affecting the canvas FPS."*

Because WebAssembly execution is strictly single-threaded, there is no separate main loop running concurrently while `turtle_delay()` sleeps. The delay is not merely an animation step; it pauses the entire rendering pipeline.

---

## 3. Deconstructing the Execution Pipeline

To understand why the FPS drops to ~47 FPS rather than staying at 60 FPS (or dropping to 40 FPS), we must examine how Raylib and `libturtle` handle timing.

### Phase 1: Inside `EndDrawing()` (Raylib Frame Limiter)

In upstream Raylib (`rcore.c`), `EndDrawing()` enforces `SetTargetFPS(60)` via internal timestamps:
```c
// rcore.c
void BeginDrawing(void) {
    CORE.Time.current = GetTime();
    CORE.Time.update = CORE.Time.current - CORE.Time.previous;
    CORE.Time.previous = CORE.Time.current;
    ...
}

void EndDrawing(void) {
    SwapScreenBuffer(); // Transfers frame to main thread; increments frameCount

    CORE.Time.current = GetTime();
    CORE.Time.draw = CORE.Time.current - CORE.Time.previous;
    CORE.Time.previous = CORE.Time.current;
    CORE.Time.frame = CORE.Time.update + CORE.Time.draw;

    if (CORE.Time.frame < CORE.Time.target) { // target = 1/60s = 0.016667s (16.67ms)
        WaitTime(CORE.Time.target - CORE.Time.frame);
        CORE.Time.current = GetTime();
        double waitTime = CORE.Time.current - CORE.Time.previous;
        CORE.Time.previous = CORE.Time.current;
        CORE.Time.frame += waitTime;
    }
    PollInputEvents();
}
```

Key observations:
1. `CORE.Time.update` captures the time spent **outside** `BeginDrawing()` / `EndDrawing()`.
2. Raylib throttles each frame so that $\text{update} + \text{draw} + \text{waitTime} = \text{target} = 16.67\text{ ms}$.
3. If $\text{update} + \text{draw} \ge 16.67\text{ ms}$, Raylib performs **zero wait**.

---

### Phase 2: Inside `hal_turtle_delay()` (Turtle Pacing Loop)

In `backend/raylib/hal_raylib.c`, `hal_turtle_delay()` is designed to pace progressive animations while keeping the window responsive:

```c
void hal_turtle_delay(double ms) {
    if (!g_initialized) return;

    double frame_interval = (g_target_fps > 0) ? (1.0 / (double)g_target_fps) : (1.0 / 60.0);
    double start = GetTime();
    double duration = ms / 1000.0; // 25ms = 0.025s

    /* Initial presentation */
    render_screen(); // Call #1

    while (!WindowShouldClose()) {
        double elapsed = GetTime() - start;
        double remaining = duration - elapsed;
        if (remaining <= 0.001) break;

        /* Only perform another full frame render if at least one frame interval remains */
        if (remaining >= frame_interval) { // 16.67ms
            render_screen(); // Call #2
        } else {
            WaitTime(remaining);
            PollInputEvents();
            break;
        }
    }
}
```

Notice the dual-pacing interaction:
- The requested delay is **25.0 ms**.
- The 60 FPS frame interval is **16.67 ms**.
- 25 ms is exactly $1.5\times$ a 60 FPS frame interval.

---

## 4. Mathematical & Mechanical Derivation of 47 FPS (21.3 ms)

### A. The Direct Mathematical Relation

The FPS badge in `wasm-c-ide` measures the number of frames presented over rolling 1000 ms windows:
$$\text{FPS} = \frac{\text{Frames}}{\text{Elapsed Time (seconds)}} = \frac{\text{Frames} \times 1000}{\text{Elapsed Time (ms)}}$$

Frame rate and frame period are exact reciprocals:
$$T_{\text{avg}} = \frac{1000\text{ ms}}{47\text{ frames}} \approx 21.277\text{ ms} \approx 21.3\text{ ms}$$

An observed rate of 47 FPS indicates that during the drawing phase, a frame is delivered to the screen every **21.3 ms** on average.

---

### B. The Alternating Step Cycle

Why does the frame interval average out to 21.3 ms, when neither 25 ms nor 16.67 ms equals 21.3 ms?

Because of how Raylib's `CORE.Time.update` interacts with `hal_turtle_delay()`, the 25 ms delay steps fall into two alternating behaviors:

#### 1. One-Frame Steps (~25 ms per frame)
- In step $k$, `render_screen()` is called.
- Because the previous step had little external delay, Raylib's `EndDrawing()` throttles the frame for nearly the full target interval ($\sim 16.7\text{ ms}$).
- When `render_screen()` returns, `elapsed = GetTime() - start` is already $\approx 16.7\text{ ms}$.
- `remaining = 25.0ms - 16.7ms = 8.3ms`.
- Since $8.3\text{ ms} < 16.67\text{ ms}$, the check `remaining >= frame_interval` is **false**.
- The loop enters `else`, calls `WaitTime(remaining)` ($\sim 8.3\text{ ms}$), and terminates.
- **Yield**: Exactly **1 frame** produced for the 25 ms delay ($\approx 25\text{ ms}$ duration $\implies 40\text{ FPS}$).

#### 2. Two-Frame Steps (~12.5 ms per frame)
- In step $k+1$, `turtle_forward()` executes, followed by `turtle_delay()`.
- When `render_screen()` calls `BeginDrawing()`, Raylib measures `CORE.Time.update`. Because the thread just spent $\sim 8.3\text{ ms}$ in `WaitTime(remaining)` plus line drawing, Raylib calculates that the current frame is already partially expired.
- Inside `EndDrawing()``, Raylib only waits for $16.67\text{ ms} - 9.0\text{ ms} \approx 7.67\text{ ms}$.
- When `render_screen()` returns, `elapsed` is only $\sim 8.2\text{ ms}$.
- `remaining = 25.0ms - 8.2ms = 16.8\text{ ms}`.
- Because $16.8\text{ ms} \ge 16.67\text{ ms}$, the condition `remaining >= frame_interval` evaluates to **true**!
- `hal_turtle_delay()` invokes `render_screen()` a **second time**.
- **Yield**: Exactly **2 frames** produced within that 25 ms window ($\approx 12.5\text{ ms}$ average per frame).

---

### C. The Mixture Equation

Over a standard 1000 ms measurement window, the program executes:
$$\frac{1000\text{ ms}}{25\text{ ms}} = 40\text{ total delay steps}$$

Let:
- $n_1$ = number of 25 ms steps that yielded **1 frame**
- $n_2$ = number of 25 ms steps that yielded **2 frames**

We establish the linear system:
$$\begin{cases}
n_1 + n_2 = 40 &\text{(total steps in 1000 ms)} \\
1 \cdot n_1 + 2 \cdot n_2 = 47 &\text{(total frames reported by host)}
\end{cases}$$

Solving for $n_1$ and $n_2$:
$$n_2 = 47 - 40 = 7\text{ steps (two-frame renders)}$$
$$n_1 = 40 - 7 = 33\text{ steps (one-frame renders)}$$

Weighted average frame duration:
$$T_{\text{avg}} = \frac{33 \times 25.0\text{ ms} + 7 \times 25.0\text{ ms}}{47\text{ frames}} = \frac{1000\text{ ms}}{47\text{ frames}} = \mathbf{21.28\text{ ms}}$$

Thus:
- ~82.5% of iterations produce 1 frame ($25\text{ ms}$)
- ~17.5% of iterations produce 2 frames ($12.5\text{ ms}$ average)
- Together with browser runtime overhead (WebGL draw flushes, `transferToImageBitmap()`, `postMessage` serialization, and `Atomics.wait` millisecond rounding), the frame cadence stabilizes at **~47 FPS** ($21.3\text{ ms}$ per frame).

---

## 5. Transition to 60 FPS: The `hal_turtle_present()` Loop

Once the 72 segments of the geometric rosette finish, execution leaves the `for` loop:
```c
turtle_end();
```

Inside `turtle_end()`, control passes to `hal_turtle_present()`:
```c
void hal_turtle_present(void) {
    if (!g_initialized) return;

    /* Interactive display loop until window close requested */
    while (!WindowShouldClose()) {
        render_screen();
    }
}
```

In this phase:
1. No turtle commands (`turtle_forward`, `turtle_turn`) execute.
2. No user delays (`turtle_delay`) occur.
3. `render_screen()` executes purely `BeginDrawing()` $\to$ `DrawTexturePro()` $\to$ `EndDrawing()`.
4. Total CPU draw time is under $0.5\text{ ms}$.
5. Raylib's `WaitTime(16.67ms - 0.5ms)` sleeps for $\sim 16.2\text{ ms}$ via `Atomics.wait()` on each iteration.
6. The loop runs exactly 60 times per second, emitting a rock-solid **60 FPS**.

---

## 6. Architectural Takeaways & Pedagogical Guidelines

| Concept | Multi-Threaded Desktop Engine | Single-Threaded WASI / Browser Worker |
|---|---|---|
| **Thread Model** | Decoupled render thread & game thread | Single unified thread for logic, drawing, and WASI syscalls |
| **Refresh Rate Control** | Display hardware VSync timer | Driven synchronously by `EndDrawing()` |
| **Animation Sleep** | Sleep pauses logic; swap chain still flips | Sleep halts the entire thread and delays frame emission |
| **Progressive Delay Cadence** | Render loop can interpolate between ticks | Frames are strictly clamped to delay and sleep boundaries |

### Best Practices for WebAssembly Graphics
1. **Align Delays with Frame Intervals**:
   If an animation needs to run at 60 FPS, pacing delays should match the native frame period ($1000 / 60 \approx 16.67\text{ ms}$) or integer multiples of it ($33.3\text{ ms}$ for 30 FPS, $50.0\text{ ms}$ for 20 FPS).
2. **Avoid Fractional Multiples**:
   Delays like $25\text{ ms}$ ($1.5\times$ frame interval) inevitably introduce frame cadence jitter and non-integer FPS metrics (~47 FPS) due to beating against the 60 Hz frame limiter.
3. **Prefer Zero-Delay Batching for Speed**:
   When drawing complex procedural geometries where progressive visualization is not required, omit `turtle_delay()` entirely. Batch all draw calls into the backing render texture and call `turtle_end()` to present the finished artwork instantly at 60 FPS.
