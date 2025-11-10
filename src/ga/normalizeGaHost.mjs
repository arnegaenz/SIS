export function normalizeGaHost(host) {
  if (!host) return null;

  if (host === "advancial-prod.cardupdatr.app") {
    return {
      fi_lookup_key: "advancial-prod",
      instance: "advancial-prod",
    };
  }

  const parts = host.split(".");
  if (parts.length < 4) {
    return null;
  }

  const fi_lookup_key = parts[0];
  const instance = parts[1];

  return {
    fi_lookup_key,
    instance,
  };
}

export default {
  normalizeGaHost,
};
