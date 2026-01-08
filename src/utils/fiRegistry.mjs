import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_TYPES = new Set(["placement", "session"]);
const ALWAYS_SSO_INSTANCES = new Set(["advancial-prod"]);
const UNKNOWN_INSTANCE = "unknown";
const UNKNOWN_FI = "UNKNOWN_FI";

function normalizeInstance(instance) {
  if (!instance) return UNKNOWN_INSTANCE;
  return instance.toString().toLowerCase();
}

function normalizeFiKey(value) {
  if (!value) return UNKNOWN_FI;
  const str = value.toString().trim();
  if (!str) return UNKNOWN_FI;
  if (str.toUpperCase() === UNKNOWN_FI) return UNKNOWN_FI;
  return str.toLowerCase();
}

function makeRegistryKey(fiName, instance, fiLookupKey) {
  const name = normalizeFiKey(fiLookupKey || fiName || UNKNOWN_FI);
  const inst = normalizeInstance(instance);
  return `${name}__${inst}`;
}

// small helper to load existing registry (or start empty)
function loadRegistry() {
  const registryPath = path.join(__dirname, "..", "..", "fi_registry.json");
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw);
    return { registry: migrateRegistry(parsed), registryPath };
  } catch {
    return { registry: {}, registryPath };
  }
}

function migrateRegistry(raw = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const fiName = value.fi_name || key.split("__")[0] || key;
    const candidates = new Set();
    if (value.instance) {
      candidates.add(value.instance);
    }
    if (Array.isArray(value.instances) && value.instances.length) {
      value.instances.forEach((inst) => candidates.add(inst));
    }
    if (candidates.size === 0) {
      candidates.add(null);
    }
    for (const inst of candidates) {
      const registryKey = makeRegistryKey(fiName, inst, value.fi_lookup_key);
      const existing = normalized[registryKey] || {
        fi_name: fiName,
        fi_lookup_key: value.fi_lookup_key || null,
        instance: inst || null,
        instances: inst ? [inst] : [],
        sources: [],
        integration_type: value.integration_type || "non-sso",
        first_seen: value.first_seen || null,
        last_seen: value.last_seen || null,
        traffic_first_seen:
          value.traffic_first_seen || value.first_seen || null,
        traffic_last_seen:
          value.traffic_last_seen || value.last_seen || null,
        traffic_first_seen_sso: value.traffic_first_seen_sso || null,
      };

      // Preserve manually entered metadata fields from the source value
      if ('partner' in value && value.partner !== undefined) {
        existing.partner = value.partner;
      }
      if ('cardholder_total' in value && value.cardholder_total !== undefined) {
        existing.cardholder_total = value.cardholder_total;
      }
      if ('cardholder_source' in value && value.cardholder_source !== undefined) {
        existing.cardholder_source = value.cardholder_source;
      }
      if ('cardholder_as_of' in value && value.cardholder_as_of !== undefined) {
        existing.cardholder_as_of = value.cardholder_as_of;
      }

      const mergedSources = new Set([
        ...(existing.sources || []),
        ...((value.sources || []).map((src) => src.toString())),
      ]);
      existing.sources = Array.from(mergedSources).filter((src) =>
        SOURCE_TYPES.has(src)
      );
      existing.first_seen = pickEarlierDate(existing.first_seen, value.first_seen);
      existing.last_seen = pickLaterDate(existing.last_seen, value.last_seen);
      existing.traffic_first_seen = pickEarlierDate(
        existing.traffic_first_seen,
        value.traffic_first_seen || value.first_seen
      );
      existing.traffic_last_seen = pickLaterDate(
        existing.traffic_last_seen,
        value.traffic_last_seen || value.last_seen
      );
      existing.traffic_first_seen_sso = pickEarlierDate(
        existing.traffic_first_seen_sso,
        value.traffic_first_seen_sso
      );
      normalized[registryKey] = existing;
    }
  }
  return normalized;
}

function pickEarlierDate(a, b) {
  const dates = [toDateOnly(a), toDateOnly(b)].filter(Boolean);
  if (!dates.length) return null;
  return dates.sort()[0];
}

function pickLaterDate(a, b) {
  const dates = [toDateOnly(a), toDateOnly(b)].filter(Boolean);
  if (!dates.length) return null;
  return dates.sort()[dates.length - 1];
}

// normalize FI name off a session object
function getFiNameFromSession(s) {
  return (
    s?.fi_name ||
    s?.financial_institution ||
    s?.financial_institution_name ||
    s?.financial_institution_lookup_key ||
    s?.fi_lookup_key ||
    s?.institution ||
    s?.org_name ||
    "UNKNOWN_FI"
  );
}

// normalize FI name off a placement object
function getFiNameFromPlacement(p) {
  return (
    p?.fi_name ||
    p?.financial_institution ||
    p?.financial_institution_name ||
    p?.financial_institution_lookup_key ||
    p?.fi_lookup_key ||
    p?.issuer_name ||
    "UNKNOWN_FI"
  );
}

function getFiLookupKey(record) {
  const raw =
    record?.financial_institution_lookup_key ??
    record?.fi_lookup_key ??
    record?.financial_institution ??
    null;
  return raw === null || raw === undefined ? null : raw.toString();
}

function getInstanceName(record) {
  return (
    record?._instance ||
    record?.instance_name ||
    record?.instance ||
    record?.org_name ||
    null
  );
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const str = value.toString();
  const parsed = Date.parse(str);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return str.length >= 10 ? str.slice(0, 10) : null;
}

function determineIntegrationType(entry, ssoLookupSet) {
  const primaryInstance = entry.instance ? entry.instance.toString() : null;
  const primaryInstanceNorm = normalizeInstance(primaryInstance);

  if (primaryInstanceNorm === "ondot") {
    return "cardsavr";
  }

  if (
    primaryInstanceNorm === "pscu" ||
    ALWAYS_SSO_INSTANCES.has(primaryInstanceNorm)
  ) {
    return "sso";
  }

  const lookup = (entry.fi_lookup_key || "").toString().toLowerCase();
  if (lookup && ssoLookupSet.has(lookup)) {
    return "sso";
  }

  if (ALWAYS_SSO_INSTANCES.has(lookup)) {
    return "sso";
  }

  return "non-sso";
}

function addUniqueSorted(list, value) {
  if (!value) return list;
  const str = value.toString();
  if (!list.includes(str)) {
    list.push(str);
    list.sort((a, b) => a.localeCompare(b));
  }
  return list;
}

function upsertFi(registry, payload, ssoLookupSet) {
  const fiName = payload.fi_name || UNKNOWN_FI;
  const instanceValue = payload.instance ? payload.instance.toString() : null;
  const registryKey = makeRegistryKey(fiName, instanceValue, payload.fi_lookup_key);
  const integrationRaw = payload.integration || "";
  const isSsoTraffic =
    typeof integrationRaw === "string" &&
    integrationRaw.toUpperCase().includes("SSO");

  if (!registry[registryKey]) {
    registry[registryKey] = {
      fi_name: fiName,
      fi_lookup_key: payload.fi_lookup_key || null,
      instance: instanceValue,
      sources: [],
      integration_type: "non-sso",
      first_seen: null,
      last_seen: null,
    };
  }

  const entry = registry[registryKey];
  if (!entry.fi_name && fiName) {
    entry.fi_name = fiName;
  }

  entry.instance = instanceValue || entry.instance || null;
  entry.sources = Array.isArray(entry.sources) ? entry.sources : [];

  if (payload.source && SOURCE_TYPES.has(payload.source)) {
    addUniqueSorted(entry.sources, payload.source);
  }

  const dateOnly = toDateOnly(payload.seen_date);
  if (dateOnly) {
    entry.first_seen =
      !entry.first_seen || dateOnly < entry.first_seen
        ? dateOnly
        : toDateOnly(entry.first_seen);
    entry.last_seen =
      !entry.last_seen || dateOnly > entry.last_seen
        ? dateOnly
        : toDateOnly(entry.last_seen);
    entry.traffic_first_seen =
      !entry.traffic_first_seen || dateOnly < entry.traffic_first_seen
        ? dateOnly
        : toDateOnly(entry.traffic_first_seen);
    entry.traffic_last_seen =
      !entry.traffic_last_seen || dateOnly > entry.traffic_last_seen
        ? dateOnly
        : toDateOnly(entry.traffic_last_seen);
  } else {
    entry.first_seen = toDateOnly(entry.first_seen);
    entry.last_seen = toDateOnly(entry.last_seen);
    entry.traffic_first_seen = toDateOnly(entry.traffic_first_seen);
    entry.traffic_last_seen = toDateOnly(entry.traffic_last_seen);
  }

  if (!entry.fi_lookup_key && payload.fi_lookup_key) {
    entry.fi_lookup_key = payload.fi_lookup_key;
  }

  entry.integration_type = determineIntegrationType(entry, ssoLookupSet);
  if (dateOnly && payload.source === "session" && isSsoTraffic) {
    entry.traffic_first_seen_sso =
      !entry.traffic_first_seen_sso || dateOnly < entry.traffic_first_seen_sso
        ? dateOnly
        : toDateOnly(entry.traffic_first_seen_sso);
  }
}

function normalizeEntryForOutput(nameKey, entry, ssoLookupSet) {
  const instanceValue = entry.instance || null;
  const sources = Array.isArray(entry.sources) ? entry.sources.slice() : [];
  sources.sort((a, b) => a.localeCompare(b));
  const uniqueSources = [...new Set(sources)].filter((src) => SOURCE_TYPES.has(src));

  const normalized = {
    fi_name: entry.fi_name || nameKey,
    fi_lookup_key: entry.fi_lookup_key || null,
    instance: instanceValue || null,
    sources: uniqueSources,
    integration_type: determineIntegrationType(
      {
        ...entry,
        fi_lookup_key: entry.fi_lookup_key || null,
        instance: instanceValue || null,
      },
      ssoLookupSet
    ),
    first_seen: toDateOnly(entry.first_seen),
    last_seen: toDateOnly(entry.last_seen),
    traffic_first_seen: toDateOnly(entry.traffic_first_seen),
    traffic_last_seen: toDateOnly(entry.traffic_last_seen),
    traffic_first_seen_sso: toDateOnly(entry.traffic_first_seen_sso),
  };

  // Preserve manually entered metadata fields
  if ('partner' in entry && entry.partner !== undefined) {
    normalized.partner = entry.partner;
  }
  if ('cardholder_total' in entry && entry.cardholder_total !== undefined) {
    normalized.cardholder_total = entry.cardholder_total;
  }
  if ('cardholder_source' in entry && entry.cardholder_source !== undefined) {
    normalized.cardholder_source = entry.cardholder_source;
  }
  if ('cardholder_as_of' in entry && entry.cardholder_as_of !== undefined) {
    normalized.cardholder_as_of = entry.cardholder_as_of;
  }

  return normalized;
}

function sortRegistryForOutput(registryEntries) {
  return registryEntries.sort((a, b) => {
    const [nameA, dataA] = a;
    const [nameB, dataB] = b;
    const firstInstA = dataA.instance || "";
    const firstInstB = dataB.instance || "";
    if (firstInstA < firstInstB) return -1;
    if (firstInstA > firstInstB) return 1;
    const nameCompare = (dataA.fi_name || nameA).localeCompare(
      dataB.fi_name || nameB
    );
    if (nameCompare !== 0) return nameCompare;
    return nameA.localeCompare(nameB);
  });
}

export function updateFiRegistry(
  allSessions = [],
  allPlacements = [],
  ssoLookupSet = new Set()
) {
  const { registry, registryPath } = loadRegistry();

  for (const session of allSessions || []) {
    const fiName = getFiNameFromSession(session);
    const payload = {
      fi_name: fiName,
      fi_lookup_key: getFiLookupKey(session),
      instance: getInstanceName(session),
      source: "session",
      integration: session?.integration || session?.source?.integration,
      seen_date:
        session?.created_on ||
        session?.created_at ||
        session?.session_created_on,
    };
    upsertFi(registry, payload, ssoLookupSet);
  }

  for (const placement of allPlacements || []) {
    const fiName = getFiNameFromPlacement(placement);
    const payload = {
      fi_name: fiName,
      fi_lookup_key: getFiLookupKey(placement),
      instance: getInstanceName(placement),
      source: "placement",
      integration: placement?.integration || placement?.source?.integration,
      seen_date:
        placement?.created_on ||
        placement?.created_at ||
        placement?.result_created_on,
    };
    upsertFi(registry, payload, ssoLookupSet);
  }

  const normalizedEntries = Object.entries(registry).map(([name, data]) => [
    name,
    normalizeEntryForOutput(name, data, ssoLookupSet),
  ]);

  const orderedEntries = sortRegistryForOutput(normalizedEntries);
  const orderedRegistry = orderedEntries.reduce((acc, [name, data]) => {
    acc[name] = data;
    return acc;
  }, {});

  fs.writeFileSync(
    registryPath,
    JSON.stringify(orderedRegistry, null, 2),
    "utf8"
  );
  console.log(
    `✅ FI registry updated: ${Object.keys(orderedRegistry).length} FIs tracked in fi_registry.json`
  );
}
