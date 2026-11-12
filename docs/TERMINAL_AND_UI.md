# Architectural Specification: Terminal, LineEditor & Workspace UI Subsystems

This document details the user interface components, terminal emulator subsystems, input line editors, and modal configuration dialogs in `wasm-c-ide`.

---

## 1. Terminal Emulator & Detached Floating Mode (`TerminalManager`)

`wasm-c-ide` embeds `xterm.js` for authentic terminal interaction and provides standard VT100 windowing modes:

### 1.1 Detached Floating Window Mode
- **Window Detachment**: Terminal can be detached from the bottom dock into a floating draggable window (`#detached-terminal-window`).
- **Standard VT100 Dimensions**: Snaps to classic terminal dimensions:
  - Preset 1: `80x24` (Standard VT100 / classic Unix terminal)
  - Preset 2: `100x30`
  - Preset 3: `120x36`
- **Interactive Preset Badge**: Clicking the dimension badge in the window titlebar cycles presets and resizes the terminal grid dynamically.
- **Window Controls**: Minimize to title bar (`_`), maximize/dock (`□`), and close (`✕`).
- **Focus Tracking**: Active window glows with a green outline (`--term-border-glow`).
- **Keyboard Shortcut**: `Ctrl+Shift+D` (or `Cmd+Shift+D`) toggles between docked and floating modes.

### 1.2 ANSI VT100 Support & Synchronous Sleep
- Supports ANSI escape sequences: cursor movement (`\x1b[H`, `\x1b[row;colH`), clear screen (`\x1b[2J`), line clearing (`\x1b[K`), and 256-color palettes.
- `poll_oneoff` in `WasiHost` implements real sub-millisecond sleeps (`usleep`, `nanosleep`), enabling smooth console animations and terminal games without pegging CPU usage.

---

## 2. Contextual Line Editor (`LineEditor`)

The `LineEditor` (`src/terminal/line-editor.js`) provides a unified, prompt-safe input engine for both the BusyBox shell and user programs (`scanf`, `fgets`, `cin`, `getchar`).

### 2.1 Core Capabilities
- **Inline Editing**: In-place cursor movement (Left/Right arrows), Home/End (`Ctrl+A` / `Ctrl+E`), backspace, and delete.
- **Emacs-Style Kill Ring**: `Ctrl+K` (kill to end of line), `Ctrl+U` (clear entire line).
- **History Navigation**: Up/Down arrows recall past commands. Remembers and restores in-progress scratch lines.
- **Contextual Isolation**: Maintains isolated history contexts (e.g. `'shell'` vs user binary names) so shell commands do not pollute program stdin history.
- **Signals & Hooks**: `Enter` triggers `onLine`, `Ctrl+D` triggers `onEof`, and `Ctrl+C` triggers `onInterrupt`.

---

## 3. Collapsible & Resizable Workspace Sidebar

- **Horizontal Drag Resizing**: Vertical divider `#sidebar-resizer` between sidebar and editor with `col-resize` cursor (160px to 600px clamping, double-click resets to default 240px).
- **36px Slim Rail Collapse**: Collapses into a 36px vertical rail showing the toggle button and vertical **WORKSPACE** badge, maximizing editor area.
- **Keyboard Shortcut**: `Ctrl+B` (or `Cmd+B`) toggles collapse state.
- **Persistence**: Persists custom width and collapsed state across sessions in `localStorage`.

---

## 4. Project Settings Modal & Configurable Run Execution (`SettingsModal`)

- **Dual Build Tooling**: Choose between Shell Script (`build.sh`) and standard `Makefile`.
- **Custom Compiler Flags**: Configurable compilation flags (e.g. `-Wall -Wextra`, optimization levels `-O0`..`-O3`, debug symbols `-g`).
- **Configurable Run Command**: Allows users to specify custom execution commands with runtime arguments:
  ```bash
  ./a.out --verbose --iterations 10
  ```
- **System Upgrade & Cache Clear**: "Update System Files" button clears cached WebAssembly binaries in IndexedDB, purges Service Worker `CacheStorage`, unregisters active Service Workers, and triggers a cache-busting reload (`?_upgrade=<timestamp>`) to fetch fresh assets without stale browser HTTP disk cache locks.

---

## 5. Integrated API Reference Drawer & Documentation Portal

- **In-IDE Reference Drawer**: Sliding side drawer with 5 dedicated technical reference tabs:
  1. *C/C++ Standard Library & WASI Limits* (WASI Preview 1 syscall support, missing POSIX functions, single-threading caveats).
  2. *Turtle Graphics* (Cartesian coordinates, functions, and backend selection).
  3. *Canvas 2D & Framebuffer* (HTML5 vector canvas and software pixel buffer APIs).
  4. *Raylib 5.5 Quick Reference* (Windowing, 2D shapes, textures, audio, and raygui).
  5. *SQLite 3 WASI Quick Reference* (C API functions, CLI syntax, and database schemas).
- **1-Click Example Loading**: Direct "Load Example" buttons open bundled educational examples into the Monaco editor and file tree.
- **Standalone Documentation Portal**: Static Markdown and HTML documentation built in `public/docs/` and `dist/docs/`, accessible online or offline with zero backend requirements.
- **Intentional Reference Model vs. Ambient Popups**: To eliminate student confusion and prevent false negative signals regarding standard C library support, ambient editor hover providers are removed in favor of this dedicated Reference Drawer. See [`docs/EDITOR_AND_REFERENCE_DESIGN.md`](./EDITOR_AND_REFERENCE_DESIGN.md) for the detailed design rationale.
