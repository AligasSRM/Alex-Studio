import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

const MAX_FILES = 10000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const EXCLUDED_DIRS = new Set(['.git', '.alex', 'node_modules']);
const SENSITIVE_NAME = /^(?:\.env(?:\..*)?|credentials(?:[-_.].*)?|id_rsa(?:\..*)?|id_ed25519(?:\..*)?|secrets?(?:[-_.].*)?)$/i;

function isSensitiveName(name: string) {
  return name.startsWith('.') || EXCLUDED_DIRS.has(name) || SENSITIVE_NAME.test(name);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type ZipEntry = { name: string; data: Buffer; crc: number; compressed: Buffer; time: number; date: number; offset: number };

export function createProjectZip(projectDirectory: string): Buffer {
  const root = path.resolve(projectDirectory);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Project root must be a real directory');
  const realRoot = fs.realpathSync.native(root);
  const files: { name: string; absolute: string }[] = [];

  function walk(directory: string, relative = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (isSensitiveName(item.name) || item.isSymbolicLink()) continue;
      const absolute = path.join(directory, item.name);
      const name = relative ? relative + '/' + item.name : item.name;
      if (item.isDirectory()) walk(absolute, name);
      else if (item.isFile()) {
        files.push({ name, absolute });
        if (files.length > MAX_FILES) throw new Error('Project contains too many files to export');
      }
    }
  }

  walk(root);
  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const stat = fs.lstatSync(file.absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const realFile = fs.realpathSync.native(file.absolute);
    const relativeReal = path.relative(realRoot, realFile);
    if (!relativeReal || relativeReal.startsWith('..') || path.isAbsolute(relativeReal)) {
      throw new Error('Project file escaped the project directory');
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Project exceeds the 50 MiB export limit');
    const data = fs.readFileSync(file.absolute);
    const stamp = dosDateTime(stat.mtime);
    entries.push({
      name: file.name.replace(/\\/g, '/'),
      data,
      crc: crc32(data),
      compressed: deflateRawSync(data, { level: 6 }),
      time: stamp.time,
      date: stamp.date,
      offset: 0,
    });
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    if (name.length > 65535 || entry.data.length > 0xffffffff || entry.compressed.length > 0xffffffff) {
      throw new Error('Project contains a file too large for ZIP export');
    }
    entry.offset = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(entry.time, 10);
    local.writeUInt16LE(entry.date, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.compressed);
    offset += local.length + name.length + entry.compressed.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(entry.time, 12);
    central.writeUInt16LE(entry.date, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(entry.offset, 42);
    centralParts.push(central, name);
  }

  if (entries.length > 65535) throw new Error('Project contains too many files to export');
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
