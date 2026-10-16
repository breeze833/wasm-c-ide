// Built-in ar (archive) utility for creating and managing static libraries (.a)
// Generates standard !<arch>\n archives compatible with LLVM wasm-ld

/**
 * Reads an LEB128 unsigned integer from a byte array.
 */
function readVaruint(bytes, state) {
  let result = 0;
  let shift = 0;
  while (state.offset < bytes.length) {
    const b = bytes[state.offset++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return result >>> 0;
}

/**
 * Extracts defined, non-local symbols from a WebAssembly relocatable object (.o).
 * Inspects the "linking" custom section (subtype 8, WASM_SYMBOL_TABLE).
 */
export function extractSymbolsFromWasmObj(bytes) {
  if (!bytes || bytes.length < 8) return [];
  // Validate Wasm magic: \0asm\1\0\0\0
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    return [];
  }

  const state = { offset: 8 };
  const symbols = [];
  const decoder = new TextDecoder();

  while (state.offset < bytes.length) {
    const secId = bytes[state.offset++];
    const secLen = readVaruint(bytes, state);
    const end = state.offset + secLen;

    if (secId === 0) {
      // Custom section
      const nameLen = readVaruint(bytes, state);
      const name = decoder.decode(bytes.subarray(state.offset, state.offset + nameLen));
      state.offset += nameLen;

      if (name === 'linking') {
        readVaruint(bytes, state); // linking version
        while (state.offset < end) {
          const subId = bytes[state.offset++];
          const subLen = readVaruint(bytes, state);
          const subEnd = state.offset + subLen;

          if (subId === 8) {
            // WASM_SYMBOL_TABLE
            const count = readVaruint(bytes, state);
            for (let i = 0; i < count; i++) {
              if (state.offset >= subEnd) break;
              const kind = bytes[state.offset++];
              const flags = readVaruint(bytes, state);
              let symName = '';

              if (kind === 0) {
                // FUNCTION: index (varuint), name (if defined or explicit)
                readVaruint(bytes, state);
                if ((flags & 0x10) === 0 || (flags & 0x40) !== 0) {
                  const sLen = readVaruint(bytes, state);
                  symName = decoder.decode(bytes.subarray(state.offset, state.offset + sLen));
                  state.offset += sLen;
                }
              } else if (kind === 1) {
                // DATA: name, then if defined: index, offset, size
                const sLen = readVaruint(bytes, state);
                symName = decoder.decode(bytes.subarray(state.offset, state.offset + sLen));
                state.offset += sLen;
                if ((flags & 0x10) === 0) {
                  readVaruint(bytes, state); // index
                  readVaruint(bytes, state); // offset
                  readVaruint(bytes, state); // size
                }
              } else if (kind === 2) {
                // GLOBAL: index, name (if defined or explicit)
                readVaruint(bytes, state);
                if ((flags & 0x10) === 0 || (flags & 0x40) !== 0) {
                  const sLen = readVaruint(bytes, state);
                  symName = decoder.decode(bytes.subarray(state.offset, state.offset + sLen));
                  state.offset += sLen;
                }
              } else if (kind === 3) {
                // SECTION: section index
                readVaruint(bytes, state);
              } else if (kind === 4 || kind === 5) {
                // EVENT / TAG / TABLE
                readVaruint(bytes, state);
                if ((flags & 0x10) === 0 || (flags & 0x40) !== 0) {
                  const sLen = readVaruint(bytes, state);
                  symName = decoder.decode(bytes.subarray(state.offset, state.offset + sLen));
                  state.offset += sLen;
                }
              } else {
                state.offset = subEnd;
                break;
              }

              const isDefined = (flags & 0x10) === 0;
              const isLocal = (flags & 0x02) !== 0;
              if (isDefined && !isLocal && symName) {
                symbols.push(symName);
              }
            }
          }
          state.offset = subEnd;
        }
      }
    }
    state.offset = end;
  }

  return symbols;
}

/**
 * Parses an existing .a archive into its member files.
 */
export function parseArchive(archiveBytes) {
  if (!archiveBytes || archiveBytes.length < 8) {
    throw new Error('File format not recognized: archive too small');
  }

  const magic = new TextDecoder().decode(archiveBytes.subarray(0, 8));
  if (magic !== '!<arch>\n') {
    throw new Error('File format not recognized: invalid magic header');
  }

  const members = [];
  let longNamesStr = '';
  let offset = 8;
  const decoder = new TextDecoder();

  // First pass: locate long names table (//) if present
  while (offset + 60 <= archiveBytes.length) {
    const headerBytes = archiveBytes.subarray(offset, offset + 60);
    const rawName = decoder.decode(headerBytes.subarray(0, 16));
    const sizeStr = decoder.decode(headerBytes.subarray(48, 58)).trim();
    const size = parseInt(sizeStr, 10);
    if (isNaN(size) || size < 0) break;

    const dataStart = offset + 60;
    const dataEnd = dataStart + size;
    const trimmedName = rawName.trim();

    if (trimmedName === '//') {
      longNamesStr = decoder.decode(archiveBytes.subarray(dataStart, dataEnd));
    }

    offset = dataEnd + (size % 2 === 1 ? 1 : 0);
  }

  // Second pass: extract actual members
  offset = 8;
  while (offset + 60 <= archiveBytes.length) {
    const headerBytes = archiveBytes.subarray(offset, offset + 60);
    const rawName = decoder.decode(headerBytes.subarray(0, 16));
    const dateStr = decoder.decode(headerBytes.subarray(16, 28)).trim();
    const modeStr = decoder.decode(headerBytes.subarray(40, 48)).trim();
    const sizeStr = decoder.decode(headerBytes.subarray(48, 58)).trim();
    const size = parseInt(sizeStr, 10);
    if (isNaN(size) || size < 0) break;

    const dataStart = offset + 60;
    const dataEnd = dataStart + size;
    const data = archiveBytes.subarray(dataStart, dataEnd);
    const trimmedName = rawName.trim();

    if (trimmedName !== '/' && trimmedName !== '//') {
      let finalName = trimmedName;
      if (finalName.startsWith('/') && longNamesStr) {
        // GNU long name offset: /123
        const strOffset = parseInt(finalName.substring(1), 10);
        if (!isNaN(strOffset) && strOffset < longNamesStr.length) {
          const slashPos = longNamesStr.indexOf('/\n', strOffset);
          if (slashPos !== -1) {
            finalName = longNamesStr.substring(strOffset, slashPos);
          } else {
            const nullPos = longNamesStr.indexOf('\0', strOffset);
            finalName = nullPos !== -1 ? longNamesStr.substring(strOffset, nullPos) : longNamesStr.substring(strOffset);
          }
        }
      } else if (finalName.endsWith('/')) {
        finalName = finalName.slice(0, -1);
      }

      members.push({
        name: finalName,
        data,
        date: dateStr || '0',
        mode: modeStr || '644',
      });
    }

    offset = dataEnd + (size % 2 === 1 ? 1 : 0);
  }

  return members;
}

/**
 * Builds a compliant !<arch>\n archive containing a symbol table index (/)
 * and GNU long name table (//) if necessary.
 */
export function buildArchive(memberFiles) {
  const enc = new TextEncoder();

  // 1. Prepare member names & long names table if needed
  let needsLongNames = false;
  let longNamesPayload = '';
  const memberEntries = [];

  for (const m of memberFiles) {
    const name = m.name;
    let headerName = '';
    if (name.length > 15 || name.includes(' ')) {
      needsLongNames = true;
      const strOffset = enc.encode(longNamesPayload).length;
      longNamesPayload += `${name}/\n`;
      headerName = `/${strOffset}`;
    } else {
      headerName = name.endsWith('/') ? name : `${name}/`;
    }

    memberEntries.push({
      name,
      headerName,
      data: m.data instanceof Uint8Array ? m.data : new Uint8Array(m.data),
      date: m.date || '0',
      mode: m.mode || '644',
    });
  }

  const longNamesBytes = needsLongNames ? enc.encode(longNamesPayload) : null;
  const longNamesSize = longNamesBytes ? longNamesBytes.length : 0;

  // 2. Extract defined symbols from members
  const symbols = [];
  for (let i = 0; i < memberEntries.length; i++) {
    const entry = memberEntries[i];
    const syms = extractSymbolsFromWasmObj(entry.data);
    for (const s of syms) {
      symbols.push({ name: s, memberIndex: i });
    }
  }

  // 3. Build symbol table index (/)
  // Structure:
  // numSyms (uint32 BE, 4 bytes)
  // numSyms * uint32 BE member offsets (4 * numSyms bytes)
  // string table: symbol names null-terminated
  const numSyms = symbols.length;
  let strTableSize = 0;
  for (const s of symbols) {
    strTableSize += enc.encode(s.name).length + 1;
  }
  const symTableSize = 4 + 4 * numSyms + strTableSize;
  const symTableBuf = new Uint8Array(symTableSize);
  const symView = new DataView(symTableBuf.buffer);
  symView.setUint32(0, numSyms, false); // Big-Endian

  // 4. Calculate member file offsets
  // Offset layout:
  // 0: !<arch>\n (8 bytes)
  // 8: '/' header (60 bytes)
  // 68: symTableBuf (symTableSize bytes) + pad
  let currentOffset = 8 + 60 + symTableSize + (symTableSize % 2 === 1 ? 1 : 0);

  if (longNamesBytes) {
    currentOffset += 60 + longNamesSize + (longNamesSize % 2 === 1 ? 1 : 0);
  }

  const memberOffsets = new Array(memberEntries.length);
  for (let i = 0; i < memberEntries.length; i++) {
    memberOffsets[i] = currentOffset;
    const len = memberEntries[i].data.length;
    currentOffset += 60 + len + (len % 2 === 1 ? 1 : 0);
  }

  // 5. Populate symbol table offsets and string table
  let strWritePos = 4 + 4 * numSyms;
  for (let i = 0; i < numSyms; i++) {
    const s = symbols[i];
    const mOffset = memberOffsets[s.memberIndex];
    symView.setUint32(4 + i * 4, mOffset, false); // Big-Endian
    const encoded = enc.encode(s.name);
    symTableBuf.set(encoded, strWritePos);
    symTableBuf[strWritePos + encoded.length] = 0; // null-terminated
    strWritePos += encoded.length + 1;
  }

  // 6. Allocate archive buffer
  const totalArchiveSize = currentOffset;
  const archive = new Uint8Array(totalArchiveSize);
  archive.set(enc.encode('!<arch>\n'), 0);

  function write60ByteHeader(dstOffset, name, size, mode = '644') {
    let h = name.padEnd(16, ' ');
    h += '0           '; // modification date (12)
    h += '0     ';     // uid (6)
    h += '0     ';     // gid (6)
    const mStr = (name.trim() === '/' || name.trim() === '//') ? '0' : String(mode);
    h += mStr.padEnd(8, ' '); // mode (8)
    h += String(size).padEnd(10, ' '); // size (10)
    h += '`\n';         // trailer (2)
    archive.set(enc.encode(h), dstOffset);
  }

  let writePos = 8;

  // Write symbol table member /
  write60ByteHeader(writePos, '/', symTableSize, '0');
  writePos += 60;
  archive.set(symTableBuf, writePos);
  writePos += symTableSize;
  if (symTableSize % 2 === 1) {
    archive[writePos++] = 0x0a; // '\n'
  }

  // Write long names member // if present
  if (longNamesBytes) {
    write60ByteHeader(writePos, '//', longNamesSize, '0');
    writePos += 60;
    archive.set(longNamesBytes, writePos);
    writePos += longNamesSize;
    if (longNamesSize % 2 === 1) {
      archive[writePos++] = 0x0a; // '\n'
    }
  }

  // Write regular members
  for (let i = 0; i < memberEntries.length; i++) {
    const entry = memberEntries[i];
    write60ByteHeader(writePos, entry.headerName, entry.data.length, entry.mode);
    writePos += 60;
    archive.set(entry.data, writePos);
    writePos += entry.data.length;
    if (entry.data.length % 2 === 1) {
      archive[writePos++] = 0x0a; // '\n'
    }
  }

  return archive;
}

/**
 * Executes the ar command in the virtual environment.
 */
export async function executeArCommand({
  args = [],
  cwd = '/workspace',
  vfs,
  toolchain = null,
  write = console.log,
}) {
  if (args.length === 0) {
    write('ar: no operation specified\r\n');
    write('usage: ar [rcstxdqv] <archive> [member...]\r\n');
    return 1;
  }

  // Parse option string (may have leading '-' e.g. -rcs or rcs)
  let optIndex = 0;
  let options = args[optIndex].replace(/^-+/, '');
  if (!options) {
    write('ar: no operation specified\r\n');
    return 1;
  }

  const hasR = options.includes('r');
  const hasC = options.includes('c');
  const hasS = options.includes('s');
  const hasT = options.includes('t');
  const hasX = options.includes('x');
  const hasD = options.includes('d');
  const hasQ = options.includes('q');
  const hasV = options.includes('v');

  const archiveName = args[optIndex + 1];
  if (!archiveName) {
    write('ar: no archive specified\r\n');
    return 1;
  }

  const memberArgs = args.slice(optIndex + 2);

  const resolve = (p) => {
    if (!p) return '';
    if (p.startsWith('/')) return p;
    return `${cwd}/${p}`.replace(/\/+/g, '/');
  };

  const archivePath = resolve(archiveName);

  // Table of contents: ar t[v] <archive>
  if (hasT) {
    if (!vfs.exists(archivePath)) {
      write(`ar: ${archiveName}: No such file or directory\r\n`);
      return 1;
    }
    const archiveBytes = vfs.readFile(archivePath, false);
    let members;
    try {
      members = parseArchive(archiveBytes);
    } catch (err) {
      write(`ar: ${archiveName}: ${err.message}\r\n`);
      return 1;
    }

    const filterNames = new Set(memberArgs);
    for (const m of members) {
      if (filterNames.size > 0 && !filterNames.has(m.name)) continue;
      if (hasV) {
        write(`rw-r--r-- 0/0 ${String(m.data.length).padStart(6, ' ')} Jan  1 00:00 ${m.name}\r\n`);
      } else {
        write(`${m.name}\r\n`);
      }
    }
    return 0;
  }

  // Extraction: ar x[v] <archive> [members...]
  if (hasX) {
    if (!vfs.exists(archivePath)) {
      write(`ar: ${archiveName}: No such file or directory\r\n`);
      return 1;
    }
    const archiveBytes = vfs.readFile(archivePath, false);
    let members;
    try {
      members = parseArchive(archiveBytes);
    } catch (err) {
      write(`ar: ${archiveName}: ${err.message}\r\n`);
      return 1;
    }

    const filterNames = new Set(memberArgs);
    for (const m of members) {
      if (filterNames.size > 0 && !filterNames.has(m.name)) continue;
      const targetPath = resolve(m.name);
      vfs.writeFile(targetPath, m.data);
      if (toolchain && typeof toolchain.syncFileToMemfs === 'function') {
        await toolchain.syncFileToMemfs(targetPath, m.data);
      }
      if (hasV) {
        write(`x - ${m.name}\r\n`);
      }
    }
    return 0;
  }

  // Deletion: ar d <archive> [members...]
  if (hasD) {
    if (!vfs.exists(archivePath)) {
      write(`ar: ${archiveName}: No such file or directory\r\n`);
      return 1;
    }
    const archiveBytes = vfs.readFile(archivePath, false);
    let members;
    try {
      members = parseArchive(archiveBytes);
    } catch (err) {
      write(`ar: ${archiveName}: ${err.message}\r\n`);
      return 1;
    }

    const deleteSet = new Set(memberArgs.map(m => m.split('/').pop()));
    const remaining = members.filter(m => !deleteSet.has(m.name));
    const newArchiveBytes = buildArchive(remaining);
    vfs.writeFile(archivePath, newArchiveBytes);
    if (toolchain && typeof toolchain.syncFileToMemfs === 'function') {
      await toolchain.syncFileToMemfs(archivePath, newArchiveBytes);
    }
    return 0;
  }

  // Symbol table regeneration only: ar s <archive>
  if (hasS && !hasR && !hasQ) {
    if (!vfs.exists(archivePath)) {
      write(`ar: ${archiveName}: No such file or directory\r\n`);
      return 1;
    }
    const archiveBytes = vfs.readFile(archivePath, false);
    let members;
    try {
      members = parseArchive(archiveBytes);
    } catch (err) {
      write(`ar: ${archiveName}: ${err.message}\r\n`);
      return 1;
    }
    const newArchiveBytes = buildArchive(members);
    vfs.writeFile(archivePath, newArchiveBytes);
    if (toolchain && typeof toolchain.syncFileToMemfs === 'function') {
      await toolchain.syncFileToMemfs(archivePath, newArchiveBytes);
    }
    return 0;
  }

  // Replace / Insert / Create: ar r[c][s][v] <archive> [members...]
  // or Quick append: ar q[c][v] <archive> [members...]
  if (hasR || hasQ) {
    let existingMembers = [];
    if (vfs.exists(archivePath)) {
      try {
        const existingBytes = vfs.readFile(archivePath, false);
        existingMembers = parseArchive(existingBytes);
      } catch {
        existingMembers = [];
      }
    } else {
      if (!hasC) {
        write(`ar: creating ${archiveName}\r\n`);
      }
    }

    for (const memberPath of memberArgs) {
      const resolvedMemberPath = resolve(memberPath);
      if (!vfs.exists(resolvedMemberPath)) {
        write(`ar: ${memberPath}: No such file or directory\r\n`);
        return 1;
      }

      const memberData = vfs.readFile(resolvedMemberPath, false);
      const memberName = memberPath.split('/').pop();

      if (hasR) {
        const existingIndex = existingMembers.findIndex(m => m.name === memberName);
        if (existingIndex !== -1) {
          existingMembers[existingIndex] = {
            name: memberName,
            data: memberData,
            date: String(Math.floor(Date.now() / 1000)),
            mode: '644',
          };
          if (hasV) {
            write(`r - ${memberName}\r\n`);
          }
        } else {
          existingMembers.push({
            name: memberName,
            data: memberData,
            date: String(Math.floor(Date.now() / 1000)),
            mode: '644',
          });
          if (hasV) {
            write(`a - ${memberName}\r\n`);
          }
        }
      } else if (hasQ) {
        existingMembers.push({
          name: memberName,
          data: memberData,
          date: String(Math.floor(Date.now() / 1000)),
          mode: '644',
        });
        if (hasV) {
          write(`a - ${memberName}\r\n`);
        }
      }
    }

    const newArchive = buildArchive(existingMembers);
    vfs.writeFile(archivePath, newArchive);

    if (toolchain && typeof toolchain.syncFileToMemfs === 'function') {
      await toolchain.syncFileToMemfs(archivePath, newArchive);
    }

    return 0;
  }

  write(`ar: unsupported option '${options}'\r\n`);
  return 1;
}
