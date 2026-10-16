"""Losslessly restore four byte-exact legacy assets from non-public LZMA archive."""
from __future__ import annotations

import base64
import hashlib
import lzma
from pathlib import Path

from scripts.import_legacy_assets import REQUIRED, DESTINATION

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = Path("historical-source/legacy-assets.lzma.b64")
BUNDLE_SHA256 = "585d395ab1708a07535d85f88cfcb590bf39b5e005e0830759d5665967e7602d"
RAW_SHA256 = "8776a3abc64ec415b78b09693cc00010782c4aefc2ce759486354a41b5980901"
ENCODED_LENGTH = 34860
RAW_LENGTH = 90468


def original_assets(root: Path = ROOT) -> dict[str, bytes]:
    encoded = (root / BUNDLE).read_text(encoding="ascii").strip()
    if len(encoded) != ENCODED_LENGTH:
        raise ValueError("Historical archive length mismatch")
    compressed = base64.b64decode(encoded, validate=True)
    if hashlib.sha256(compressed).hexdigest() != BUNDLE_SHA256:
        raise ValueError("Historical archive checksum mismatch")
    payload = lzma.decompress(compressed)
    if len(payload) != RAW_LENGTH or hashlib.sha256(payload).hexdigest() != RAW_SHA256:
        raise ValueError("Historical archive payload mismatch")

    assets: dict[str, bytes] = {}
    position = 0
    for name, (expected_size, expected_hash) in REQUIRED.items():
        if position + 4 > len(payload):
            raise ValueError(f"Missing archived length for {name}")
        size = int.from_bytes(payload[position:position + 4], "big")
        position += 4
        if size != expected_size or position + size > len(payload):
            raise ValueError(f"Invalid archived length for {name}")
        data = payload[position:position + size]
        position += size
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise ValueError(f"Altered historical source: {name}")
        if name.endswith(".pdf") and not data.startswith(b"%PDF-"):
            raise ValueError(f"Invalid historical PDF: {name}")
        assets[name] = data
    if position != len(payload):
        raise ValueError("Trailing bytes in historical archive")
    return assets


def restore_assets(root: Path = ROOT) -> list[Path]:
    """Restore only into quarantine; never publish or overwrite differing files."""
    assets = original_assets(root)
    destination = root / DESTINATION
    for name, data in assets.items():
        path = destination / name
        if path.exists() and path.read_bytes() != data:
            raise FileExistsError(f"Existing historical source differs: {path}")
    paths: list[Path] = []
    for name, data in assets.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(data)
        paths.append(path)
    return paths


if __name__ == "__main__":
    restored = restore_assets()
    print(f"PASS: restored {len(restored)} byte-identical source files under {DESTINATION}/")
