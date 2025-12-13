import fs from "node:fs";
import path from "node:path";

const RAW_ROOT = path.resolve("raw");

function writeFileAtomicSync(targetPath, contents) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmpPath = path.join(
    dir,
    `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  fs.writeFileSync(tmpPath, contents);
  fs.renameSync(tmpPath, targetPath);
}

export function ensureRawDirs() {
  for (const d of ["ga", "sessions", "placements"]) {
    fs.mkdirSync(path.join(RAW_ROOT, d), { recursive: true });
  }
}

export function rawPath(type, date) {
  return path.join(RAW_ROOT, type, `${date}.json`);
}

export function rawExists(type, date) {
  return fs.existsSync(rawPath(type, date));
}

export function writeRaw(type, date, obj, { atomic = true } = {}) {
  ensureRawDirs();
  const outPath = rawPath(type, date);
  const contents = JSON.stringify(obj, null, 2);
  if (atomic) {
    writeFileAtomicSync(outPath, contents);
  } else {
    fs.writeFileSync(outPath, contents);
  }
}

export function writeRawAtomic(type, date, obj) {
  return writeRaw(type, date, obj, { atomic: true });
}

export function readRaw(type, date) {
  const p = rawPath(type, date);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function deleteRaw(type, date) {
  const p = rawPath(type, date);
  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
