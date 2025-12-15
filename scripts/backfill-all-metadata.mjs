#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const RAW_ROOT = 'raw';
let backfilled = 0;
let alreadyHad = 0;

function isDayComplete(dateStr) {
  const now = new Date();
  const dayEndUTC = new Date(dateStr + 'T23:59:59.999Z');
  return now > dayEndUTC;
}

function backfillMetadata(filePath, dateStr) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);

    if (!parsed._metadata) {
      const isComplete = isDayComplete(dateStr);
      const reordered = {
        _metadata: {
          fetchedAt: new Date(0).toISOString(),
          isComplete: isComplete
        },
        ...parsed
      };

      fs.writeFileSync(filePath, JSON.stringify(reordered, null, 2), 'utf8');
      backfilled++;

      if (backfilled % 100 === 0) {
        console.log(`Backfilled ${backfilled} files...`);
      }
    } else {
      alreadyHad++;
    }
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err.message);
  }
}

// Process all files in raw folder
const types = ['sessions', 'placements', 'ga'];
for (const type of types) {
  const dir = path.join(RAW_ROOT, type);
  if (!fs.existsSync(dir)) continue;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const dateStr = file.replace('.json', '');
    const filePath = path.join(dir, file);
    backfillMetadata(filePath, dateStr);
  }
}

console.log(`\nComplete!`);
console.log(`  Backfilled: ${backfilled}`);
console.log(`  Already had metadata: ${alreadyHad}`);
console.log(`  Total: ${backfilled + alreadyHad}`);
