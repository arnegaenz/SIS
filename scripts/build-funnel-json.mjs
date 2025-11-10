import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGAFunnelByDay, aggregateGAFunnelByFI } from '../src/ga.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function main() {
  // paths
  const outputDir = path.resolve(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fiRegistryPath = path.resolve(__dirname, '../fi_registry.json');
  const sessionsByFIPath = path.resolve(__dirname, '../output/sessions-by-fi.json');
  const placementsByFIPath = path.resolve(__dirname, '../output/placements-by-fi.json');
  const dateWindowPath = path.resolve(__dirname, '../output/date-window.json');

  const fiRegistry = readJson(fiRegistryPath) || {};
  const sessionsByFI = readJson(sessionsByFIPath) || {};
  const placementsByFI = readJson(placementsByFIPath) || {};

  let startDate = '2025-10-01';
  let endDate = '2025-10-31';
  const dateWindow = readJson(dateWindowPath);
  if (dateWindow && dateWindow.start && dateWindow.end) {
    startDate = dateWindow.start;
    endDate = dateWindow.end;
  }

  const gaPropertyId = '328054560';
  const gaKeyFile = path.resolve(__dirname, '../secrets/ga-service-account.json');

  console.log(`Building GA+SIS funnel JSON for ${startDate} → ${endDate} ...`);

  let gaRows = [];
  try {
    gaRows = await fetchGAFunnelByDay({
      startDate,
      endDate,
      propertyId: gaPropertyId,
      keyFile: gaKeyFile,
    });
  } catch (err) {
    console.error('GA fetch failed:', err.message);
    process.exit(1);
  }

  const gaByFI = aggregateGAFunnelByFI(gaRows, fiRegistry);

  const merged = [];

  // GA-origin FIs
  for (const [fiKey, gaBucket] of Object.entries(gaByFI)) {
    const sisSessions = sessionsByFI[fiKey]?.sessions_total || 0;
    const sisPlacements = placementsByFI[fiKey]?.total || 0;
    const reg = fiRegistry[fiKey];
    const integration_type = reg ? (reg.integration_type || 'UNKNOWN') : 'UNKNOWN';

    merged.push({
      fi_lookup_key: fiKey,
      integration_type,
      ga_select: gaBucket.select,
      ga_user: gaBucket.user,
      ga_cred: gaBucket.cred,
      sis_sessions: sisSessions,
      sis_placements: sisPlacements,
      date_start: startDate,
      date_end: endDate,
    });
  }

  // SIS-only FIs
  for (const [fiKey, sisObj] of Object.entries(sessionsByFI)) {
    const already = merged.find((m) => m.fi_lookup_key === fiKey);
    if (already) continue;

    const sisPlacements = placementsByFI[fiKey]?.total || 0;
    const reg = fiRegistry[fiKey];
    const integration_type = reg ? (reg.integration_type || 'UNKNOWN') : 'UNKNOWN';

    merged.push({
      fi_lookup_key: fiKey,
      integration_type,
      ga_select: 0,
      ga_user: 0,
      ga_cred: 0,
      sis_sessions: sisObj.sessions_total || 0,
      sis_placements: sisPlacements,
      date_start: startDate,
      date_end: endDate,
    });
  }

  const outPath = path.resolve(outputDir, 'ga-sis-funnel.json');
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`✅ wrote ${merged.length} rows to ${outPath}`);
}

main();
