#!/usr/bin/env python3
"""Import the four remaining original assets into non-served quarantine.

Usage: python scripts/import_legacy_assets.py /path/to/bidmason.zip
No source file is executed or published by this operation.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = Path("historical-source")

# SHA-256 values of the actual supplied June 2026 ZIP entries.
REQUIRED = {
    "bidmason-website.html": (
        43478, "3390d74e88a048966c6c35240c2289fe6ff5b1ee28c440a8e9d769d5b31fe1f9"
    ),
    "demo-clients/harbor-coast-painting/04-website-harbor-coast.html": (
        22049, "bbf15fa08b88542a6025f3b50d584e7f4ee90ce6678a25bd3df204e7fdf64b7f"
    ),
    "demo-clients/harbor-coast-painting/make_proposal_pdf.py": (
        14710, "4db3c9b8fb1015957a39964430f09f0d936f8e276856fcad4a44f9b22528a9e8"
    ),
    "demo-clients/harbor-coast-painting/harbor-coast-proposal-unit-turn-program-v2026-06-11.pdf": (
        10215, "23d380df90280a10eb1d5f14127758314b348720b24a7e3eb3db09e5e074bc4f"
    ),
}


def validate_member(archive: zipfile.ZipFile, relative: str, size: int, digest: str) -> bytes:
    original = "bidmason/" + relative
    entry = archive.getinfo(original)
    if entry.is_dir() or entry.file_size != size or entry.file_size > 100_000:
        raise ValueError(f"Unexpected archive entry size/type: {relative}")
    data = archive.read(entry)
    if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Original archive checksum mismatch: {relative}")
    if relative.endswith(".pdf") and not data.startswith(b"%PDF-"):
        raise ValueError(f"Invalid PDF magic: {relative}")
    return data


def import_assets(zip_path: Path, root: Path = ROOT) -> list[Path]:
    # Read and authenticate the full allowlist before touching destination.
    with zipfile.ZipFile(zip_path) as archive:
        entries = {
            relative: validate_member(archive, relative, *expected)
            for relative, expected in REQUIRED.items()
        }
    destination = root / DESTINATION
    # Never overwrite an existing, different file.
    for relative, data in entries.items():
        target = destination / relative
        if target.exists() and target.read_bytes() != data:
            raise FileExistsError(f"Existing historical source differs: {target}")
    result = []
    for relative, data in entries.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(data)
        result.append(target)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_zip", type=Path)
    args = parser.parse_args()
    imported = import_assets(args.source_zip)
    print(f"Preserved {len(imported)} validated original assets under {DESTINATION}/ (not served)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
