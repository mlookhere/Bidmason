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
    for company in ("painting", "cleaning", "painting-unicode", "painting-v4"):
        fixture = "painting" if company in ("painting-unicode", "painting-v4") else company
        snapshot = json.loads((ROOT / "fixtures" /
                               f"synthetic_{fixture}_proposal.json").read_text(encoding="utf-8"))
        if company == "painting-unicode":
            snapshot["brand"]["businessName"] = "Café Painting - Fictional Company"
            snapshot["proposal"]["recipient"] = "Fictional Niño Offices"
        if company == "painting-v4":
            # Same proposal/company, new revision with a scope and unit-price change.
            snapshot["proposal"]["scope"][0]["work"] = "Prepare and repaint newly measured vacant units"
            first = snapshot["proposal"]["lines"][0]
            first["unitPriceCents"] = 46250
            first["lineTotalCents"] = 92500
            snapshot["proposal"]["subtotalCents"] = 104500
            snapshot["proposal"]["totalCents"] = 104500
        revision = 4 if company == "painting-v4" else 3
        pdf_path = directory / f"{company}.pdf"
        render(snapshot, pdf_path)
        pdf = pdf_path.read_bytes()
        manifest = build_integrity_manifest(snapshot, pdf, revision=revision)
        if not verify_integrity_manifest(snapshot, pdf, manifest, revision=revision):
            raise AssertionError("Synthetic artifact did not verify")
        (directory / f"{company}.json").write_text(
            json.dumps({"snapshot": snapshot, "manifest": manifest}, sort_keys=True),
            encoding="utf-8",
        )
    print("PASS: four Python-verified fictional PDFs, including revision 4, exported")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: proposal_contract_export.py <private-existing-directory>")
    main(Path(sys.argv[1]))
