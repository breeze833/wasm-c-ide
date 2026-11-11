# Architectural Specification: Shared Read-Only Sysroot (`SharedSysroot`) & Two-Tier Overlay VFS

This document details the architectural specification, binary format, and runtime protocols for the **Shared Read-Only Sysroot (`SharedSysroot`)** and the **Two-Tier Overlay Virtual File System (VFS)** in `wasm-c-ide`.

---

## 1. Architectural Motivation & Problem Statement

In previous versions of `wasm-c-ide`, standard C/C++ sysroot headers and static runtime libraries (`sysroot.tar.gz`, ~108 MB decompressed) were unpacked directly into individual JavaScript objects within the mutable master VFS. 

When multi-worker concurrency was introduced (Tri-Worker architecture: `compiler.worker.js`, `shell.worker.js`, and `runtime.worker.js`):
1. **Redundant Heap Duplication**: Unpacking ~4,300 files into each worker's private VFS heap consumed ~108 MB of JavaScript heap *per worker* (~324 MB combined).
2. **Slow Boot & Tar Extraction**: Every worker had to independently fetch, decompress, and parse `sysroot.tar.gz`, incurring significant CPU delay and browser main thread blocking during initialization.
3. **Missing Header Blind Spots in Shell**: To avoid excessive memory in the shell worker, only a minimal subset of headers was mounted, preventing students from inspecting internal headers (e.g. `<stddef.h>`, `<dirent.h>`, `<sys/stat.h>`, `<include/wasm32-wasip1/__struct_timespec.h>`) via shell commands (`cat`, `grep`, `ls`).
4. **Vulnerable System Files**: If user code or shell commands wrote to system directories (`/usr/include`, `/lib`), system files could be corrupted in memory.

---

## 2. SharedSysroot Binary Format Specification (`SSYS`)

The `SharedSysroot` is a contiguous, memory-mapped byte buffer stored in a `SharedArrayBuffer` (with fallback to an `ArrayBuffer` in environments without cross-origin isolation headers).

### 2.1 File Layout

```
+-----------------------------------------------------------------------+
| Header (32 bytes)                                                     |
| Magic (0x53535953) | Version | Count | StrTableOff | StrTableSize ... |
+-----------------------------------------------------------------------+
| Index Table (Count * 32 bytes)                                        |
| [Hash, StrOff, StrLen, DataOff, DataLen, Mode, Mtime, IsDir] x N      |
+-----------------------------------------------------------------------+
| String Table (Aligned to 8 bytes)                                     |
| "/usr\0/usr/include\0/usr/include/stdio.h\0..."                       |
+-----------------------------------------------------------------------+
| Data Segment (Contiguous File Payloads, 4-byte Aligned)              |
| [Raw File Bytes for libc.a, libraylib.a, stdio.h, etc.]               |
+-----------------------------------------------------------------------+
```

### 2.2 Header Layout (32 Bytes, Little-Endian)

| Offset | Type | Field | Description |
|---|---|---|---|
| `0x00` | `uint32` | `magic` | Magic signature `0x53535953` (`SSYS`) |
| `0x04` | `uint32` | `version` | Format version (currently `1`) |
| `0x08` | `uint32` | `count` | Total number of entries (files and directories) |
| `0x0C` | `uint32` | `stringTableOffset` | Byte offset from buffer start to string table |
| `0x10` | `uint32` | `stringTableSize` | Total byte size of string table (raw bytes) |
| `0x14` | `uint32` | `dataSegmentOffset` | Byte offset from buffer start to data segment |
| `0x18` | `uint32` | `dataSegmentSize` | Total byte size of data segment |
| `0x1C` | `uint32` | `totalBufferSize` | Total allocated byte size of the buffer |

### 2.3 Index Entry Layout (32 Bytes, Little-Endian)

Each file and directory in the sysroot occupies an invariant 32-byte record:

| Offset | Type | Field | Description |
|---|---|---|---|
| `0x00` | `uint32` | `hash` | 32-bit FNV-1a hash of the normalized path |
| `0x04` | `uint32` | `strOffset` | Byte offset of path within the string table |
| `0x08` | `uint32` | `strLen` | Byte length of path UTF-8 string |
| `0x0C` | `uint32` | `dataOffset` | Byte offset of file payload within data segment |
| `0x10` | `uint32` | `dataLen` | Byte length of file payload (0 for directories) |
| `0x14` | `uint32` | `mode` | POSIX file mode (e.g. `0o040555` for dirs, `0o100444` for files) |
| `0x18` | `uint32` | `mtimeSec` | Modification timestamp in seconds |
| `0x1C` | `uint32` | `isDir` | Directory flag (`1` for directory, `0` for file) |

### 2.4 FNV-1a Path Hashing Algorithm

Paths are hashed using 32-bit FNV-1a:
```javascript
export function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
```

---

## 3. Zero-Copy Reader & Safe UTF-8 Decoding

`SharedSysrootReader` (`src/vfs/shared-sysroot.js`) encapsulates lookups and extraction over the buffer.

### 3.1 Zero-Copy TypedArray Slices
When a file is queried as a binary buffer (`readFile(path, asText = false)`), `SharedSysrootReader` returns a `Uint8Array` view pointing directly to the contiguous data segment:
```javascript
const start = this.dataSegmentOffset + entry.dataOffset;
return this.u8.subarray(start, start + entry.dataLength);
```
No memory is cloned or re-allocated; multiple workers read directly from the same shared memory.

### 3.2 Browser `TextDecoder` SharedArrayBuffer Safeguard
Under the W3C Web Encoding Specification, browsers strictly forbid passing `SharedArrayBuffer` views directly to `TextDecoder.prototype.decode()` to avoid concurrent modification races during string decoding:
> *TypeError: Failed to execute 'decode' on 'TextDecoder': The provided ArrayBufferView value must not be shared.*

To guarantee 100% compliance across all browsers:
1. **String Table Index Parsing**: In `_parseIndex()`, the entire string table (~150 KB) is copied into a single unshared `Uint8Array` once, and path slices are decoded from this unshared buffer.
2. **Text File Reads**: In `readFile(path, asText = true)` and `VFS.prototype.readFile(path, true)`, if the underlying buffer is an instance of `SharedArrayBuffer`, an unshared copy is created before invoking `TextDecoder.decode()`.

---

## 4. Two-Tier Overlay VFS Routing & Permissions

The virtual filesystem exposes a unified namespace through two distinct tiers:

```
+-----------------------------------------------------------------+
|                       VFS / WasiHost Path                       |
+-----------------------------------------------------------------+
                                |
               +----------------+----------------+
               |                                 |
        Under /workspace                   Under /usr, /include,
        (Top Tier - Mutable)               /lib, /bin (Bottom Tier)
               |                                 |
               v                                 v
      +-----------------+              +-------------------+
      | Local JS Nodes  |              | SharedSysroot     |
      | (Read-Write)    |              | (Read-Only)       |
      | - Map storage   |              | - Zero-copy SAB   |
      | - Two-way diff  |              | - Fast hash index |
      +-----------------+              +-------------------+
```

### 4.1 Lookup Order & Directory Unioning
- **Lookups (`readFile`, `exists`, `stat`, `isDir`)**: Lookups check local mutable nodes first. If absent, they fall back to the bottom-tier `SharedSysroot`.
- **Directory Listing (`readDir`, `fd_readdir`)**: Directory enumeration seamlessly unions local mutable nodes with `SharedSysroot` children, deduplicating identical entry names and sorting directories first.

### 4.2 Strict POSIX Permission Enforcement (`EROFS`)
Any attempt to modify files or directories within system paths (`/usr`, `/include`, `/lib`, `/bin`) is intercepted at the host layer:
- `path_open` with write flags (`WASI_O_CREAT`, `WASI_O_TRUNC`, `WASI_FDFLAG_APPEND`, or write capability) returns `EROFS` (65).
- `path_unlink_file`, `path_remove_directory`, and `path_create_directory` return `EROFS` (65).
- `path_rename` returns `EROFS` if either source or destination path resides in system directories.
- In-memory `VFS.prototype.writeFile` and `mkdir` throw `EROFS: read-only file system` unless invoked with internal flag `isSystem = true`.

---

## 5. Tri-Worker Topology & Broadcast Protocol

```
+-------------------------------------------------------------------------+
|                        Browser Main Thread (main.js)                    |
|  - Fetches & decompresses sysroot.tar.gz once                           |
|  - Preloads runtime libraries (libraylib.a, libturtle.a, libsqlite3.a)  |
|  - Builds SharedSysroot inside SharedArrayBuffer (~108 MB)              |
|  - Mounts SharedSysrootReader to master VFS                             |
+--------------------+---------------------+--------------------+---------+
                     |                     |                    |
        postMessage  |        postMessage  |       postMessage  |
    (sharedSysroot)  |    (sharedSysroot)  |   (sharedSysroot)  |
                     v                     v                    v
      +--------------------+ +--------------------+ +---------------------+
      | compiler.worker.js | | shell.worker.js    | | runtime.worker.js   |
      | - clang, wasm-ld   | | - busybox ash      | | - user a.out        |
      | - 0ms sysroot init | | - full header view | | - preopen fd 3 & 4  |
      | - Zero heap dup    | | - Zero heap dup    | | - EROFS protection  |
      +--------------------+ +--------------------+ +---------------------+
```

1. **Master Initialization**: `src/main.js` calls `loadOrBuildSharedSysroot(wasmBasePath, onProgress)` during bootup and mounts the buffer to `this.vfs`.
2. **Compiler Worker**: Receives `sharedSysrootBuffer` in `init` message, mounts `vfs.setSharedSysroot(buf)`, and initializes `WasmToolchain` instantly without re-fetching or parsing `sysroot.tar.gz`.
3. **Shell Worker**: Receives `sharedSysrootBuffer` in `init` message and mounts `vfs.setSharedSysroot(buf)`. Commands like `cat /include/wasm32-wasip1/stdio.h` or `ls /usr/include` work immediately.
4. **Runtime Worker**: Receives `sharedSysrootBuffer` upon program execution (`runBinary`), mounting `vfs.setSharedSysroot(buf)` and preopening `fd 3` (`/workspace`) and `fd 4` (`/`). User C/C++ code can read system files with zero runtime overhead while modifications are confined strictly to `/workspace`.
