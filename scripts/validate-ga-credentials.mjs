#!/usr/bin/env node
// scripts/validate-ga-credentials.mjs
// Validates and optionally fixes GA service account credentials

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const GA_FILES = [
  path.join(ROOT, 'secrets', 'ga-service-account.json'),
  path.join(ROOT, 'secrets', 'ga-test.json')
];

function validateGAFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n🔍 Checking ${fileName}...`);

  try {
    // Read file
    const raw = fs.readFileSync(filePath, 'utf8');

    // Check for CRLF line endings (Windows corruption)
    const hasCRLF = raw.includes('\r\n');
    if (hasCRLF) {
      console.log(`  ⚠️  File contains CRLF line endings (Windows)`);
    } else {
      console.log(`  ✓  File has LF line endings (Unix)`);
    }

    // Try to parse JSON
    let parsed;
    try {
      parsed = JSON.parse(raw);
      console.log(`  ✓  Valid JSON`);
    } catch (e) {
      console.log(`  ✗  Invalid JSON: ${e.message}`);
      return { valid: false, hasCRLF, error: 'Invalid JSON' };
    }

    // Check required fields
    const requiredFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email'];
    const missing = requiredFields.filter(f => !parsed[f]);
    if (missing.length > 0) {
      console.log(`  ✗  Missing required fields: ${missing.join(', ')}`);
      return { valid: false, hasCRLF, error: `Missing fields: ${missing.join(', ')}` };
    }
    console.log(`  ✓  All required fields present`);

    // Check private key format
    const privateKey = parsed.private_key;
    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
      console.log(`  ✗  Private key missing BEGIN marker`);
      return { valid: false, hasCRLF, error: 'Invalid private key format' };
    }

    // Check private key format
    // After JSON.parse(), the \n sequences in the JSON file become actual newline chars
    // This is correct! Google's JWT library expects actual newlines in the parsed value.
    const lines = privateKey.split('\n');
    if (lines.length > 5) {
      // Correctly formatted RSA key with multiple lines
      console.log(`  ✓  Private key properly formatted (${lines.length} lines after parsing)`);
    } else {
      console.log(`  ⚠️  Private key appears malformed (only ${lines.length} line(s))`);
    }

    // Check file size (should be reasonable)
    const stats = fs.statSync(filePath);
    console.log(`  ✓  File size: ${stats.size} bytes`);

    return { valid: true, hasCRLF, parsed };

  } catch (e) {
    console.log(`  ✗  Error reading file: ${e.message}`);
    return { valid: false, error: e.message };
  }
}

function fixLineEndings(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n🔧 Fixing line endings in ${fileName}...`);

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fixed = raw.replace(/\r\n/g, '\n');

    if (raw === fixed) {
      console.log(`  ℹ️  No changes needed`);
      return false;
    }

    // Create backup
    const backupPath = `${filePath}.backup`;
    fs.writeFileSync(backupPath, raw, 'utf8');
    console.log(`  ✓  Created backup: ${path.basename(backupPath)}`);

    // Write fixed version
    fs.writeFileSync(filePath, fixed, 'utf8');
    console.log(`  ✓  Fixed line endings (CRLF → LF)`);

    return true;
  } catch (e) {
    console.log(`  ✗  Error fixing file: ${e.message}`);
    return false;
  }
}

// Main
console.log('GA Service Account Credentials Validator\n');
console.log('This script checks GA credentials files for common issues');
console.log('that cause "Invalid JWT Signature" errors on Windows.\n');

const results = [];
for (const filePath of GA_FILES) {
  if (!fs.existsSync(filePath)) {
    console.log(`\n⊘  ${path.basename(filePath)} not found (skipping)`);
    continue;
  }

  const result = validateGAFile(filePath);
  results.push({ filePath, ...result });
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const hasIssues = results.some(r => !r.valid || r.hasCRLF);

if (!hasIssues) {
  console.log('\n✓  All GA credentials files are valid and properly formatted.');
  console.log('   If you\'re still seeing JWT errors, the issue may be elsewhere.\n');
  process.exit(0);
}

console.log('\n⚠️  Issues detected in GA credentials files:\n');

for (const result of results) {
  if (!result.valid || result.hasCRLF) {
    const fileName = path.basename(result.filePath);
    console.log(`  • ${fileName}:`);
    if (!result.valid) {
      console.log(`    - Invalid: ${result.error}`);
    }
    if (result.hasCRLF) {
      console.log(`    - Contains CRLF line endings (needs fixing)`);
    }
  }
}

// Offer to fix
const needsFixing = results.filter(r => r.hasCRLF);
if (needsFixing.length > 0) {
  console.log('\n📝 To fix line ending issues, run:');
  console.log('   node scripts/validate-ga-credentials.mjs --fix\n');

  // Check for --fix flag
  if (process.argv.includes('--fix')) {
    console.log('🔧 Fixing line endings...\n');
    for (const result of needsFixing) {
      fixLineEndings(result.filePath);
    }
    console.log('\n✓  All fixes applied. Try running the fetch scripts again.\n');
  }
} else {
  console.log('\n');
}
