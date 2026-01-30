#!/usr/bin/env node
/**
 * Migration script for enhanced access control
 *
 * This script migrates users.json from the old format (fi_keys only) to the new format
 * (instance_keys, partner_keys, fi_keys) and renames "full" access_level to "admin".
 *
 * Usage:
 *   node scripts/migrate-users-access.mjs           # Dry-run mode (shows what would change)
 *   node scripts/migrate-users-access.mjs --apply   # Actually apply the changes
 */

import fs from "fs/promises";
import path from "path";

const USERS_FILE = path.join(process.cwd(), "secrets", "users.json");
const DRY_RUN = !process.argv.includes("--apply");

async function migrate() {
  console.log("=== User Access Migration Script ===\n");
  console.log(DRY_RUN ? "DRY RUN MODE (use --apply to save changes)\n" : "APPLYING CHANGES\n");

  // Read current users file
  let raw;
  try {
    raw = await fs.readFile(USERS_FILE, "utf8");
  } catch (err) {
    console.error("Failed to read users file:", err.message);
    process.exit(1);
  }

  const data = JSON.parse(raw);
  const users = data.users || [];

  console.log(`Found ${users.length} users to process\n`);

  const migrated = users.map((user, idx) => {
    const changes = [];
    const newUser = { ...user };

    // 1. Rename "full" to "admin"
    if (user.access_level === "full") {
      newUser.access_level = "admin";
      changes.push('access_level: "full" -> "admin"');
    }

    // 2. Handle fi_keys -> instance_keys, partner_keys, fi_keys
    const hasInstanceKeys = user.instance_keys !== undefined;
    const hasPartnerKeys = user.partner_keys !== undefined;

    if (!hasInstanceKeys && !hasPartnerKeys) {
      // Legacy user: only has fi_keys
      if (user.fi_keys === "*") {
        // Full access user
        newUser.instance_keys = "*";
        newUser.partner_keys = "*";
        newUser.fi_keys = "*";
        changes.push('fi_keys: "*" -> instance_keys: "*", partner_keys: "*", fi_keys: "*"');
      } else if (Array.isArray(user.fi_keys) && user.fi_keys.length > 0) {
        // Specific FI access - keep fi_keys, add empty arrays for new fields
        newUser.instance_keys = [];
        newUser.partner_keys = [];
        changes.push(`added instance_keys: [], partner_keys: [] (keeping fi_keys: [${user.fi_keys.length} items])`);
      } else {
        // Unknown state - default to empty
        newUser.instance_keys = [];
        newUser.partner_keys = [];
        newUser.fi_keys = [];
        changes.push("added instance_keys: [], partner_keys: [], fi_keys: []");
      }
    }

    // Report changes
    if (changes.length > 0) {
      console.log(`[${idx + 1}] ${user.email}:`);
      changes.forEach((c) => console.log(`    - ${c}`));
      console.log();
    } else {
      console.log(`[${idx + 1}] ${user.email}: (no changes needed)`);
    }

    return newUser;
  });

  // Prepare updated data
  const updatedData = {
    users: migrated,
    updated_at: new Date().toISOString(),
    schema_version: "2.0",
  };

  if (DRY_RUN) {
    console.log("\n=== DRY RUN COMPLETE ===");
    console.log("Run with --apply to save changes");
    console.log("\nPreview of migrated data:");
    console.log(JSON.stringify(updatedData, null, 2).slice(0, 2000) + "...");
  } else {
    // Backup original file
    const backupPath = USERS_FILE + ".backup-" + Date.now();
    await fs.writeFile(backupPath, raw);
    console.log(`\nBackup saved to: ${backupPath}`);

    // Write updated file
    await fs.writeFile(USERS_FILE, JSON.stringify(updatedData, null, 2), "utf8");
    console.log(`\n=== MIGRATION COMPLETE ===`);
    console.log(`Updated ${migrated.length} users in ${USERS_FILE}`);
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
