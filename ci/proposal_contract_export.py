"""Generate disposable fictional PDFs and verified manifests for cross-runtime QA."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.proposal_artifact_integrity import (  # noqa: E402
    build_integrity_manifest, verify_integrity_manifest,
)
from scripts.render_branded_proposal_pdf import render  # noqa: E402


def main(directory: Path) -> None:
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("An existing private QA directory is required")
    for company in ("painting", "cleaning", "painting-unicode"):
        fixture = "painting" if company == "painting-unicode" else company
        snapshot = json.loads((ROOT / "fixtures" /
                               f"synthetic_{fixture}_proposal.json").read_text(encoding="utf-8"))
        if company == "painting-unicode":
            snapshot["brand"]["businessName"] = "Café Painting - Fictional Company"
            snapshot["proposal"]["recipient"] = "Fictional Niño Offices"
        pdf_path = directory / f"{company}.pdf"
        render(snapshot, pdf_path)
        pdf = pdf_path.read_bytes()
        manifest = build_integrity_manifest(snapshot, pdf, revision=3)
        if not verify_integrity_manifest(snapshot, pdf, manifest, revision=3):
            raise AssertionError("Synthetic artifact did not verify")
        (directory / f"{company}.json").write_text(
            json.dumps({"snapshot": snapshot, "manifest": manifest}, sort_keys=True),
            encoding="utf-8",
        )
    print("PASS: three independent, Python-verified fictional PDF artifacts exported")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: proposal_contract_export.py <private-existing-directory>")
    main(Path(sys.argv[1]))
