import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// we already have GA helpers in ga.mjs from earlier steps
import {
  fetchGAFunnelByDay,
  aggregateGAFunnelByFI,
} from '../src/ga.mjs';

// helper to read JSON safely
function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // 1. load FI registry (this is the source of truth for integration_type)
  const fiRegistryPath = path.resolve(__dirname, '../fi_registry.json');
  const fiRegistry = readJson(fiRegistryPath) || {};

  // 2. load the SIS “current run” output files
  // adjust these paths to whatever your actual index.mjs writes out.
  // we will assume these are written by your main run:
  //  - ./output/sessions-by-fi.json
  //  - ./output/placements-by-fi.json
  const sessionsByFIPath = path.resolve(__dirname, '../output/sessions-by-fi.json');
  const placementsByFIPath = path.resolve(__dirname, '../output/placements-by-fi.json');

  const sessionsByFI = readJson(sessionsByFIPath) || {};
  const placementsByFI = readJson(placementsByFIPath) || {};

  // 3. figure out the SIS date window
  // if you already write it to a file, read it here. otherwise hardcode for now.
  // for now we'll try to read ./output/date-window.json
  const dateWindowPath = path.resolve(__dirname, '../output/date-window.json');
  let startDate = '2025-10-01';
  let endDate = '2025-10-31';
  const dateWindow = readJson(dateWindowPath);
  if (dateWindow && dateWindow.start && dateWindow.end) {
    startDate = dateWindow.start;
    endDate = dateWindow.end;
  }

  // 4. GA config
  const gaPropertyId = '328054560';
  const gaKeyFile = path.resolve(__dirname, '../secrets/ga-service-account.json');

  console.log('Fetching GA4 CardUpdatr funnel aligned to SIS date window...');

  let gaRows = [];
  try {
    gaRows = await fetchGAFunnelByDay({
      startDate,
      endDate,
      propertyId: gaPropertyId,
      keyFile: gaKeyFile,
    });
  } catch (err) {
    console.log('GA4 integration failed:', err.message);
    return;
  }

  // gaByFI = { [fi_lookup_key]: { select, user, cred } }
  const gaByFI = aggregateGAFunnelByFI(gaRows, fiRegistry);

  // build merged rows
  const merged = [];

  // 5. start with GA FIs
  for (const [fiKey, gaBucket] of Object.entries(gaByFI)) {
    const sisSessions = sessionsByFI[fiKey]?.sessions_total || 0;
    const sisPlacements = placementsByFI[fiKey]?.total || 0;

    // FORCE integration_type from registry
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
    });
  }

  // 6. now pull in SIS-only FIs (no GA rows)
  for (const [fiKey, sisObj] of Object.entries(sessionsByFI)) {
    const exists = merged.find((m) => m.fi_lookup_key === fiKey);
    if (exists) continue;

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
    });
  }

  // 7. group by integration_type (using registry)
  const groups = {
    SSO: [],
    'NON-SSO': [],
    CardSavr: [],
    UNKNOWN: [],
  };

  for (const row of merged) {
    if (row.integration_type === 'SSO') {
      groups.SSO.push(row);
    } else if (row.integration_type === 'NON-SSO') {
      groups['NON-SSO'].push(row);
    } else if (row.integration_type === 'CardSavr') {
      groups.CardSavr.push(row);
    } else {
      groups.UNKNOWN.push(row);
    }
  }

  const sortBySelectDesc = (a, b) => (b.ga_select || 0) - (a.ga_select || 0);
  Object.values(groups).forEach((arr) => arr.sort(sortBySelectDesc));

  function printGroup(title, rows) {
    if (!rows.length) return;
    console.log('');
    console.log(`GA + SIS CardUpdatr funnel (${title})`);
    console.log('FI                         | sel  usr  cred | sess  place | sel→usr | usr→cred');
    console.log('---------------------------+----------------+-------------+---------+---------');
    for (const r of rows) {
      const name = (r.fi_lookup_key || '').padEnd(27, ' ');
      const sel = String(r.ga_select || 0).padStart(4, ' ');
      const usr = String(r.ga_user || 0).padStart(4, ' ');
      const crd = String(r.ga_cred || 0).padStart(4, ' ');
      const sess = String(r.sis_sessions || 0).padStart(5, ' ');
      const plc = String(r.sis_placements || 0).padStart(6, ' ');
      const selToUser =
        r.ga_select > 0
          ? ((r.ga_user || 0) / r.ga_select * 100).toFixed(1) + '%'
          : '   —  ';
      const userToCred =
        r.ga_user > 0
          ? ((r.ga_cred || 0) / r.ga_user * 100).toFixed(1) + '%'
          : '   —  ';
      console.log(
        `${name} | ${sel} ${usr} ${crd} | ${sess} ${plc} | ${selToUser.padStart(7, ' ')} | ${userToCred.padStart(7, ' ')}`
      );
    }
  }

  printGroup('SSO', groups.SSO);
  printGroup('NON-SSO', groups['NON-SSO']);
  printGroup('CardSavr', groups.CardSavr);
  printGroup('UNKNOWN integration_type — fix fi_registry.json', groups.UNKNOWN);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
