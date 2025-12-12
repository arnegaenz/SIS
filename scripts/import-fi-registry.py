#!/usr/bin/env python3
import csv
import json
from pathlib import Path
import sys

def normalize_lookup(value):
    if value is None:
        return ""
    return value.strip().lower()

FIELD_MAP = {
    "core_vendor": "Core Vendor",
    "core_product": "Core Product",
    "debit_processor": "Debit Processor",
    "credit_processor": "Credit Processor",
}

REGISTRY_PATHS = [
    Path("fi_registry.json"),
    Path("public/assets/data/fi_registry.json"),
]


def load_csv(path):
    lookup_map = {}
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            lookup_key = normalize_lookup(row.get("lookup_key"))
            if not lookup_key:
                continue
            row_values = {}
            for field_key, column_name in FIELD_MAP.items():
                raw_value = row.get(column_name)
                if raw_value is None:
                    continue
                cleaned = raw_value.strip()
                if cleaned:
                    row_values[field_key] = cleaned
            if not row_values:
                continue
            lookup_map[lookup_key] = row_values
    return lookup_map


def update_registry(path, lookup_map):
    if not path.exists():
        print(f"Skipping missing registry file: {path}")
        return 0, set()

    raw = path.read_text(encoding="utf-8")
    registry = json.loads(raw)
    updated_entries = 0
    applied_lookups = set()

    for key, entry in registry.items():
        entry_lookup = normalize_lookup(entry.get("fi_lookup_key") or entry.get("fi_name"))
        if not entry_lookup:
            continue
        row = lookup_map.get(entry_lookup)
        if not row:
            continue
        applied_lookups.add(entry_lookup)
        changed = False
        for field, value in row.items():
            existing = entry.get(field)
            if existing != value:
                entry[field] = value
                changed = True
        if changed:
            updated_entries += 1

    if updated_entries > 0:
        path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    return updated_entries, applied_lookups


def main():
    if len(sys.argv) < 2:
        print("Usage: ./scripts/import-fi-registry.py path/to/STRVV-115.csv")
        sys.exit(1)
    csv_path = Path(sys.argv[1])
    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}")
        sys.exit(1)

    lookup_map = load_csv(csv_path)
    if not lookup_map:
        print("No lookup_key rows with core metadata found in CSV.")
        return

    total_updated = 0
    total_applied = set()
    for registry_path in REGISTRY_PATHS:
        updated, applied = update_registry(registry_path, lookup_map)
        total_updated += updated
        total_applied.update(applied)
        print(f"{registry_path}: updated {updated} entries")

    unmatched = set(lookup_map.keys()) - total_applied
    if unmatched:
        print(f"CSV rows missing from registry (lookup_key): {', '.join(sorted(unmatched))}")
    print(f"Total entries updated: {total_updated}")


if __name__ == "__main__":
    main()
