"""Required cross-company proposal PDF positive and negative QA."""
import copy
import json
import sys
from unittest.mock import patch
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


def check(path, snapshot, max_pages=4):
    pdf = fitz.open(path)
    if not 1 <= pdf.page_count <= max_pages or path.stat().st_size < 2500:
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



def check_atomic_output(snapshot, directory):
    # A previous PDF or symlink must never be replaced by a revised preview.
    existing = directory / "existing.pdf"
    existing.write_bytes(b"prior stable PDF bytes")
    try:
        render(snapshot, existing)
    except FileExistsError:
        pass
    else:
        raise AssertionError("A previous preview was silently overwritten")
    if existing.read_bytes() != b"prior stable PDF bytes":
        raise AssertionError("Existing preview was corrupted")

    alias = directory / "preview-alias.pdf"
    alias.symlink_to(existing)
    try:
        render(snapshot, alias)
    except FileExistsError:
        pass
    else:
        raise AssertionError("A preview symlink was accepted")
    if not alias.is_symlink() or existing.read_bytes() != b"prior stable PDF bytes":
        raise AssertionError("Symlink target or entry was modified")

    # Failed ReportLab rendering must not publish a partial destination.
    target = directory / "partial.pdf"
    def fail_build(*args, **kwargs):
        raise RuntimeError("Synthetic render interruption")
    with patch("scripts.render_branded_proposal_pdf.SimpleDocTemplate.build", fail_build):
        try:
            render(snapshot, target)
        except RuntimeError as exc:
            if str(exc) != "Synthetic render interruption":
                raise
        else:
            raise AssertionError("Expected synthetic write failure")
    if target.exists() or list(directory.glob(".bidmason-preview-*.pdf")):
        raise AssertionError("Interrupted render left temporary or published PDF")


def check_long_pdf(snapshot, directory):
    # Maximal schema-sized source: 20 scope rows, 30 lines, 12 assumptions
    # and 12 exclusions. Exercise repeated headers and all-page geometry.
    large = copy.deepcopy(snapshot)
    proposal = large["proposal"]
    proposal["reference"] = "SYN-LONG-FORM-001"
    proposal["scope"] = [
        {"area": f"Zone {i:02}",
         "work": ("Surface preparation and cleaning " * 6).strip(),
         "completion": ("Visual walkthrough and checklist " * 5).strip()}
        for i in range(1, 21)
    ]
    proposal["lines"] = [
        {"serviceCode": f"service_{i:02}",
         "label": f"Service line item {i:02} " + "expanded display " * 4,
         "unit": "visit", "units": 1,
         "unitPriceCents": 1234, "lineTotalCents": 1234}
        for i in range(1, 31)
    ]
    proposal["subtotalCents"] = 30 * 1234
    proposal["taxCents"] = 0
    proposal["totalCents"] = 30 * 1234
    proposal["assumptions"] = [
        "Worksite access and staging " + "subject to site review " * 5
        for _ in range(12)
    ]
    proposal["exclusions"] = [
        "Unlisted equipment and site remediation " + "excluded from scope " * 5
        for _ in range(12)
    ]
    target = directory / "max-input-size.pdf"
    render(large, target)
    pages = check(target, large, max_pages=8)
    if pages < 3:
        raise AssertionError("Expected a genuine multipage stress fixture")
    with fitz.open(target) as pdf:
        text = "\n".join(page.get_text() for page in pdf)
        for index in range(1, 31):
            if f"Service line item {index:02}" not in text:
                raise AssertionError(f"Long-form service {index:02} disappeared")
        for index in range(1, 21):
            if f"Zone {index:02}" not in text:
                raise AssertionError(f"Long-form scope area {index:02} disappeared")
        if "Service" not in pdf[2].get_text() or "Amount" not in pdf[2].get_text():
            raise AssertionError("Split pricing table lost its repeated header")
    return pages



def check_integrity_manifest(directory):
    from scripts.proposal_artifact_integrity import (
        build_integrity_manifest, verify_integrity_manifest,
    )

    snapshots = [
        json.loads((ROOT / "fixtures" / f"synthetic_{company}_proposal.json").read_text())
        for company in ("painting", "cleaning")
    ]
    pdfs = []
    manifests = []
    for index, snapshot in enumerate(snapshots):
        path = directory / f"manifest-fixture-{index}.pdf"
        render(snapshot, path)
        pdf = path.read_bytes()
        manifest = build_integrity_manifest(snapshot, pdf, revision=3)
        if not verify_integrity_manifest(snapshot, pdf, manifest, revision=3):
            raise AssertionError("Untampered manifest did not verify")
        pdfs.append(pdf)
        manifests.append(manifest)

    denied = [
        (snapshots[0], pdfs[1], manifests[0], 3),  # Foreign company PDF
        (snapshots[1], pdfs[0], manifests[0], 3),  # Foreign company input
        (snapshots[0], pdfs[0] + b"tail", manifests[0], 3),
        (snapshots[0], pdfs[0][:-1], manifests[0], 3),
        (snapshots[0], pdfs[0], manifests[0], 4),  # Stale exact revision
        (snapshots[0], pdfs[0], {**manifests[0], "approved": True}, 3),
        (snapshots[0], pdfs[0], {**manifests[0], "pdfSha256": "0"*64}, 3),
        (snapshots[0], pdfs[0], {**manifests[0], "pageCount": True}, 3),
        (snapshots[0], pdfs[0], {**manifests[0], "revision": "3"}, 3),
        (snapshots[0], b"", manifests[0], 3),
    ]
    renamed = copy.deepcopy(snapshots[0])
    renamed["proposal"]["recipient"] = "Another Fictional Recipient"
    denied.append((renamed, pdfs[0], manifests[0], 3))
    repriced = copy.deepcopy(snapshots[0])
    repriced["proposal"]["lines"][0]["unitPriceCents"] += 1
    repriced["proposal"]["lines"][0]["lineTotalCents"] += 2
    repriced["proposal"]["subtotalCents"] += 2
    repriced["proposal"]["totalCents"] += 2
    denied.append((repriced, pdfs[0], manifests[0], 3))
    for index, (snapshot, pdf, manifest, revision) in enumerate(denied):
        try:
            verify_integrity_manifest(snapshot, pdf, manifest, revision)
        except ValueError:
            continue
        raise AssertionError(f"Stale or swapped synthetic PDF accepted: {index}")
    for revision in (True, 0, -1, 1000001, 1.5):
        try:
            build_integrity_manifest(snapshots[0], pdfs[0], revision)
        except ValueError:
            continue
        raise AssertionError(f"Invalid synthetic revision accepted: {revision}")
    print(f"PASS: 2 PDF integrity manifests; {len(denied)} altered/stale cases denied; 5 invalid revisions")



def check_pdf_interactive_payloads(snapshot, directory):
    from scripts.proposal_artifact_integrity import build_integrity_manifest

    original = directory / "safe-before-injection.pdf"
    render(snapshot, original)
    clean_pdf = original.read_bytes()
    def mutate(doc, kind):
        if kind == "external-link":
            doc[0].insert_link({"kind": fitz.LINK_URI,
                                "uri": "https://example.invalid/",
                                "from": fitz.Rect(50, 50, 150, 75)})
        elif kind == "annotation":
            doc[0].add_text_annot((50, 50), "secret review note")
        elif kind == "attachment":
            doc.embfile_add("source.txt", b"hidden source payload")
        elif kind == "catalog-script":
            doc.xref_set_key(doc.pdf_catalog(), "OpenAction",
                             "<</S/JavaScript/JS (app.alert(1))>>")
        elif kind == "page-script":
            doc.xref_set_key(doc[0].xref, "AA",
                             "<</O <</S/JavaScript/JS (app.alert(1))>>>>")
        elif kind == "bookmark":
            doc.set_toc([[1, "Unreviewed bookmark", 1]])

    for kind in ("external-link", "annotation", "attachment", "catalog-script", "page-script", "bookmark"):
        with fitz.open(stream=clean_pdf, filetype="pdf") as doc:
            mutate(doc, kind)
            tainted = doc.tobytes()
        try:
            build_integrity_manifest(snapshot, tainted, 3)
        except ValueError:
            continue
        raise AssertionError(f"Embedded PDF payload accepted with a newly computed manifest: {kind}")
    print("PASS: 6 embedded PDF payloads rejected before manifest creation")


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
        sample = json.loads((ROOT / "fixtures/synthetic_painting_proposal.json").read_text())
        check_atomic_output(sample, directory)
        pages = check_long_pdf(sample, directory)
        check_integrity_manifest(directory)
        check_pdf_interactive_payloads(sample, directory)
        print(f"PASS: 2 company PDFs; 28 denied inputs; {pages}-page stress PDF; atomic writes")


if __name__ == "__main__":
    main()
