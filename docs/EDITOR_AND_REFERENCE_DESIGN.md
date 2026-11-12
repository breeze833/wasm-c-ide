# Design Decision: Editor Language Services vs. Dedicated Reference Drawer

This document records the architectural and pedagogical design decision regarding Monaco editor hover providers, language server integration, and the centralized API Reference Drawer in `wasm-c-ide`.

---

## 1. Context & Historical Background

In earlier iterations of `wasm-c-ide`, a custom Monaco `HoverProvider` and `CompletionItemProvider` (`src/editor/hover-provider.js`) was introduced to provide inline documentation tooltips and autocomplete suggestions for custom sysroot headers (`<turtle.h>`, `<graphics.h>`, `<graphics_canvas.h>`).

When a student hovered over custom symbols such as `turtle_forward(...)` or `graphics_present(...)`, Monaco displayed a tooltip card detailing the C function signature, parameter explanations, and coordinate conventions.

---

## 2. Problem Statement: Student Confusion & The "Uncanny Valley"

During classroom and educational use, this partial hover feature caused significant confusion among students rather than assisting them:

### 2.1 False Negative Signals & Self-Doubt
- **The Core Issue**: Standard C library functions (`printf`, `scanf`, `malloc`, `free`, `strlen`, `fopen`, `sin`, `sqrt`, etc.), C++ standard library types (`std::vector`, `std::string`), and all student-written functions/variables produced **zero hover tooltips**.
- **Student Perception**: In modern IDEs (like VS Code), hover popups imply semantic language awareness. When students hovered over `printf` and nothing happened, but `turtle_forward` showed rich documentation, students frequently concluded:
  1. *"Did I misspell `printf`?"*
  2. *"Is `stdio.h` broken or missing in this WebAssembly IDE?"*
  3. *"Is `printf` not supported in the browser?"*
- This created **false negative feedback**, eroding students' confidence in standard C code.

### 2.2 The "Uncanny Valley" of Developer Tooling
- Developer tooling works best when it is either:
  1. **Fully comprehensive** (a real language server analyzing all headers, ASTs, and user types), OR
  2. **Clean, predictable, and unobtrusive** (a fast, standard code editor without partial popups).
- A partial hover provider that only recognizes a small hardcoded subset of APIs sits in an "uncanny valley": it raises expectations of an active IntelliSense engine, but fails on 90% of the student's actual codebase.

### 2.3 Ambient Visual Distraction
- Ambient hover popups appear automatically on mouse movement across the editor canvas.
- For novice students, erratic popup cards jumping out during code inspection create visual noise, especially when they cannot be relied upon for the standard library functions they use most often.

---

## 3. Technical Constraints in In-Browser WebAssembly

Providing a comprehensive, reliable hover and autocomplete service for C and C++ inside a browser runtime introduces prohibitive performance costs:

| Approach | Memory / Payload Cost | CPU / Indexing Lag | Feasibility for In-Browser IDE |
|---|---|---|---|
| **Clangd in WebAssembly** (`clangd.wasm`) | 40–60+ MB binary download, 200–500 MB RAM | High CPU indexing load; blocks on single-threaded workers or freezes UI | **Infeasible**: Exceeds memory budgets on student devices (Chromebooks, low-end school PCs) and dramatically slows IDE load time. |
| **Comprehensive Static Dictionary** (libc, libc++, POSIX, Raylib, SQLite, Turtle) | 5–10 MB bundled JSON | Minimal CPU | **Inadequate**: Cannot resolve user-defined functions, structs, typedefs, local scopes, macros, or C++ templates; still produces false negative confusion. |
| **Dedicated Reference Drawer** (`F1` / `Ctrl+Shift+H`) | **0 MB added overhead** (uses existing clean HTML docs) | Zero background CPU / zero memory overhead | **Ideal**: Clean separation of editing and documentation; 100% predictable. |

---

## 4. Architectural Decision: The Intentional "Pull" Reference Model

To eliminate student confusion and maintain optimal performance on resource-limited browser runtimes:

1. **Complete Removal of Editor Hover Providers**:
   - The editor hover provider (`src/editor/hover-provider.js`) is completely turned off and removed from Monaco initialization.
   - Monaco functions strictly as a fast, responsive, predictable text and code editor with syntax highlighting, indentation, and standard keyboard navigation.
   - No ambient popup cards appear on hover, eliminating false negative signals for standard C/C++ APIs.

2. **Centralization in the Reference Drawer (`src/components/reference.js`)**:
   - All documentation for custom headers (`<turtle.h>`, `<graphics.h>`, `<graphics_canvas.h>`), standard C library limitations in WASI Preview 1, Raylib 5.5 (`<raylib.h>`), and SQLite 3 (`<sqlite3.h>`) is consolidated into the sliding **Reference Drawer**.
   - Accessible via toolbar button (`[📖 Reference & Docs]`) or keyboard shortcuts (`F1` / `Ctrl+Shift+H`).
   - Features real-time keyword filtering, complete function prototypes, WASI caveats, and 1-click example template loading.

3. **Pedagogical Benefits**:
   - **Teaches Intentional Documentation Lookup**: In professional software development, engineers consult man pages (`man 3 printf`), header files, or documentation portals. The Reference Drawer reinforces this intentional "pull" habit.
   - **Compiler-Driven Learning**: Compiler diagnostics (`-Wall`, `-Wextra`, `-pedantic-errors`) streamed directly to `xterm.js` with exact file, line, column numbers, and ANSI color formatting teach students how C compilers report syntax and type issues, which is fundamental to systems programming.

---

## 5. Invariants & Guardrails

- **Do Not Reintroduce Partial Hover Providers**: Autonomous agents and contributors must not register ad-hoc Monaco hover or completion providers for individual libraries or subsets of APIs without implementing a full, universal language server.
- **Reference Drawer Parity**: Any new custom sysroot header or library mounted into the IDE must document its API within the Reference Drawer (`src/components/reference.js`) and standalone portal (`ide-docs/`), rather than in editor popup hooks.
