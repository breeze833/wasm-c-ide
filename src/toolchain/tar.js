// Tar reader for unpacking sysroot.tar

function readStr(u8, offset, len = -1) {
  let str = '';
  const end = len !== -1 ? offset + len : u8.length;
  for (let i = offset; i < end && u8[i] !== 0; ++i) {
    str += String.fromCharCode(u8[i]);
  }
  return str;
}

export class Tar {
  constructor(buffer) {
    this.u8 = new Uint8Array(buffer);
    this.offset = 0;
  }

  readStr(len) {
    const result = readStr(this.u8, this.offset, len);
    this.offset += len;
    return result;
  }

  readOctal(len) {
    const s = this.readStr(len).trim();
    return s.length > 0 ? parseInt(s, 8) : 0;
  }

  alignUp() {
    this.offset = (this.offset + 511) & ~511;
  }

  readEntry() {
    if (this.offset + 512 > this.u8.length) {
      return null;
    }

    const startOffset = this.offset;
    const filename = this.readStr(100);
    if (!filename) return null;

    const mode = this.readOctal(8);
    const owner = this.readOctal(8);
    const group = this.readOctal(8);
    const size = this.readOctal(12);
    const mtim = this.readOctal(12);
    const checksum = this.readOctal(8);
    const type = this.readStr(1);
    const linkname = this.readStr(100);
    const magic = this.readStr(8);

    const ownerName = this.readStr(32);
    const groupName = this.readStr(32);
    const devMajor = this.readStr(8);
    const devMinor = this.readStr(8);
    const filenamePrefix = this.readStr(155);

    this.offset = startOffset + 512;

    const fullFilename = filenamePrefix ? `${filenamePrefix}/${filename}` : filename;
    const entry = {
      filename: fullFilename,
      size,
      type: type || '0',
    };

    if (entry.type === '0' || entry.type === '') {
      // Regular file
      entry.contents = this.u8.subarray(this.offset, this.offset + entry.size);
      this.offset += entry.size;
      this.alignUp();
    } else {
      // Directory or other
      this.alignUp();
    }

    return entry;
  }

  getEntries() {
    const entries = [];
    let entry;
    while ((entry = this.readEntry())) {
      entries.push(entry);
    }
    return entries;
  }
}
