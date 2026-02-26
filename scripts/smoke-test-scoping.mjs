#!/usr/bin/env node
/**
 * Smoke tests for data-scoping logic (Part A — no server needed).
 *
 * Validates normalization helpers, user access field normalization,
 * and FI access computation against the real fi_registry.json.
 *
 * Run:  node scripts/smoke-test-scoping.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeFiKey,
  canonicalInstance,
  normalizeInstanceKey,
  parseListParam,
  normalizeUserAccessFields,
  computeAllowedFis,
} from "../src/lib/scoping.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Load real registry ───────────────────────────────────────────────

const fiRegistry = JSON.parse(
  await fs.readFile(path.join(ROOT, "fi_registry.json"), "utf8")
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log("\n=== Data Scoping Smoke Tests ===\n");

// ── 1. Instance-scoped user sees only FIs from that instance ─────────

test("Instance-scoped user sees only FIs from that instance", () => {
  const user = {
    access_level: "limited",
    instance_keys: ["msu"],
    partner_keys: [],
    fi_keys: [],
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.ok(allowed instanceof Set, "should return a Set");
  assert.ok(allowed.size > 0, "should have at least one FI");

  // msufcu is on the msu instance
  assert.ok(allowed.has("msufcu"), "should include msufcu (msu instance)");

  // nasafcu is on ss01, not msu
  assert.ok(!allowed.has("nasafcu"), "should NOT include nasafcu (ss01 instance)");

  // Every allowed FI should be on the msu instance in the registry
  const msuFis = new Set(
    Object.values(fiRegistry)
      .filter((e) => e.instance === "msu")
      .map((e) => normalizeFiKey(e.fi_lookup_key))
  );
  for (const fi of allowed) {
    assert.ok(msuFis.has(fi), `${fi} should be on msu instance`);
  }
});

// ── 2. Partner-scoped user sees only FIs from that partner ───────────

test("Partner-scoped user sees only FIs from that partner", () => {
  const user = {
    access_level: "limited",
    instance_keys: [],
    partner_keys: ["Alkami"],
    fi_keys: [],
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.ok(allowed instanceof Set);
  assert.ok(allowed.size > 0);

  // nasafcu is Alkami
  assert.ok(allowed.has("nasafcu"), "should include nasafcu (Alkami partner)");

  // msufcu is MSU partner, not Alkami
  assert.ok(!allowed.has("msufcu"), "should NOT include msufcu (MSU partner)");
});

// ── 3. FI-scoped user sees exactly those FIs (the NASA bug) ──────────

test("FI-scoped user sees exactly those FIs (the NASA bug)", () => {
  const user = {
    access_level: "limited",
    instance_keys: [],
    partner_keys: [],
    fi_keys: ["nasafcu"],
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.ok(allowed instanceof Set);
  assert.equal(allowed.size, 1, "should have exactly 1 FI");
  assert.ok(allowed.has("nasafcu"), "should include nasafcu");
  assert.ok(!allowed.has("msufcu"), "should NOT include msufcu");
  assert.ok(!allowed.has("kembacu"), "should NOT include kembacu");
});

// ── 4. Multi-dimension user gets UNION of all three ──────────────────

test("Multi-dimension user gets UNION of all three", () => {
  const user = {
    access_level: "limited",
    instance_keys: ["msu"],           // adds msufcu, msu, default, etc.
    partner_keys: [],
    fi_keys: ["nasafcu"],             // adds nasafcu directly
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.ok(allowed instanceof Set);

  // Direct FI
  assert.ok(allowed.has("nasafcu"), "should include nasafcu (direct fi_key)");
  // Instance match
  assert.ok(allowed.has("msufcu"), "should include msufcu (msu instance)");
});

// ── 5. Empty-scoped user gets zero access ────────────────────────────

test("Empty-scoped user gets zero access", () => {
  const user = {
    access_level: "limited",
    instance_keys: [],
    partner_keys: [],
    fi_keys: [],
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.ok(allowed instanceof Set);
  assert.equal(allowed.size, 0, "should have zero FIs");
});

// ── 6. Admin user gets unrestricted (null) ───────────────────────────

test("Admin user gets unrestricted access (null)", () => {
  const user = {
    access_level: "admin",
    instance_keys: [],
    partner_keys: [],
    fi_keys: [],
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.equal(allowed, null, "admin should get null (unrestricted)");
});

// ── 7. Internal user gets unrestricted (null) ────────────────────────

test("Internal user gets unrestricted access (null)", () => {
  const user = {
    access_level: "internal",
    instance_keys: ["msu"],
    partner_keys: [],
    fi_keys: [],
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.equal(allowed, null, "internal should get null (unrestricted)");
});

// ── 8. Wildcard fi_keys = unrestricted ───────────────────────────────

test("Wildcard fi_keys means unrestricted access", () => {
  const user = {
    access_level: "limited",
    instance_keys: [],
    partner_keys: [],
    fi_keys: "*",
  };
  const allowed = computeAllowedFis(user, fiRegistry);
  assert.equal(allowed, null, "fi_keys=* should get null (unrestricted)");
});

// ── 9. normalizeUserAccessFields handles legacy full→admin ───────────

test("normalizeUserAccessFields handles legacy full→admin", () => {
  const result = normalizeUserAccessFields({
    access_level: "full",
    instance_keys: ["msu"],
    partner_keys: [],
    fi_keys: [],
  });
  assert.equal(result.access_level, "admin", "full should become admin");
  assert.deepEqual(result.instance_keys, ["msu"]);
});

// ── 10. normalizeUserAccessFields handles legacy fi_keys-only format ─

test("normalizeUserAccessFields handles legacy fi_keys-only format", () => {
  // Legacy user has fi_keys but no instance_keys/partner_keys fields at all
  const result = normalizeUserAccessFields({
    access_level: "limited",
    fi_keys: ["nasafcu"],
  });
  assert.equal(result.access_level, "limited");
  assert.deepEqual(result.instance_keys, [], "should default instance_keys to []");
  assert.deepEqual(result.partner_keys, [], "should default partner_keys to []");
  assert.deepEqual(result.fi_keys, ["nasafcu"], "should preserve fi_keys");

  // Legacy wildcard user
  const wildcard = normalizeUserAccessFields({
    access_level: "limited",
    fi_keys: "*",
  });
  assert.equal(wildcard.instance_keys, "*", "wildcard fi_keys should propagate to instance_keys");
  assert.equal(wildcard.partner_keys, "*", "wildcard fi_keys should propagate to partner_keys");
});

// ── Bonus: normalizer edge cases ─────────────────────────────────────

test("normalizeFiKey handles whitespace and casing", () => {
  assert.equal(normalizeFiKey("  NasaFCU  "), "nasafcu");
  assert.equal(normalizeFiKey(""), "");
  assert.equal(normalizeFiKey(null), "");
});

test("canonicalInstance strips non-alphanumeric chars", () => {
  assert.equal(canonicalInstance("msu-dev"), "msudev");
  assert.equal(canonicalInstance("SS01"), "ss01");
  assert.equal(canonicalInstance(""), "");
});

test("parseListParam handles CSV strings and arrays", () => {
  assert.deepEqual(parseListParam("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(parseListParam(["a", "b"]), ["a", "b"]);
  assert.deepEqual(parseListParam(""), []);
  assert.deepEqual(parseListParam(null), []);
  assert.deepEqual(parseListParam(["", null, "x"]), ["x"]);
});

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
