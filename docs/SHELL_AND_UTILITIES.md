# Architectural Specification: BusyBox POSIX Shell, GNU Make & SQLite Utilities Subsystems

This document specifies the architecture, dispatch protocols, and runtime constraints for the **BusyBox WASI Shell (`busybox-wasi`)**, **GNU Make (`make-wasi`)**, and the **SQLite 3 WASI Subsystem (`sqlite-wasi`)** in `wasm-c-ide`.

---

## 1. BusyBox WASI POSIX Shell (`busybox-wasi`)

The interactive shell in `wasm-c-ide` is powered by upstream BusyBox compiled to single-threaded WebAssembly Preview 1 (`wasm32-wasip1`) as `busybox.wasm`. It executes inside a dedicated Web Worker (`src/workers/shell.worker.js`).

### 1.1 Architecture & Core Components
- **True In-Memory Ash Shell**: Interprets complete POSIX shell scripts, control structures (`for`, `while`, `if`/`then`/`else`), functions, and command substitutions.
- **70+ Bundled Unix Core Utilities**: All standard utilities (`cat`, `grep`, `ls`, `sed`, `awk`, `find`, `xargs`, `tar`, `gzip`, etc.) are compiled into the multicall `busybox.wasm` binary and mounted under `/bin`.
- **Virtual Character Devices (`/dev/null`, `/dev/zero`)**: Pre-mounted under `/dev` with custom file descriptors in `WasiHost` to enable stream redirection (`> /dev/null`, `< /dev/null`) without physical VFS memory allocation.

---

### 1.2 Two-Tier Smart Command Dispatcher & Invocation Taxonomy

Because WASI Preview 1 lacks kernel `fork()` and `exec()`, `shell.worker.js` implements a **Two-Tier Smart Command Dispatcher**. When a user submits a command line at the terminal prompt, the dispatcher analyzes the line for unquoted shell metacharacters (`|`, `&`, `;`, `<`, `>`, `$`, `*`, `?`, `\`, `` ` ``, `()`, `{}`) and categorizes the invocation:

```
                                    User Command Line
                                           │
                     ┌─────────────────────┴─────────────────────┐
                     ▼                                           ▼
          Unquoted Shell Operators?                     Simple Command Line
         (|, &, ;, <, >, $, *, ?, ())                            │
                     │                                           ├─ Leading KEY=VAL? ──> Extract envOverrides
                     │                                           │
                     ▼                                           ▼
             Tier 2: BusyBox ash                       Command Classification:
        (busybox sh -c <single_line>)                            │
                     │                                           ├─ Missing? (aa.out) ──> Exit 127: command not found
                     │                                           ├─ Missing file? (./aa.out) ──> Exit 127: not found
                     ▼                                           ├─ Toolchain? (gcc, make) ──> CompilerClient RPC
             Host Import Spawn                                   ├─ Wasm binary? (./a.out) ──> RuntimeManager RPC
            (wasi_host_spawn)                                    ├─ Shell script? (build.sh) ──> Script Bootstrap Mode
                     │                                           ├─ Clear? (clear) ──> Clear screen escape
                     ▼                                           └─ Builtin / Applet? (ls, cd) ──> Tier 2 ash
       RPC to Compiler / Runtime
```

#### Complete Command Invocation Taxonomy

| Invocation Category | Example Command | Execution Route | Environment Passed | Error Reporting Behavior |
|---|---|---|---|---|
| **1. Missing Command Fast-Path** | `aa.out`, `unknown_tool` | Direct terminal interception | N/A | Prints `aa.out: command not found` (code 127); zero `sh -c` invocation; zero line-number offset. |
| **2. Missing Path Fast-Path** | `./aa.out`, `../sub/missing` | Direct terminal interception | N/A | Prints `./aa.out: not found` (code 127); zero `sh -c` invocation. |
| **3. Direct Toolchain Utilities** | `gcc -Wall main.c`, `make -j4`, `ar rcs lib.a` | `CompilerClient` $\to$ `compiler.worker.js` | `effectiveEnviron` | Executed directly in dedicated compiler worker without `busybox.wasm` instantiation overhead. |
| **4. Direct WebAssembly Binaries** | `./a.out 10 20`, `/workspace/app.wasm` | `RuntimeManager` $\to$ `runtime.worker.js` | `effectiveEnviron` | Executed directly in dedicated runtime worker via `execHostCommandSync`. |
| **5. Direct Shell Scripts** | `./build.sh`, `sh build.sh`, `script.sh` | Script Bootstrap Mode (`runScriptFile`) | `effectiveEnviron` | Bootstrapped with guest CWD and `SCRIPT_PREAMBLE`; reports exact file-relative line numbers (`script.sh: line 3: ...`). |
| **6. Complex Shell Constructs** | `ls -la \| grep foo`, `cat a > b`, `cd dir` | Tier 2 (`busybox sh -c`) | `effectiveEnviron` | Evaluated by BusyBox `ash` with single-line preamble; ash line numbering starts at line 1. |
| **7. Shell Environment Mutations** | `export FOO="bar"`, `unset FOO`, `VAR=1` | State mutation in `shellEnviron` | Updated in-place | Updates persistent shell environment across subsequent command lines without spawning sub-processes. |

---

### 1.3 Process CWD & Working Directory Initialization in WASI Preview 1

In native operating systems, a spawned child process inherits the parent's current working directory (CWD) directly from the kernel process table (`task_struct->fs->pwd`). 

In **WASI Preview 1**, there is no kernel process table and no `fork()`. Every new WebAssembly instance (`busybox.wasm`) starts as a fresh guest runtime backed by `wasi-libc`:
- In `wasi-libc`, the internal C runtime's `getcwd()` state defaults to root (`"/"`) on instance startup.
- Even though `WasiHost` passes `PWD: "/workspace"` in the environment variables array (`environ`), `wasi-libc` **does not automatically call `chdir(getenv("PWD"))` on startup**.
- Consequently, if an instance runs without an initial `cd`, any C call to `getcwd()` or `opendir(".")` evaluates to `"/"`, causing sub-tools like `gcc src/main.c` to look for `/src/main.c` instead of `/workspace/src/main.c`.

**Solution**:
Every invocation of `busybox` running in directory context prepends an initial `cd "${cwd}"` as its first instruction, synchronizing `wasi-libc`'s CWD to the intended workspace directory before any user command or script line executes.

---

### 1.4 Script Execution & Accurate Line Number Preservation

When users run shell scripts (`./build.sh`, `sh build.sh`), wrapping the script with a multiline synthetic preamble distorts all syntax and runtime error diagnostics by shifting line counters (e.g. line 2 appearing as line 40).

To eliminate this distortion while ensuring the guest CWD is correctly initialized, `shell.worker.js` executes scripts via **Script Bootstrap Mode**:

```javascript
argv: [
  'busybox', 'sh', '-c',
  `cd "$1" || exit 1; shift; ${SCRIPT_PREAMBLE} . "$@"`,
  'sh', cwd, scriptPath, ...args
]
```

#### How Script Bootstrap Mode Operates:
1. **`cd "$1"`**: Changes the guest CWD to `cwd` (e.g. `/workspace`) on line 1 before the script is loaded.
2. **`shift`**: Removes the directory argument, restoring positional parameters (`$1`, `$2`, ...) to the script's user arguments.
3. **`${SCRIPT_PREAMBLE}`**: Inlines the single-line directory stack definitions (`pushd`, `popd`, `dirs`) into the script's shell memory.
4. **`. "$@"`**: Sources the script file directly from VFS. Because `ash` reads the script from its own file stream on disk:
   - Line 1 of `build.sh` is reported as **line 1**.
   - Line 5 of `build.sh` is reported as **line 5**.
   - Diagnostics output standard POSIX paths: `sh: /workspace/build.sh: line 5: <error>`.
   - Script exit codes (`exit 1`) are faithfully propagated to the caller.

---

### 1.5 Directory Stack Subsystem (`pushd`, `popd`, `dirs`): Theory & Implementation

BusyBox `ash` strictly implements the POSIX shell specification and does not include non-standard bash/zsh extensions like `pushd`, `popd`, and `dirs`.

#### Why Alternative Approaches Cannot Work in POSIX:
1. **Why not standalone `/bin/pushd` binaries?**
   In Unix, any standalone executable runs as a **child process**. If a child process calls `chdir("/workspace/src")`, its working directory changes, but as soon as the child process exits, the parent shell is **still in the original directory**. Working directory mutations must occur within the parent shell's process space.
2. **Why not aliases?**
   Aliases in POSIX `sh` are lexical text replacements that cannot accept positional arguments (`pushd <dir>`), are disabled in non-interactive scripts, and do not cross process boundaries.
3. **Why not environment variables?**
   POSIX `sh` does not support exported functions (`export -f`). The POSIX `$ENV` variable is explicitly ignored by non-interactive shell scripts to ensure script reproducibility.

#### Two-Tier Directory Stack Implementation:

1. **Interactive Prompt Commands**:
   `shell.worker.js` serializes the directory stack across commands using a single-line preamble:
   ```sh
   _DIR_STACK="${stack}"; _save_dstack() { __host_update_dstack "$_DIR_STACK"; }; \
   pushd() { if [ -z "$1" ]; then echo "pushd: no other directory" >&2; return 1; fi; _DIR_STACK="$(pwd)|${_DIR_STACK}"; _save_dstack; cd "$1" || return 1; dirs; }; \
   popd() { if [ -z "$_DIR_STACK" ]; then echo "popd: directory stack empty" >&2; return 1; fi; _TARGET="${_DIR_STACK%%|*}"; _DIR_STACK="${_DIR_STACK#*|}"; _save_dstack; cd "$_TARGET" || return 1; dirs; }; \
   dirs() { ... };
   ```
   - Directory stack state is saved back to JavaScript memory via `__host_update_dstack`.
   - Current directory changes are synced to the IDE file tree and prompt via `__host_update_pwd "$(pwd)"`.
   - All definitions reside on a single line (0 newlines) to avoid line-counter drift.

2. **Shell Scripts (`build.sh`)**:
   `SCRIPT_PREAMBLE` provides a local, self-contained directory stack within the script instance:
   - Scripts can call `pushd <dir>`, `popd`, and `dirs` freely.
   - Subcommands (`gcc`, `make`) executed inside `pushd` operate with CWD set to the target directory.
   - Adheres to standard Unix process isolation: directory changes made within a script do not alter the parent interactive shell prompt upon script completion.

---

### 1.6 Environment Variable Lifecycle & Tri-Worker Propagation

`shell.worker.js` maintains a persistent in-memory environment dictionary (`shellEnviron`):
- **Persistent Exports**: Commands like `export VAR="value"`, `export VAR`, or `unset VAR` mutate `shellEnviron` in-place, persisting across subsequent terminal lines.
- **Scoped Command Prefixes**: Invocations like `CFLAGS="-O2" make` or `VAR="scoped" ./a.out` extract temporary `envOverrides` into an `effectiveEnviron` dictionary passed exclusively to that command without polluting `shellEnviron`.
- **Worker Delivery**: Both `RuntimeManager` (`runtime.worker.js`) and `CompilerClient` (`compiler.worker.js`) receive `effectiveEnviron` on every RPC execution request and inject it directly into their respective `WasiHost` instances:
  - C/C++ user programs reading `getenv("VAR")` receive accurate values.
  - GNU Make recipes inspecting `$(CFLAGS)` or environment variables receive expected overrides.

---

### 1.7 Interrupt Handling (`Ctrl+C`)
When `Ctrl+C` (`\x03`) is received:
- If a foreground command or script is running, `shell.worker.js` marks `isInterrupted = true`, terminates the active sub-process, flushes stdout/stderr, clears pending RPC callbacks, and immediately re-emits the prompt.
- If at the interactive prompt, the current input buffer is cleared, `^C` is echoed, and a fresh prompt line is printed.

---

### 1.8 Synchronous Terminal Stdin Coordination & Interactive Commands
When commands reading from standard input (such as `cat > file`, `sh`, or `sqlite3`) run inside the shell worker:
- **SharedArrayBuffer Stdin Bridge**: When `fd_read` on stdin (fd 0) occurs in a sub-process, `shell.worker.js` requests input from the main thread via the `stdin_request` message protocol.
- **Terminal Keystroke Capture**: `main.js` transitions terminal input routing to the active shell stdin coordinator, capturing keyboard strokes, echoing them to `xterm.js`, and handling line editing (Backspace, Enter).
- **Line Delivery**: Upon pressing <kbd>Enter</kbd>, the encoded line (with `\n`) is copied into the shared buffer, and the waiting `fd_read` consumes it synchronously.
- **EOF Handling (<kbd>Ctrl-D</kbd>)**: Pressing <kbd>Ctrl-D</kbd> on an empty input line delivers `STATE_EOF` (`0` bytes read), signalling EOF cleanly to the command (e.g. Closing `cat > file` or exiting interactive shells).

---

### 1.9 POSIX Heredoc Parsing, Multi-Line Accumulation & Safe Delimiter Closure
- **Interactive Multi-Line Buffering**:
  When a shell command contains an unquoted or quoted heredoc (`<<DELIM`, `<<'DELIM'`, `<<-DELIM`), the shell detects the pending delimiter via `findHeredocs` and enters multi-line buffering mode instead of executing immediately.
- **Secondary Prompt (`PS2`)**:
  While heredocs or compound multi-line constructs remain unclosed, `shell.worker.js` displays the secondary continuation prompt (`> `). Each entered line is appended to `multiLineBuffer`.
- **Safe Delimiter Closure on Early EOF (<kbd>Ctrl-D</kbd>)**:
  If the user presses <kbd>Ctrl-D</kbd> without entering the terminating delimiter, `closePendingHeredocs()` synthesizes the terminating delimiter before appending the shell environment cleanup preamble (`__rc=$?; __host_update_pwd "$(pwd)"; exit $__rc`). This strictly prevents the trailing shell control commands from leaking into the unclosed heredoc body and corrupting user output.

---

## 2. Real GNU Make WASI Integration (`make-wasi`)

`wasm-c-ide` embeds real GNU Make 4.4.1 compiled targeting `wasm32-wasip1` (`make.wasm`) without mock interpreters:

### 2.1 Architecture & Execution Model
- **Executable Location**: Mounted at `/usr/bin/make` in the VFS.
- **Recipe Execution**: When `make` evaluates a rule recipe (e.g. `$(CC) -c main.c -o main.o`), it delegates execution through `makeBridge.runRecipe`.
- **Prerequisite Timestamp Checking**: Reads modification timestamps (`mtime`) directly from VFS nodes via `stat()`, avoiding redundant recompilation when target files are up to date.
- **Dual Build System**: Users can switch between a simple shell script (`build.sh`) and a standard `Makefile` via the Project Settings modal.

---

### 2.2 Workspace Directory Tree Synchronization (`createdDirs` / `deletedDirs`)

Because compilation and Make tasks execute off-thread inside `compiler.worker.js`, workspace file mutations must be synchronized back to the main thread's master VFS.

#### The Directory Synchronization Protocol:
1. **Snapshot Phase**: Before executing a toolchain command, `compiler.worker.js` captures a full snapshot of `/workspace`:
   - `fileMap`: Maps file paths to their modification timestamp (`mtime`) and byte length.
   - `dirSet`: Tracks all directory paths present in the workspace.
2. **Execution Phase**: GNU Make runs recipes, which may create directories (`mkdir -p build`), create object files (`gcc -c ...`), or delete targets and directories (`make clean` $\to$ `rm -rf build a.out`).
3. **Differential Phase**: `getWorkspaceDiff` compares current workspace state against `beforeSnapshot`:
   - `changedFiles`: New or modified files.
   - `deletedFiles`: Files present in `beforeSnapshot.fileMap` but absent now.
   - `createdDirs`: Directories present now but absent in `beforeSnapshot.dirSet`.
   - `deletedDirs`: Directories present in `beforeSnapshot.dirSet` but absent now.
4. **Master VFS Commit**: `compiler-client.js` in the main thread applies all changes:
   - Writes `changedFiles` to master VFS.
   - Creates `createdDirs` via `vfs.mkdir(dir, true, true)`.
   - Deletes `deletedFiles` and `deletedDirs` via `vfs.remove(path, true, true)`.
   - Triggers `fileTreeUI.render()` to immediately reflect directory removals (such as `build/` removed during `make clean`) in the IDE UI.

---

### 2.3 Recipe Parsing, Command Delegation & Wildcard Globbing

The `makeBridge.runRecipe` handler provides built-in emulation for standard shell recipes commonly used in Makefiles:
- **`rm` with Wildcard Globbing**: Handles both direct file/directory removals (`rm -rf build a.out`) and wildcard patterns (`rm -rf build/*`, `rm -f *.o`). Resolves target directories, evaluates regex matches, and removes matching nodes recursively.
- **`mkdir`**: Creates directory hierarchies (`mkdir -p build`) and touches directory `mtime`.
- **`touch`**: Creates empty files or advances timestamps on existing files.
- **`echo` with Redirections**: Handles stdout printing and file redirections (`echo "data" > file`, `echo "data" >> file`).
- **Toolchain Invocations**: Routes `gcc`, `g++`, `clang`, `clang++`, `ar`, and `wasm-ld` directly to synchronous toolchain drivers.

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
- **TTY Detection**: Emulates standard POSIX `isatty()` in `WasiHost` so `sqlite3` displays its interactive prompt (`sqlite> `) when stdin is attached to the terminal.
