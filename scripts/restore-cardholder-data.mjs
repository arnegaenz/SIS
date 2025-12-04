#!/usr/bin/env node

/**
 * Restore Cardholder Data Script
 *
 * This script merges cardholder data from the recovered registry
 * (fi_registry_recovered.json) back into the current registry (fi_registry.json).
 *
 * It only updates entries that have cardholder data in the recovered file
 * and preserves all other fields from the current registry.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CURRENT_REGISTRY_PATH = path.join(__dirname, '..', 'fi_registry.json');
const RECOVERED_REGISTRY_PATH = path.join(__dirname, '..', 'fi_registry_recovered.json');
const BACKUP_PATH = path.join(__dirname, '..', 'fi_registry_backup_pre_restore.json');

console.log('🔧 Cardholder Data Restoration Script\n');

// Load current registry
console.log('📖 Loading current registry...');
const currentRegistry = JSON.parse(fs.readFileSync(CURRENT_REGISTRY_PATH, 'utf8'));
console.log(`   Found ${Object.keys(currentRegistry).length} entries in current registry`);

// Load recovered registry
console.log('📖 Loading recovered registry from commit 3945c4c...');
const recoveredRegistry = JSON.parse(fs.readFileSync(RECOVERED_REGISTRY_PATH, 'utf8'));
console.log(`   Found ${Object.keys(recoveredRegistry).length} entries in recovered registry`);

// Find entries with cardholder data
console.log('\n🔍 Analyzing cardholder data...');
const entriesWithCardholders = Object.entries(recoveredRegistry).filter(([key, value]) => {
  return value.cardholder_total !== null && value.cardholder_total !== undefined;
});

console.log(`   Found ${entriesWithCardholders.length} entries with cardholder data:\n`);
entriesWithCardholders.forEach(([key, value]) => {
  console.log(`   • ${key}`);
  console.log(`     Cardholders: ${value.cardholder_total}`);
  console.log(`     Source: ${value.cardholder_source || 'N/A'}`);
  console.log(`     As Of: ${value.cardholder_as_of || 'N/A'}`);
});

// Create backup
console.log('\n💾 Creating backup of current registry...');
fs.writeFileSync(BACKUP_PATH, JSON.stringify(currentRegistry, null, 2), 'utf8');
console.log(`   Backup saved to: ${BACKUP_PATH}`);

// Merge cardholder data
console.log('\n🔄 Merging cardholder data into current registry...');
let updatedCount = 0;
let notFoundCount = 0;

for (const [key, recoveredEntry] of entriesWithCardholders) {
  if (currentRegistry[key]) {
    // Entry exists in current registry - merge cardholder data
    currentRegistry[key].cardholder_total = recoveredEntry.cardholder_total;
    currentRegistry[key].cardholder_source = recoveredEntry.cardholder_source;
    currentRegistry[key].cardholder_as_of = recoveredEntry.cardholder_as_of;

    // Also restore partner if it was set
    if (recoveredEntry.partner !== null && recoveredEntry.partner !== undefined) {
      currentRegistry[key].partner = recoveredEntry.partner;
    }

    updatedCount++;
    console.log(`   ✓ Updated: ${key}`);
  } else {
    notFoundCount++;
    console.log(`   ⚠ Not found in current registry: ${key}`);
  }
}

// Write updated registry
console.log('\n💾 Writing updated registry...');
fs.writeFileSync(CURRENT_REGISTRY_PATH, JSON.stringify(currentRegistry, null, 2), 'utf8');
console.log(`   Registry saved to: ${CURRENT_REGISTRY_PATH}`);

// Summary
console.log('\n✅ Restoration Complete!\n');
console.log(`   Entries updated: ${updatedCount}`);
console.log(`   Entries not found: ${notFoundCount}`);
console.log(`   Total entries with cardholder data: ${entriesWithCardholders.length}`);

if (notFoundCount > 0) {
  console.log('\n⚠ Warning: Some entries from the recovered registry were not found in the current registry.');
  console.log('   This may be normal if those FI entries were removed or renamed.');
}

console.log('\n📝 Next Steps:');
console.log('   1. Review the updated fi_registry.json file');
console.log('   2. Run a test update to verify the fix works');
console.log('   3. If everything looks good, commit the changes');
console.log(`   4. The backup is saved at: ${BACKUP_PATH}\n`);
