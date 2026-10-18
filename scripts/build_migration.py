"""Regenerate/check exact source-backed migrations applied to BidMason Supabase.

This script performs no network or database operations. Five previously applied migrations plus a sixth security lockdown migration
already exist on BidMason project jgbogpunyzkoytrclqdl. The Storage collision
auditor is a separate preflight, not a persisted schema migration.
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = (
    (
        "supabase/migrations/20261017035109_bidmason_tenant_foundation.sql",
        "-- BidMason applied managed Supabase migration: 20261017035109 bidmason_tenant_foundation\n"
        "-- Reproduced from reviewed db/schema.sql and db/evidence_receipts.sql.\n",
        ("db/schema.sql", "db/evidence_receipts.sql"),
    ),
    (
        "supabase/migrations/20261017035151_bidmason_evidence_storage.sql",
        "-- BidMason applied managed Supabase migration: 20261017035151 bidmason_evidence_storage\n"
        "-- Reproduced from reviewed db/storage_policies.sql.\n",
        ("db/storage_policies.sql",),
    ),
    (
        "supabase/migrations/20261017035730_bidmason_evidence_review_fk_index.sql",
        "-- BidMason applied managed Supabase migration: 20261017035730 bidmason_evidence_review_fk_index\n"
        "-- Reproduced from db/review_indexes.sql.\n",
        ("db/review_indexes.sql",),
    ),
    (
        "supabase/migrations/20261017063426_bidmason_independent_fact_review.sql",
        "-- BidMason applied managed Supabase migration: 20261017063426 bidmason_independent_fact_review\n"
        "-- Reproduced from db/review_independence.sql.\n",
        ("db/review_independence.sql",),
    ),
    (
        "supabase/migrations/20261018064847_bidmason_atomic_evidence_upload_quota.sql",
        "-- BidMason applied managed Supabase migration: 20261018064847 bidmason_atomic_evidence_upload_quota\n"
        "-- Reproduced from reviewed db/upload_quota.sql; project jgbogpunyzkoytrclqdl.\n",
        ("db/upload_quota.sql",),
    ),
    (
        "supabase/migrations/20261018100829_bidmason_scan_gate_storage_lockdown.sql",
        "-- BidMason managed Supabase migration: 20261018100829 bidmason_scan_gate_storage_lockdown\n-- Additive client-write deny; preserve all previously applied migration history.\n",
        ("db/storage_insert_lockdown.sql",),
    ),
    (
        "supabase/migrations/20261018104109_bidmason_evidence_uploader_read_access.sql",
        "-- BidMason candidate managed Supabase migration: 20261018104109 bidmason_evidence_uploader_read_access\n-- Additive receipt uploader attribution and narrowed read-only Storage policy.\n",
        ("db/evidence_uploader_read_access.sql",),
    ),
    (
        "supabase/migrations/20261018111633_bidmason_receipt_metadata_private_read.sql",
        "-- BidMason managed migration: 20261018111633 bidmason_receipt_metadata_private_read\n-- Additive, restrictive signed-in receipt metadata visibility boundary.\n",
        ("db/receipt_metadata_private_read.sql",),
    ),
)


def rendered_migrations() -> dict[Path, str]:
    result: dict[Path, str] = {}
    for target, header, sources in MIGRATIONS:
        parts = [header]
        for source in sources:
            content = (ROOT / source).read_text(encoding="utf-8")
            if not content.endswith("\n") or any(line.lstrip().startswith("\\") for line in content.splitlines()):
                raise ValueError(f"Nonmigration directive or missing final newline: {source}")
            parts.append(content)
            if source != sources[-1]:
                parts.append("\n")
        result[ROOT / target] = "".join(parts)
    return result


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    for target, expected in rendered_migrations().items():
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != expected:
                print(f"FAIL: migration source drift: {target.relative_to(ROOT)}")
                return 1
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(expected, encoding="utf-8", newline="\n")
    print("PASS: all applied BidMason migration files match their reviewed sources"
          if args.check else "Wrote all applied BidMason migration files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
