/**
 * Data-scoping utilities — extracted from serve-funnel.mjs so they can be
 * unit-tested independently and reused across server + test code.
 */

// ── Normalization helpers ────────────────────────────────────────────

export function normalizeFiKey(value) {
  return value ? value.toString().trim().toLowerCase() : "";
}

export function canonicalInstance(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeInstanceKey(value) {
  const normalized = canonicalInstance(value);
  return normalized || "unknown";
}

export function parseListParam(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (entry || "").toString().trim())
      .filter(Boolean);
  }
  return value
    .toString()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// ── User access normalization ────────────────────────────────────────

/**
 * Normalize user access fields for backward compatibility.
 * - Renames "full" access_level to "admin"
 * - Ensures instance_keys, partner_keys, fi_keys exist with proper defaults
 */
export function normalizeUserAccessFields(user) {
  // Handle legacy "full" access_level
  let accessLevel = user.access_level;
  if (accessLevel === "full") {
    accessLevel = "admin";
  }

  // Handle legacy fi_keys-only format
  let instanceKeys = user.instance_keys;
  let partnerKeys = user.partner_keys;
  let fiKeys = user.fi_keys;

  if (instanceKeys === undefined && partnerKeys === undefined) {
    // Legacy user: only has fi_keys
    if (fiKeys === "*") {
      instanceKeys = "*";
      partnerKeys = "*";
    } else {
      instanceKeys = [];
      partnerKeys = [];
    }
  }

  // Ensure defaults
  if (instanceKeys === undefined) instanceKeys = [];
  if (partnerKeys === undefined) partnerKeys = [];
  if (fiKeys === undefined) fiKeys = [];

  return {
    access_level: accessLevel,
    instance_keys: instanceKeys,
    partner_keys: partnerKeys,
    fi_keys: fiKeys,
  };
}

// ── FI access computation ────────────────────────────────────────────

/**
 * Compute the set of FI lookup keys a user can access based on their access configuration.
 * Returns null if user has unrestricted access (admin or any wildcard).
 * Returns Set<string> of normalized fi_lookup_keys otherwise.
 *
 * Uses UNION semantics: user can access an FI if it matches ANY of their access criteria.
 */
export function computeAllowedFis(userContext, fiRegistry) {
  if (!userContext) return null; // No user context = unrestricted

  // Admin and internal users always have full data access
  if (userContext.access_level === "admin" || userContext.access_level === "internal") {
    return null;
  }

  // Check for wildcard access on any dimension
  const hasFullInstanceAccess = userContext.instance_keys === "*";
  const hasFullPartnerAccess = userContext.partner_keys === "*";
  const hasFullFiAccess = userContext.fi_keys === "*";

  // If any dimension is "*", user has full access
  if (hasFullInstanceAccess || hasFullPartnerAccess || hasFullFiAccess) {
    return null;
  }

  // Normalize access arrays
  const instanceKeys = Array.isArray(userContext.instance_keys)
    ? new Set(userContext.instance_keys.map((k) => normalizeInstanceKey(k)))
    : new Set();
  const partnerKeys = Array.isArray(userContext.partner_keys)
    ? new Set(userContext.partner_keys.map((k) => (k || "").toString().trim().toLowerCase()))
    : new Set();
  const fiKeys = Array.isArray(userContext.fi_keys)
    ? new Set(userContext.fi_keys.map((k) => normalizeFiKey(k)))
    : new Set();

  // If all dimensions are empty, no access
  if (instanceKeys.size === 0 && partnerKeys.size === 0 && fiKeys.size === 0) {
    return new Set(); // empty = no access
  }

  // Build allowed FI set from registry using UNION logic
  const allowed = new Set();

  // Add directly specified FIs
  for (const fi of fiKeys) {
    allowed.add(fi);
  }

  // Add FIs matching instance or partner criteria from registry
  if (fiRegistry && typeof fiRegistry === "object") {
    for (const entry of Object.values(fiRegistry)) {
      if (!entry || !entry.fi_lookup_key) continue;
      const fiKey = normalizeFiKey(entry.fi_lookup_key);

      // Check instance match
      if (instanceKeys.size > 0 && entry.instance) {
        if (instanceKeys.has(normalizeInstanceKey(entry.instance))) {
          allowed.add(fiKey);
          continue;
        }
      }

      // Check partner match
      if (partnerKeys.size > 0 && entry.partner) {
        const normalizedPartner = entry.partner.toString().trim().toLowerCase();
        if (partnerKeys.has(normalizedPartner)) {
          allowed.add(fiKey);
        }
      }
    }
  }

  return allowed;
}
