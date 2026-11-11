# Architectural Specification: BusyBox POSIX Shell, GNU Make & SQLite Utilities Subsystems

This document specifies the architecture, dispatch protocols, and runtime constraints for the **BusyBox WASI Shell (`busybox-wasi`)**, **GNU Make (`make-wasi`)**, and the **SQLite 3 WASI Subsystem (`sqlite-wasi`)** in `wasm-c-ide`.

---

## 1. BusyBox WASI POSIX Shell (`busybox-wasi`)

The interactive shell in `wasm-c-ide` is powered by upstream BusyBox compiled to single-threaded WebAssembly Preview 1 (`wasm32-wasip1`) as `busybox.wasm`. It runs inside a dedicated Web Worker (`src/workers/shell.worker.js`).

### 1.1 Architecture & Core Components
- **True In-Memory Ash Shell**: Interprets complete POSIX shell scripts, control structures (`for`, `while`, `if`/`then`/`else`), functions, and command substitutions.
- **70+ Bundled Unix Core Utilities**: All standard utilities (`cat`, `grep`, `ls`, `sed`, `awk`, `find`, `xargs`, `tar`, `gzip`, etc.) are compiled into the multicall `busybox.wasm` binary and mounted under `/bin`.
- **Virtual Character Devices (`/dev/null`, `/dev/zero`)**: Pre-mounted under `/dev` with custom file descriptors in `WasiHost` to enable stream redirection (`> /dev/null`, `< /dev/null`) without allocating VFS memory.

### 1.2 Host-Assisted Process Execution (`wasi_host_spawn` / `__host_exec`)
Because WASI Preview 1 lacks kernel `fork()` and `exec()`, BusyBox delegates external command invocations to the host bridge:
1. When a user runs an external command (e.g. `gcc main.c`, `make`, `./a.out`, `sqlite3`), BusyBox invokes the host-imported function `wasi_host_spawn(argv, envp)`.
2. `WasiHost` intercepts this call, translates arguments from WASM linear memory, and dispatches an RPC message (`type: 'exec_command'`) to `src/main.js`.
3. The main thread routes compilation requests to `CompilerClient` (`compiler.worker.js`) or user binary executions to `RuntimeManager` (`runtime.worker.js`).
4. Upon completion, the exit code and file mutation differential are returned to `shell.worker.js` via `rpc_response`, resuming the shell without crashing or unhandled traps.

### 1.3 Directory Stack Operations (`pushd`, `popd`, `dirs`)
BusyBox `ash` does not natively include bash-specific builtins `pushd` and `popd`. To support these workflows pedagogically, `shell.worker.js` injects a lightweight shell preamble before executing each command line:
- Maintains an in-memory directory stack string serialized across command invocations.
- Updates working directory transitions back to the master IDE via host hook `__host_update_pwd "$(pwd)"`.
- Synchronizes the IDE's file tree and editor status with the active working directory.

### 1.4 Interrupt Handling (`Ctrl+C`)
When `Ctrl+C` (`\x03`) is received:
- If a foreground command or script is running, `shell.worker.js` marks `isInterrupted = true`, terminates or aborts the active sub-process, flushes stdout/stderr, clears pending RPC callbacks, and immediately re-emits the prompt.
- If at the interactive prompt, the current input buffer is cleared, `^C` is echoed, and a fresh prompt line is printed.

---

## 2. Real GNU Make WASI Integration (`make-wasi`)

`wasm-c-ide` includes real GNU Make 4.4.1 compiled to `wasm32-wasip1` (`make.wasm`) without mock interpreters:
- **Executable Location**: Mounted at `/usr/bin/make` in the VFS.
- **Recipe Execution**: When `make` evaluates a rule recipe (e.g. `$(CC) -c main.c -o main.o`), it invokes the host import `wasi_host_spawn` to execute each command line in the active working directory.
- **Prerequisite Timestamp Checking**: Reads modification timestamps (`mtime`) directly from VFS nodes via `stat()`, avoiding redundant recompilation when target files are up to date.
- **Dual Build System**: Users can switch between a simple shell script (`build.sh`) and standard `Makefile` via the Project Settings modal.

---

## 3. SQLite 3 WASI Embedded Database & CLI Subsystem (`sqlite-wasi`)

The IDE bundles SQLite 3.54.1 compiled targeting `wasm32-wasip1`:

### 3.1 C API & Linking
- Headers (`<sqlite3.h>`, `<sqlite3ext.h>`) are pre-populated into `/usr/include/`.
- Precompiled static library `libsqlite3.a` is mounted in `/usr/lib/` and `/lib/wasm32-wasip1/`.
- User C/C++ applications compile and link seamlessly with `-lsqlite3`:
  ```bash
  gcc 09_sqlite_database.c -lsqlite3 -o db_app
  ./db_app
  ```

### 3.2 Standalone CLI Executable (`sqlite3.wasm`)
- Precompiled interactive CLI binary mounted at `/usr/bin/sqlite3`.
- Directly invocable from the terminal shell:
  ```bash
  sqlite3 demo.db "CREATE TABLE users (id INT, name TEXT); INSERT INTO users VALUES (1, 'Alice');"
  sqlite3 demo.db "SELECT * FROM users;"
  ```
- Supports in-memory databases (`sqlite3 :memory:`) and persistent on-disk database files in `/workspace`.
- TTY detection: Emulates standard POSIX `isatty()` in `WasiHost` so `sqlite3` displays its interactive prompt (`sqlite> `) when stdin is attached to the terminal.
