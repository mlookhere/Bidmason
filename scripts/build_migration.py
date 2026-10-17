"""Build or check a candidate, atomic baseline migration from reviewed SQL.

Never connects to Supabase; never runs SQL. The source files are maintained
individually and copied verbatim into a single transaction-ready artifact.
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = (
    "db/schema.sql",
    "db/evidence_receipts.sql",
    "db/storage_policies.sql",
    "db/storage_policy_audit.sql",
)
DEST = ROOT / "supabase/migrations/20261017000000_bidmason_candidate_baseline.sql"
HEADER = (
    "-- BIDMASON CANDIDATE ONLY -- NEVER APPLY TO AN UNAUTHORIZED PROJECT.\n"
    "-- Needs a dedicated Supabase project, Storage-schema/DDL compatibility review,\n"
    "-- migration-owner approval, and live tenant tests before production use.\n"
    "-- Do not package CI-only auth/Storage stubs or synthetic fixtures.\n"
    "begin;\n"
)


def render() -> str:
    contents = [HEADER]
    for relative in SOURCES:
        raw = (ROOT / relative).read_text(encoding="utf-8")
        if not raw.endswith("\n"):
            raise ValueError(f"Missing final newline: {relative}")
        # psql output directives are not valid SQL in native Supabase migrations.
        sql = "\n".join(
            line for line in raw.splitlines()
            if not line.lstrip().startswith("\\echo")
        ) + "\n"
        if any(line.lstrip().startswith("\\") for line in sql.splitlines()):
            raise ValueError(f"Unsupported psql directive in {relative}")
        contents.append(f"\n-- BEGIN AUTHORITATIVE SOURCE {relative}\n")
        contents.append(sql)
        contents.append(f"-- END AUTHORITATIVE SOURCE {relative}\n")
    contents.append("\ncommit;\n")
    return "".join(contents)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Fail if committed migration is stale")
    args = parser.parse_args()
    expected = render()
    if args.check:
        if not DEST.is_file() or DEST.read_text(encoding="utf-8") != expected:
            print("FAIL: committed migration differs from authoritative source")
            return 1
        print("PASS: candidate migration is byte-exact from reviewed source SQL")
    else:
        DEST.parent.mkdir(parents=True, exist_ok=True)
        DEST.write_text(expected, encoding="utf-8", newline="\n")
        print(f"Candidate migration generated: {DEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
