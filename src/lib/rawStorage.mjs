import fs from "node:fs";
import path from "node:path";

const RAW_ROOT = path.resolve("raw");

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

export function writeRaw(type, date, obj) {
  ensureRawDirs();
  fs.writeFileSync(rawPath(type, date), JSON.stringify(obj, null, 2));
}

export function readRaw(type, date) {
  const p = rawPath(type, date);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
