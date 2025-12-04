#!/usr/bin/env node

/**
 * Test Registry Fix
 *
 * This script tests that the normalizeEntryForOutput() fix properly preserves
 * cardholder metadata when the registry is updated.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Testing Registry Metadata Preservation Fix\n');

// Import the fiRegistry module
const fiRegistryPath = path.join(__dirname, '..', 'src', 'utils', 'fiRegistry.mjs');
const { updateFiRegistry } = await import(fiRegistryPath);

// Backup current registry
const registryPath = path.join(__dirname, '..', 'fi_registry.json');
const testBackupPath = path.join(__dirname, '..', 'fi_registry_test_backup.json');

console.log('📖 Reading current registry...');
const beforeRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

// Count entries with cardholder data before test
const beforeWithCardholders = Object.entries(beforeRegistry).filter(([k,v]) =>
  v.cardholder_total !== null && v.cardholder_total !== undefined
);

console.log(`   Found ${Object.keys(beforeRegistry).length} total entries`);
console.log(`   Found ${beforeWithCardholders.length} entries with cardholder data`);

// Create test backup
console.log('\n💾 Creating test backup...');
fs.writeFileSync(testBackupPath, JSON.stringify(beforeRegistry, null, 2), 'utf8');
console.log(`   Backup saved to: ${testBackupPath}`);

// Sample cardholder entries to check
const testEntries = beforeWithCardholders.slice(0, 5).map(([key, value]) => ({
  key,
  cardholder_total: value.cardholder_total,
  cardholder_source: value.cardholder_source,
  cardholder_as_of: value.cardholder_as_of,
  partner: value.partner
}));

console.log('\n📝 Sample entries to verify:');
testEntries.forEach(entry => {
  console.log(`   • ${entry.key}`);
  console.log(`     Cardholders: ${entry.cardholder_total}`);
  console.log(`     Source: ${entry.cardholder_source || 'N/A'}`);
  console.log(`     Partner: ${entry.partner || 'N/A'}`);
});

// Run updateFiRegistry with empty data (should preserve existing entries)
console.log('\n🔄 Running updateFiRegistry() with empty data...');
console.log('   (This simulates what happens during normal data processing)');

try {
  updateFiRegistry([], [], new Set());
  console.log('   ✓ updateFiRegistry() completed successfully');
} catch (error) {
  console.error('   ✗ updateFiRegistry() failed:', error.message);
  process.exit(1);
}

// Read registry after update
console.log('\n📖 Reading registry after update...');
const afterRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

const afterWithCardholders = Object.entries(afterRegistry).filter(([k,v]) =>
  v.cardholder_total !== null && v.cardholder_total !== undefined
);

console.log(`   Found ${Object.keys(afterRegistry).length} total entries`);
console.log(`   Found ${afterWithCardholders.length} entries with cardholder data`);

// Verify test entries
console.log('\n🔍 Verifying metadata preservation...');
let allPassed = true;

for (const beforeEntry of testEntries) {
  const afterEntry = afterRegistry[beforeEntry.key];

  if (!afterEntry) {
    console.log(`   ✗ FAIL: Entry "${beforeEntry.key}" was removed!`);
    allPassed = false;
    continue;
  }

  const checks = [
    {
      field: 'cardholder_total',
      before: beforeEntry.cardholder_total,
      after: afterEntry.cardholder_total
    },
    {
      field: 'cardholder_source',
      before: beforeEntry.cardholder_source,
      after: afterEntry.cardholder_source
    },
    {
      field: 'cardholder_as_of',
      before: beforeEntry.cardholder_as_of,
      after: afterEntry.cardholder_as_of
    },
    {
      field: 'partner',
      before: beforeEntry.partner,
      after: afterEntry.partner
    }
  ];

  let entryPassed = true;
  for (const check of checks) {
    if (check.before !== check.after) {
      console.log(`   ✗ FAIL: ${beforeEntry.key}.${check.field}`);
      console.log(`     Expected: ${check.before}`);
      console.log(`     Got: ${check.after}`);
      entryPassed = false;
      allPassed = false;
    }
  }

  if (entryPassed) {
    console.log(`   ✓ PASS: ${beforeEntry.key} - all metadata preserved`);
  }
}

// Restore from backup
console.log('\n♻️  Restoring original registry from backup...');
fs.writeFileSync(registryPath, fs.readFileSync(testBackupPath, 'utf8'), 'utf8');
console.log('   Registry restored');

// Summary
console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('✅ TEST PASSED! Metadata preservation is working correctly.\n');
  console.log('   The fix successfully prevents cardholder data loss when');
  console.log('   updateFiRegistry() is called.');
} else {
  console.log('❌ TEST FAILED! Metadata was lost during update.\n');
  console.log('   The fix did not work as expected.');
  process.exit(1);
}
console.log('='.repeat(60) + '\n');

// Cleanup
fs.unlinkSync(testBackupPath);
console.log('🧹 Test backup removed');
