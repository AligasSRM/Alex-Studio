import path from "node:path";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateEntryName(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.includes("\0") || name.includes("\\")) {
    throw new Error("Invalid ZIP entry name");
  }
  const normalized = path.posix.normalize(name);
  if (normalized !== name || normalized.startsWith("/") ||
      normalized.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error("ZIP entry path traversal is not allowed");
  }
  return normalized;
}

/** Build a standards-compliant, UTF-8 ZIP using the store method (no compression). */
export function buildZip(entries: ZipEntry[]): Buffer {
  if (entries.length === 0) throw new Error("Cannot export an empty project");
  if (entries.length > MAX_ENTRIES) throw new Error("Project contains too many files to export");

  let totalBytes = 0;
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    const name = validateEntryName(entry.name);
    if (seen.has(name)) throw new Error("Duplicate ZIP entry name");
    seen.add(name);
    totalBytes += entry.data.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Project export exceeds the 50 MB limit");

    const nameBytes = Buffer.from(name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x21, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBytes);

    localOffset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
