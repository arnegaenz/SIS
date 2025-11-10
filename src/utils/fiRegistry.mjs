import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_TYPES = new Set(["placement", "session"]);
const ALWAYS_SSO_INSTANCES = new Set(["advancial-prod"]);

// small helper to load existing registry (or start empty)
function loadRegistry() {
  const registryPath = path.join(__dirname, "..", "..", "fi_registry.json");
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    return { registry: JSON.parse(raw), registryPath };
  } catch {
    return { registry: {}, registryPath };
  }
}

// normalize FI name off a session object
function getFiNameFromSession(s) {
  return (
    s?.fi_name ||
    s?.financial_institution ||
    s?.financial_institution_name ||
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
  const instances = Array.isArray(entry.instances) ? entry.instances : [];
  const normalizedInstances = instances.map((inst) =>
    inst ? inst.toString().toLowerCase() : ""
  );

  if (instances.some((inst) => inst && inst.toLowerCase() === "ondot")) {
    return "cardsavr";
  }

  if (
    normalizedInstances.some((inst) => inst === "pscu") ||
    normalizedInstances.some((inst) => ALWAYS_SSO_INSTANCES.has(inst))
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
  const nameKey = payload.fi_name || "UNKNOWN_FI";
  if (!registry[nameKey]) {
    registry[nameKey] = {
      fi_name: payload.fi_name || nameKey,
      fi_lookup_key: payload.fi_lookup_key || null,
      instances: payload.instance ? [payload.instance.toString()] : [],
      sources: payload.source ? [payload.source.toString()] : [],
      integration_type: "non-sso",
      first_seen: null,
      last_seen: null,
    };
  }

  const entry = registry[nameKey];
  if (!entry.fi_name && payload.fi_name) {
    entry.fi_name = payload.fi_name;
  }

  entry.instances = Array.isArray(entry.instances) ? entry.instances : [];
  entry.sources = Array.isArray(entry.sources) ? entry.sources : [];

  if (payload.instance) {
    addUniqueSorted(entry.instances, payload.instance);
  }

  if (payload.source && SOURCE_TYPES.has(payload.source)) {
    addUniqueSorted(entry.sources, payload.source);
  }

  const dateOnly = toDateOnly(payload.seen_date);
  if (dateOnly) {
    entry.first_seen = !entry.first_seen || dateOnly < entry.first_seen
      ? dateOnly
      : toDateOnly(entry.first_seen);
    entry.last_seen = !entry.last_seen || dateOnly > entry.last_seen
      ? dateOnly
      : toDateOnly(entry.last_seen);
  } else {
    entry.first_seen = toDateOnly(entry.first_seen);
    entry.last_seen = toDateOnly(entry.last_seen);
  }

  if (!entry.fi_lookup_key && payload.fi_lookup_key) {
    entry.fi_lookup_key = payload.fi_lookup_key;
  }

  entry.integration_type = determineIntegrationType(entry, ssoLookupSet);
}

function normalizeEntryForOutput(nameKey, entry, ssoLookupSet) {
  const instances = Array.isArray(entry.instances) ? entry.instances.slice() : [];
  const sources = Array.isArray(entry.sources) ? entry.sources.slice() : [];
  instances.sort((a, b) => a.localeCompare(b));
  const uniqueInstances = [...new Set(instances)];
  sources.sort((a, b) => a.localeCompare(b));
  const uniqueSources = [...new Set(sources)].filter((src) => SOURCE_TYPES.has(src));

  const normalized = {
    fi_name: entry.fi_name || nameKey,
    fi_lookup_key: entry.fi_lookup_key || null,
    instances: uniqueInstances,
    sources: uniqueSources,
    integration_type: determineIntegrationType(
      {
        ...entry,
        fi_lookup_key: entry.fi_lookup_key || null,
        instances: uniqueInstances,
      },
      ssoLookupSet
    ),
    first_seen: toDateOnly(entry.first_seen),
    last_seen: toDateOnly(entry.last_seen),
  };

  return normalized;
}

function sortRegistryForOutput(registryEntries) {
  return registryEntries.sort((a, b) => {
    const [nameA, dataA] = a;
    const [nameB, dataB] = b;
    const firstInstA = dataA.instances[0] || "";
    const firstInstB = dataB.instances[0] || "";
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
