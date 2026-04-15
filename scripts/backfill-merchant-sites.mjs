#!/usr/bin/env node
// Backfill raw/merchant-sites/YYYY-MM-DD.json from a historical CSV.
// Expects tab-separated rows:
//   [0] "M-D-YYYY.H.m.s.ms-TZ"
//   [1] site id
//   [2] host
//   [3] name
//   [4] tags (JSON array string)
//   [5] tier
//   [6] (ignored)
//   [7] (ignored)
//   [8] full raw JSON site record
// For each day, picks the row whose hour is closest to 17:00 PT per site (alignment
// with the live 5pm PT snapshot), then writes a JSON file matching the live schema.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "raw", "merchant-sites");
const SRC = process.argv[2];
const START_DATE = process.argv[3] || "2025-01-01";
const END_DATE = process.argv[4] || new Date(Date.now() - 86400000).toISOString().slice(0, 10); // yesterday
const DRY_RUN = process.argv.includes("--dry-run");
// Dates before this boundary are written in slim mode (no per-site `raw` blob).
// Default: 2026-01-01 — recent data full-fat, older data slim.
const slimArg = process.argv.find((a) => a.startsWith("--slim-before="));
const SLIM_BEFORE = slimArg ? slimArg.split("=")[1] : "2026-01-01";

if (!SRC) {
  console.error("Usage: node backfill-merchant-sites.mjs <csv-path> [start YYYY-MM-DD] [end YYYY-MM-DD] [--dry-run]");
  process.exit(1);
}

const TARGET_HOUR = 17; // 5pm PT

function classifyStatus(tags = []) {
  const lower = tags.map((t) => String(t).toLowerCase());
  if (lower.some((t) => t.includes("down") || t.includes("disabled"))) return "down";
  if (lower.some((t) => t.includes("limited") || t.includes("beta") || t.includes("degraded"))) return "limited";
  if (lower.some((t) => t.includes("unrestricted") || t === "prod")) return "prod";
  return "unknown";
}

function parseTs(ts) {
  // "9-3-2024.15.28.4.802-PDT" or "4-15-2026.8.0.1.2-PDT"
  const m = ts.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\.(\d{1,2})\.(\d{1,2})\.(\d{1,2})\.\d+(-[A-Z]+)?$/);
  if (!m) return null;
  const [, mo, dy, yr, hr] = m;
  const date = `${yr}-${String(mo).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
  return { date, hour: parseInt(hr, 10) };
}

function unquote(s) {
  if (!s) return s;
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

function buildSnapshot(date, siteMap) {
  const slim = date < SLIM_BEFORE;
  const sites = [];
  for (const row of siteMap.values()) {
    let raw = {};
    try { raw = JSON.parse(row.rawJson); } catch { raw = {}; }
    const tags = Array.isArray(raw.tags) ? raw.tags : row.tags;
    const lower = tags.map((t) => String(t).toLowerCase());
    const entry = {
      id: row.id,
      name: raw.name || row.name,
      host: raw.host || row.host,
      tier: raw.tier != null ? raw.tier : row.tier,
      tags,
      status: classifyStatus(tags),
      is_demo: lower.some((t) => t.includes("demo")),
      is_synthetic: lower.some((t) => t.includes("synthetic")),
    };
    if (!slim) entry.raw = raw;
    sites.push(entry);
  }

  const summary = {
    by_status: { prod: 0, limited: 0, down: 0, unknown: 0 },
    by_tier: {},
    prod_by_tier: {},
    limited_by_tier: {},
    down_by_tier: {},
    excluded: { demo: 0, synthetic: 0 },
  };
  for (const s of sites) {
    summary.by_status[s.status] = (summary.by_status[s.status] || 0) + 1;
    const tk = s.tier == null ? "null" : String(s.tier);
    summary.by_tier[tk] = (summary.by_tier[tk] || 0) + 1;
    if (s.status === "prod") summary.prod_by_tier[tk] = (summary.prod_by_tier[tk] || 0) + 1;
    if (s.status === "limited") summary.limited_by_tier[tk] = (summary.limited_by_tier[tk] || 0) + 1;
    if (s.status === "down") summary.down_by_tier[tk] = (summary.down_by_tier[tk] || 0) + 1;
    if (s.is_demo) summary.excluded.demo += 1;
    if (s.is_synthetic) summary.excluded.synthetic += 1;
  }

  return {
    snapshot_date: date,
    fetched_at: `${date}T17:00:00-07:00`,
    snapshot_tz: "America/Los_Angeles",
    backfilled: true,
    slim,
    source: "strivve-snapshots-changelog.csv",
    count: sites.length,
    summary,
    sites,
  };
}

async function main() {
  if (!DRY_RUN) await fsp.mkdir(OUT_DIR, { recursive: true });

  const stream = fs.createReadStream(SRC, { encoding: "utf8", highWaterMark: 1 << 20 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let currentDate = null;
  let siteMap = new Map(); // siteId -> { hourDist, id, host, name, tags, tier, rawJson }
  let totalLines = 0;
  let keptDays = 0;
  let skippedDays = 0;
  const dailyCounts = [];

  async function flush() {
    if (!currentDate || siteMap.size === 0) return;
    if (currentDate < START_DATE || currentDate > END_DATE) {
      skippedDays++;
      siteMap = new Map();
      return;
    }
    const snap = buildSnapshot(currentDate, siteMap);
    const outPath = path.join(OUT_DIR, `${currentDate}.json`);
    if (!DRY_RUN) await fsp.writeFile(outPath, JSON.stringify(snap, null, 2));
    dailyCounts.push({ date: currentDate, count: snap.count, prod: snap.summary.by_status.prod, limited: snap.summary.by_status.limited, down: snap.summary.by_status.down });
    keptDays++;
    siteMap = new Map();
  }

  for await (const line of rl) {
    totalLines++;
    if (totalLines % 200000 === 0) process.stderr.write(`... ${totalLines.toLocaleString()} lines, kept=${keptDays}d\n`);

    const parts = line.split("\t");
    if (parts.length < 9) continue;

    const tsRaw = unquote(parts[0]);
    const parsed = parseTs(tsRaw);
    if (!parsed) continue;

    const { date, hour } = parsed;
    if (date !== currentDate) {
      await flush();
      currentDate = date;
    }

    // Quick range skip — still track day boundary
    if (date < START_DATE || date > END_DATE) continue;

    const hourDist = Math.abs(hour - TARGET_HOUR);
    const siteId = parseInt(parts[1], 10);
    if (!Number.isFinite(siteId)) continue;

    const existing = siteMap.get(siteId);
    if (existing && existing.hourDist <= hourDist) continue;

    let tags = [];
    try { tags = JSON.parse(unquote(parts[4])); } catch {}
    const tier = parts[5] === "" ? null : Number(parts[5]);

    siteMap.set(siteId, {
      hourDist,
      id: siteId,
      host: unquote(parts[2]),
      name: unquote(parts[3]),
      tags,
      tier: Number.isFinite(tier) ? tier : null,
      rawJson: unquote(parts[8]),
    });
  }
  await flush();

  console.error(`\nDone. Total lines: ${totalLines.toLocaleString()}`);
  console.error(`Days written: ${keptDays}, days skipped (out of range): ${skippedDays}`);
  console.error(`\nFirst 5 and last 5 written days:`);
  dailyCounts.slice(0, 5).forEach((d) => console.error(`  ${d.date}  total=${d.count}  prod=${d.prod}  limited=${d.limited}  down=${d.down}`));
  console.error("  ...");
  dailyCounts.slice(-5).forEach((d) => console.error(`  ${d.date}  total=${d.count}  prod=${d.prod}  limited=${d.limited}  down=${d.down}`));
}

main().catch((err) => { console.error(err); process.exit(1); });
