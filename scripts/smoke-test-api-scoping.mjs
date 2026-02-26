#!/usr/bin/env node
/**
 * Smoke tests for API-level data scoping (Part B — needs running server).
 *
 * Injects temporary test users + sessions, hits real API endpoints,
 * verifies data isolation, then cleans up in a finally block.
 *
 * Run:  node scripts/smoke-test-api-scoping.mjs [--base-url=http://localhost:8787]
 *
 * Prerequisites: server must be running at the specified base URL.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const USERS_FILE = path.join(ROOT, "secrets", "users.json");
const SESSIONS_FILE = path.join(ROOT, "secrets", "sessions.json");

// ── Config ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const baseUrlArg = args.find((a) => a.startsWith("--base-url="));
const BASE_URL = baseUrlArg ? baseUrlArg.split("=")[1] : "http://localhost:8787";

const TEST_PREFIX = "__test_scoping_";
const TEST_EMAIL_A = `${TEST_PREFIX}instance@test.invalid`;
const TEST_EMAIL_B = `${TEST_PREFIX}fikey@test.invalid`;
const TEST_TOKEN_A = `sess_${TEST_PREFIX}a_${crypto.randomBytes(8).toString("hex")}`;
const TEST_TOKEN_B = `sess_${TEST_PREFIX}b_${crypto.randomBytes(8).toString("hex")}`;

// User A: instance-scoped to "msu" — should only see msu FIs
const TEST_USER_A = {
  email: TEST_EMAIL_A,
  name: "Test User A (msu instance)",
  access_level: "limited",
  instance_keys: ["msu"],
  partner_keys: [],
  fi_keys: [],
  enabled: true,
};

// User B: fi-scoped to nasafcu — should only see nasafcu (mirrors real bug)
const TEST_USER_B = {
  email: TEST_EMAIL_B,
  name: "Test User B (nasafcu only)",
  access_level: "limited",
  instance_keys: [],
  partner_keys: [],
  fi_keys: ["nasafcu"],
  enabled: true,
};

const SESSION_EXPIRY = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

// ── Helpers ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let warnings = 0;

function test(name, fn) {
  return fn()
    .then(() => {
      passed++;
      console.log(`  \u2713 ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  \u2717 ${name}`);
      console.error(`    ${err.message}`);
    });
}

function warn(name, message) {
  warnings++;
  console.log(`  \u26A0 ${name}: ${message}`);
}

async function api(method, endpoint, token, body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { Authorization: `Bearer ${token}` };
  const opts = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  return { status: res.status, data };
}

// ── Inject / Cleanup ─────────────────────────────────────────────────

let usersBackup = null;
let sessionsBackup = null;

async function inject() {
  // Backup originals
  usersBackup = await fs.readFile(USERS_FILE, "utf8");
  sessionsBackup = await fs.readFile(SESSIONS_FILE, "utf8");

  // Inject test users
  const usersData = JSON.parse(usersBackup);
  usersData.users = usersData.users.filter((u) => !u.email.startsWith(TEST_PREFIX));
  usersData.users.push(TEST_USER_A, TEST_USER_B);
  await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2), "utf8");

  // Inject test sessions
  const sessionsData = JSON.parse(sessionsBackup);
  sessionsData.sessions = sessionsData.sessions || {};
  sessionsData.sessions[TEST_TOKEN_A] = {
    email: TEST_EMAIL_A,
    created_at: new Date().toISOString(),
    expires_at: SESSION_EXPIRY,
    last_used_at: new Date().toISOString(),
    user_agent: "smoke-test",
  };
  sessionsData.sessions[TEST_TOKEN_B] = {
    email: TEST_EMAIL_B,
    created_at: new Date().toISOString(),
    expires_at: SESSION_EXPIRY,
    last_used_at: new Date().toISOString(),
    user_agent: "smoke-test",
  };
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessionsData, null, 2), "utf8");

  console.log("  Injected test users and sessions");
}

async function cleanup() {
  // Restore originals from backup
  if (usersBackup !== null) {
    await fs.writeFile(USERS_FILE, usersBackup, "utf8");
  }
  if (sessionsBackup !== null) {
    await fs.writeFile(SESSIONS_FILE, sessionsBackup, "utf8");
  }
  console.log("  Cleaned up test users and sessions");
}

// ── Known good FI sets (from fi_registry.json) ───────────────────────

// FIs on the msu instance
const MSU_FIS = new Set(["default", "draft", "msu", "msufcu", "unknown_fi"]);

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== API Scoping Smoke Tests ===`);
  console.log(`  Base URL: ${BASE_URL}\n`);

  // Quick connectivity check
  try {
    const res = await fetch(`${BASE_URL}/api/filter-options`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN_A}` },
    });
    if (res.status === 502 || res.status === 503) {
      console.error("  Server appears to be down. Start the server first.");
      process.exit(1);
    }
  } catch (err) {
    console.error(`  Cannot connect to ${BASE_URL}: ${err.message}`);
    console.error("  Start the server first: node scripts/serve-funnel.mjs");
    process.exit(1);
  }

  await inject();
  console.log();

  // Date range that's likely to have data (last 30 days)
  const dateTo = new Date().toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // ── Test 1: filter-options scoping for User A (instance-scoped) ──

  await test("filter-options: User A sees only msu-instance FIs", async () => {
    const { status, data } = await api("GET", "/api/filter-options", TEST_TOKEN_A);
    if (status !== 200) throw new Error(`Expected 200, got ${status}: ${JSON.stringify(data)}`);

    const fiKeys = new Set(data.fis.map((f) => f.key));
    // Must include msufcu
    if (!fiKeys.has("msufcu")) throw new Error("Missing msufcu in filter options");
    // Must NOT include nasafcu (different instance)
    if (fiKeys.has("nasafcu")) throw new Error("nasafcu leaked into msu-scoped user's filter options");
    // All returned FIs should be from msu instance
    for (const fi of data.fis) {
      if (fi.instance !== "msu") {
        throw new Error(`FI ${fi.key} has instance=${fi.instance}, expected msu`);
      }
    }
  });

  // ── Test 2: filter-options scoping for User B (fi-scoped) ────────

  await test("filter-options: User B sees only nasafcu", async () => {
    const { status, data } = await api("GET", "/api/filter-options", TEST_TOKEN_B);
    if (status !== 200) throw new Error(`Expected 200, got ${status}: ${JSON.stringify(data)}`);

    const fiKeys = new Set(data.fis.map((f) => f.key));
    if (!fiKeys.has("nasafcu")) throw new Error("Missing nasafcu in filter options");
    if (fiKeys.size !== 1) throw new Error(`Expected exactly 1 FI, got ${fiKeys.size}: [${[...fiKeys]}]`);
  });

  // ── Test 3: funnel data scoping for User A ───────────────────────

  await test("funnel: User A data contains only msu-instance FIs", async () => {
    const { status, data } = await api("POST", "/api/metrics/funnel", TEST_TOKEN_A, {
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (status !== 200) throw new Error(`Expected 200, got ${status}: ${JSON.stringify(data)}`);

    const byFi = data.by_fi || [];
    for (const entry of byFi) {
      if (!MSU_FIS.has(entry.fi_lookup_key)) {
        throw new Error(`Leaked FI in funnel data: ${entry.fi_lookup_key} (not an msu-instance FI)`);
      }
    }
  });

  // ── Test 4: funnel data scoping for User B ───────────────────────

  await test("funnel: User B data contains only nasafcu", async () => {
    const { status, data } = await api("POST", "/api/metrics/funnel", TEST_TOKEN_B, {
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (status !== 200) throw new Error(`Expected 200, got ${status}: ${JSON.stringify(data)}`);

    const byFi = data.by_fi || [];
    for (const entry of byFi) {
      if (entry.fi_lookup_key !== "nasafcu") {
        throw new Error(`Leaked FI in funnel data: ${entry.fi_lookup_key} (expected only nasafcu)`);
      }
    }
  });

  // ── Test 5: Cross-user isolation ─────────────────────────────────

  await test("Cross-user isolation: User A sees zero of User B's FIs", async () => {
    const { data } = await api("GET", "/api/filter-options", TEST_TOKEN_A);
    const fiKeys = new Set((data.fis || []).map((f) => f.key));
    if (fiKeys.has("nasafcu")) {
      throw new Error("User A can see nasafcu (User B's FI) — cross-user leakage!");
    }
  });

  await test("Cross-user isolation: User B sees zero of User A's FIs", async () => {
    const { data } = await api("GET", "/api/filter-options", TEST_TOKEN_B);
    const fiKeys = new Set((data.fis || []).map((f) => f.key));
    for (const msuFi of MSU_FIS) {
      if (msuFi === "default" || msuFi === "unknown_fi") continue; // these exist on multiple instances
      if (fiKeys.has(msuFi)) {
        throw new Error(`User B can see ${msuFi} (User A's FI) — cross-user leakage!`);
      }
    }
  });

  // ── Advisory warnings for unscoped endpoints ─────────────────────

  console.log("\n  --- Advisory (non-failing) ---");

  try {
    const { status } = await api("GET", "/api/metrics/ops-feed?limit=1", TEST_TOKEN_A);
    if (status === 200) {
      warn("ops-feed", "Responds 200 for limited user — verify scoping is adequate for your needs");
    } else if (status === 403) {
      console.log("  \u2713 ops-feed: correctly restricts limited users (403)");
    }
  } catch (err) {
    warn("ops-feed", `Could not check: ${err.message}`);
  }

  try {
    const { status } = await api("GET", "/api/traffic-health", TEST_TOKEN_A);
    if (status === 200) {
      warn("traffic-health", "Responds 200 for limited user — verify scoping is adequate for your needs");
    } else if (status === 403) {
      console.log("  \u2713 traffic-health: correctly restricts limited users (403)");
    }
  } catch (err) {
    warn("traffic-health", `Could not check: ${err.message}`);
  }
}

// ── Run with cleanup ─────────────────────────────────────────────────

try {
  await main();
} finally {
  console.log();
  await cleanup();
}

console.log(`\n${passed} passed, ${failed} failed, ${warnings} warnings\n`);

if (failed > 0) {
  process.exit(1);
}
