"""Independent PDF smoke: real binary render, extraction, geometry and negative guards."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.render_demo_pdf import render


def main():
    snapshot = json.loads((ROOT / "fixtures/demo_snapshot.json").read_text())
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "synthetic-demo.pdf"
        render(snapshot, target)
        if target.stat().st_size < 2000:
            raise AssertionError("PDF not meaningfully rendered")
        document = fitz.open(target)
        if document.page_count != 2:
            raise AssertionError(f"Unexpected proposal pagination: {document.page_count}")
        text = "\n".join(page.get_text() for page in document)
        for required in (
            "SYNTHETIC DEMO - NOT FOR DELIVERY", "1. Overview", "2. Scope of Work",
            "3. Service Options", "4. Service Expectations", "5. Assumptions",
            "6. Exclusions", "7. Timeline", "8. Acceptance", "Heavy-condition surcharge",
            "$450.00", "$540.00", "Terms pending owner approval",
        ):
            if required not in text:
                raise AssertionError(f"Missing rendered proposal text: {required}")
        for forbidden in ("$360.00", "CSLB #", "Licensed and insured", "Internal Note", "Included; $0 additional", "■", "☐"):
            if forbidden.lower() in text.lower():
                raise AssertionError(f"Forbidden source/claim/glyph in rendered proposal: {forbidden}")
        for page in document:
            if "NOT FOR DELIVERY" not in page.get_text():
                raise AssertionError("Demo warning missing on a page")
            for word in page.get_text("words"):
                left, top, right, bottom = word[:4]
                if left < 25 or top < 15 or right > page.rect.width - 24 or bottom > page.rect.height - 15:
                    raise AssertionError(f"Text outside printable page: {word}")
            bitmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            if bitmap.width < 750 or bitmap.height < 1000:
                raise AssertionError("PDF page failed to render at expected size")
        # The acceptance option marks are real unfilled vector rectangles, not font squares.
        squares = 0
        for entry in document[-1].get_drawings():
            for item in entry["items"]:
                if item[0] == "re":
                    rect = item[1]
                    if abs(rect.width - 11) <= 1 and abs(rect.height - 11) <= 1:
                        squares += 1
        if squares < 3:
            raise AssertionError("Expected three vector empty option boxes")
        invalid = json.loads(json.dumps(snapshot))
        invalid["quarterly"]["included"] = True
        invalid["quarterly"]["additionalCents"] = 47500
        try:
            render(invalid, Path(directory) / "must-not-exist.pdf")
        except ValueError:
            pass
        else:
            raise AssertionError("Contradictory included/billed quarterly fixture was accepted")
        if (Path(directory) / "must-not-exist.pdf").exists():
            raise AssertionError("Invalid proposal generated a PDF")
    print("PASS: 2 rendered PDF pages; pricing/scope/claims, page geometry, vector option boxes and fail-closed quarterly pricing")


if __name__ == "__main__":
    main()