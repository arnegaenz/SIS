import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function bucketGaRowsByFiForDay(gaRows, day) {
  const out = {};
  for (const r of gaRows) {
    if (r.date !== day) continue;
    if (!r.fi_key) continue;
    out[r.fi_key] ??= {
      select_merchants: 0,
      user_data_collection: 0,
      credential_entry: 0,
      instances: [],
    };
    const bucket = out[r.fi_key];
    const views = r.views || 0;
    if (r.page?.startsWith("/select-merchants")) {
      bucket.select_merchants += views;
    } else if (r.page?.startsWith("/user-data-collection")) {
      bucket.user_data_collection += views;
    } else if (r.page?.startsWith("/credential-entry")) {
      bucket.credential_entry += views;
    }

    if (r.instance) {
      const inst = r.instance.toString().toLowerCase();
      if (inst && !bucket.instances.includes(inst)) {
        bucket.instances.push(inst);
      }
    }
  }
  return out;
}

export function bucketSisSessionsByFiForDay(sisSessionRows, day) {
  const out = {};
  for (const row of sisSessionRows) {
    if (row.date !== day) continue;
    if (!row.fi_lookup_key) continue;
    out[row.fi_lookup_key] = {
      total_sessions: row.total_sessions || 0,
      sessions_with_jobs: row.sessions_with_jobs || 0,
      sessions_with_success: row.sessions_with_success || 0,
    };
  }
  return out;
}

export function bucketSisPlacementsByFiForDay(sisPlacementRows, day) {
  const out = {};
  for (const row of sisPlacementRows) {
    if (row.date !== day) continue;
    if (!row.fi_lookup_key) continue;
    out[row.fi_lookup_key] ??= {
      total_placements: 0,
      successful_placements: 0,
      by_termination: {},
    };
    const c = row.count || 0;
    out[row.fi_lookup_key].total_placements += c;
    if (row.success) {
      out[row.fi_lookup_key].successful_placements += c;
    }
    const term = row.termination || "UNKNOWN";
    out[row.fi_lookup_key].by_termination[term] =
      (out[row.fi_lookup_key].by_termination[term] || 0) + c;
  }
  return out;
}

export function buildDailyDocument({ day, gaByFi, sessionsByFi, placementsByFi }) {
  const allKeys = new Set([
    ...Object.keys(gaByFi),
    ...Object.keys(sessionsByFi),
    ...Object.keys(placementsByFi),
  ]);
  const fi = {};
  for (const key of allKeys) {
    const gRaw = gaByFi[key];
    const g = gRaw || {
      select_merchants: 0,
      user_data_collection: 0,
      credential_entry: 0,
    };
    const s = sessionsByFi[key] || {
      total_sessions: 0,
      sessions_with_jobs: 0,
      sessions_with_success: 0,
    };
    const p = placementsByFi[key] || {
      total_placements: 0,
      successful_placements: 0,
      by_termination: {},
    };
    const without_jobs = Math.max(
      0,
      (s.total_sessions || 0) - (s.sessions_with_jobs || 0)
    );
    const gaInstances = Array.isArray(gRaw?.instances)
      ? Array.from(
          new Set(
            gRaw.instances
              .filter(Boolean)
              .map((inst) => inst.toString().toLowerCase())
          )
        )
      : [];

    fi[key] = {
      ga: {
        select_merchants: g.select_merchants || 0,
        user_data_collection: g.user_data_collection || 0,
        credential_entry: g.credential_entry || 0,
      },
      ga_instances: gaInstances,
      sessions: {
        total: s.total_sessions,
        with_jobs: s.sessions_with_jobs,
        with_success: s.sessions_with_success,
        without_jobs,
      },
      placements: p,
    };
  }
  return {
    date: day,
    sources: {
      ga: Object.keys(gaByFi).length > 0,
      sis_sessions: Object.keys(sessionsByFi).length > 0,
      sis_placements: Object.keys(placementsByFi).length > 0,
    },
    fi,
  };
}

export async function writeDailyFile(baseDir, day, doc) {
  await ensureDir(baseDir);
  const filePath = path.join(baseDir, `${day}.json`);
  await fs.writeFile(filePath, JSON.stringify(doc, null, 2));
  return filePath;
}
