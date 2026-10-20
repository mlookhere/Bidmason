"""Required cross-company proposal PDF positive and negative QA."""
import copy
import json
import sys
import tempfile
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.render_branded_proposal_pdf import BANNER, render


def reject(snapshot, change, directory, name):
    candidate = copy.deepcopy(snapshot)
    change(candidate)
    target = directory / (name + ".pdf")
    try:
        render(candidate, target)
    except (ValueError, TypeError):
        if target.exists():
            raise AssertionError("Rejected proposal wrote a file: " + name)
    else:
        raise AssertionError("Unsafe proposal accepted: " + name)


def check(path, snapshot):
    pdf = fitz.open(path)
    if not 1 <= pdf.page_count <= 4 or path.stat().st_size < 2500:
        raise AssertionError("No substantive proposal pages")
    full = "\n".join(page.get_text() for page in pdf)
    required = (snapshot["brand"]["businessName"], snapshot["proposal"]["recipient"],
                snapshot["proposal"]["reference"], "1. Overview", "2. Scope of Work",
                "3. Service Options", "4. Service Expectations", "5. Assumptions",
                "6. Exclusions", "7. Timeline", "8. Acceptance (disabled)",
                "Total:", "NOT FOR DELIVERY")
    for item in required:
        if item not in full:
            raise AssertionError("Missing proposal content: " + item)
    if any(word in full.lower() for word in
           ("licensed and insured", "internal note", "cslb #", "customer approved", "click to send")):
        raise AssertionError("An unverified claim or internal note escaped into the PDF")
    for page in pdf:
        if BANNER not in page.get_text():
            raise AssertionError("Page without synthetic-only warning")
        for word in page.get_text("words"):
            x0, y0, x1, y1 = word[:4]
            if x0 < 25 or y0 < 13 or x1 > page.rect.width - 24 or y1 > page.rect.height - 15:
                raise AssertionError("Text outside printable bounds")
        raster = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        if raster.width < 800 or raster.height < 1100:
            raise AssertionError("Failed to rasterize the whole PDF page")
    return pdf.page_count


def main():
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        for company in ("painting", "cleaning"):
            snapshot = json.loads((ROOT / "fixtures" /
                                   ("synthetic_" + company + "_proposal.json")).read_text())
            result = directory / (company + ".pdf")
            render(snapshot, result)
            print("PASS:", company, "pages:", check(result, snapshot))
            mutations = [
                ("live", lambda x: x.update(kind="approved-customer-proposal")),
                ("approval", lambda x: x["proposal"].update(approved=True)),
                ("notes", lambda x: x["proposal"].update(internalNote="secret")),
                ("asset", lambda x: x["brand"].update(logoUrl="https://example.invalid")),
                ("subtotal", lambda x: x["proposal"].update(subtotalCents=1)),
                ("tax", lambda x: x["proposal"].update(taxCents=100)),
                ("line", lambda x: x["proposal"]["lines"][0].update(lineTotalCents=5)),
                ("boolean", lambda x: x["proposal"]["lines"][0].update(units=True)),
                ("duplicate", lambda x: x["proposal"]["lines"].append(x["proposal"]["lines"][0])),
                ("claim", lambda x: x["proposal"].update(overview="Licensed and insured")),
                ("reference", lambda x: x["proposal"].update(reference="CUSTOMER-QUOTE")),
                ("color", lambda x: x["brand"].update(primaryHex="#bad")),
                ("scope", lambda x: x["proposal"].update(scope=[])),
                ("lines", lambda x: x["proposal"].update(lines=[])),
            ]
            for name, mutation in mutations:
                reject(snapshot, mutation, directory, company + "-" + name)
        print("PASS: 2 company PDFs; 28 denied inputs; all pages inspected")


if __name__ == "__main__":
    main()
