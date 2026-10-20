"""Strictly synthetic, non-deliverable, multi-company proposal PDF previews.

Pricing and authorization are external prerequisites. No live customer path.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

BANNER = "SYNTHETIC INTERNAL DRAFT - NOT FOR DELIVERY"
CLAIM = re.compile(r"\b(?:licensed|insured|bonded|certified|guaranteed|cslb|testimonial|internal note)\b", re.I)
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
REFERENCE = re.compile(r"^SYN-[A-Z0-9-]{3,35}$")
SERVICE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


def fields(value, required, optional=frozenset()):
    if type(value) is not dict or not set(required).issubset(value) or set(value) - set(required) - set(optional):
        raise ValueError("Missing or unexpected proposal fields")
    return value


def safe_text(value, maximum=240):
    if type(value) is not str or not value.strip() or len(value) > maximum or CLAIM.search(value):
        raise ValueError("Unsupported or unverified proposal text")
    if any(ord(character) < 32 and character not in "\n\t" for character in value):
        raise ValueError("Unsupported control character")
    return value.strip()


def cents(value):
    if type(value) is not int or not 0 <= value <= 10**11:
        raise ValueError("Money must be bounded nonnegative integer cents")
    return value


def entries(value, maximum):
    if type(value) is not list or not 1 <= len(value) <= maximum:
        raise ValueError("Invalid proposal array")
    return value


def money(value):
    return "$" + format(value // 100, ",") + "." + format(value % 100, "02d")


def validated(snapshot):
    data = fields(snapshot, {"kind", "brand", "proposal"})
    if data["kind"] != "synthetic-branded-proposal-preview":
        raise ValueError("Live and deliverable proposals are disabled")
    brand = fields(data["brand"], {"businessName", "primaryHex", "accentHex"})
    safe_text(brand["businessName"], 90)
    if any(type(brand[key]) is not str or not HEX.fullmatch(brand[key])
           for key in ("primaryHex", "accentHex")):
        raise ValueError("Invalid company branding")
    proposal = fields(data["proposal"], {
        "reference", "recipient", "title", "overview", "scope", "lines",
        "subtotalCents", "taxCents", "totalCents", "assumptions", "exclusions", "timeline"
    })
    if type(proposal["reference"]) is not str or not REFERENCE.fullmatch(proposal["reference"]):
        raise ValueError("Only synthetic references are allowed")
    for key, maximum in (("recipient", 120), ("title", 110), ("overview", 550), ("timeline", 300)):
        safe_text(proposal[key], maximum)
    for key in ("assumptions", "exclusions"):
        for value in entries(proposal[key], 12):
            safe_text(value, 220)
    for row in entries(proposal["scope"], 20):
        fields(row, {"area", "work", "completion"})
        for key in ("area", "work", "completion"):
            safe_text(row[key], 200)
    seen = set()
    subtotal = 0
    for row in entries(proposal["lines"], 30):
        fields(row, {"serviceCode", "label", "unit", "units", "unitPriceCents", "lineTotalCents"})
        code = row["serviceCode"]
        if type(code) is not str or not SERVICE.fullmatch(code) or code in seen:
            raise ValueError("Invalid or repeated service")
        seen.add(code)
        safe_text(row["label"], 100)
        safe_text(row["unit"], 30)
        units = row["units"]
        if type(units) is not int or not 1 <= units <= 100000:
            raise ValueError("Invalid units")
        rate = cents(row["unitPriceCents"])
        line = cents(row["lineTotalCents"])
        if units * rate != line:
            raise ValueError("Invalid extended line amount")
        subtotal += line
    if subtotal != cents(proposal["subtotalCents"]) or (
        subtotal + cents(proposal["taxCents"]) != cents(proposal["totalCents"])
    ):
        raise ValueError("Inconsistent proposed totals")
    return data


def render(snapshot, destination: Path) -> None:
    data = validated(snapshot)  # No file is created before every field is checked.
    brand, proposal = data["brand"], data["proposal"]
    primary = colors.HexColor(brand["primaryHex"])
    accent = colors.HexColor(brand["accentHex"])
    base = ParagraphStyle("base", fontName="Helvetica", fontSize=9.4, leading=14,
                          textColor=colors.HexColor("#233442"), spaceAfter=3)
    small = ParagraphStyle("small", parent=base, fontSize=8, leading=11)
    title = ParagraphStyle("title", parent=base, fontName="Helvetica-Bold",
                           fontSize=18, leading=23, textColor=primary, spaceAfter=9)
    section = ParagraphStyle("section", parent=base, fontName="Helvetica-Bold",
                             fontSize=11, leading=15, textColor=primary,
                             spaceBefore=10, spaceAfter=4)
    cell = ParagraphStyle("cell", parent=base, fontSize=7.8, leading=10.5, spaceAfter=0)
    head = ParagraphStyle("head", parent=cell, fontName="Helvetica-Bold", textColor=colors.white)

    def para(value, style=base):
        return Paragraph(escape(str(value)).replace("\n", " "), style)

    def table(rows, widths):
        result = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
        result.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), primary),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f3f5f6")]),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d6d9dc")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return result

    story = [
        para(brand["businessName"], title),
        para("Commercial Service Proposal | INTERNAL SYNTHETIC PREVIEW", small),
        Spacer(1, 10),
        para("Prepared for: " + proposal["recipient"]),
        para("Reference: " + proposal["reference"], small),
        para(proposal["title"], section),
        para("1. Overview", section),
        para(proposal["overview"]),
        para("2. Scope of Work", section),
    ]
    scope = [[para(label, head) for label in ("Area", "Work performed", "Completion standard")]]
    scope.extend([para(row[key], cell) for key in ("area", "work", "completion")]
                 for row in proposal["scope"])
    story += [table(scope, [104, 208, 210]), para("3. Service Options", section)]
    amounts = [[para(label, head) for label in ("Service", "Qty", "Unit", "Unit price", "Amount")]]
    amounts.extend([para(row["label"], cell), para(row["units"], cell),
                    para(row["unit"], cell), para(money(row["unitPriceCents"]), cell),
                    para(money(row["lineTotalCents"]), cell)] for row in proposal["lines"])
    story += [table(amounts, [194, 42, 74, 106, 106]), Spacer(1, 5),
              para("Subtotal: " + money(proposal["subtotalCents"])),
              para("Tax: " + money(proposal["taxCents"])),
              para("Total: " + money(proposal["totalCents"]), section),
              para("4. Service Expectations", section),
              para("Scheduling, access and completion standards require contractor confirmation."),
              para("5. Assumptions", section)]
    story.extend(para("- " + x) for x in proposal["assumptions"])
    story.append(para("6. Exclusions", section))
    story.extend(para("- " + x) for x in proposal["exclusions"])
    story += [para("7. Timeline", section), para(proposal["timeline"]),
              para("8. Acceptance (disabled)", section),
              para("This synthetic document cannot be signed, published, or sent to a customer.", small)]
    destination.parent.mkdir(parents=True, exist_ok=True)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(accent)
        canvas.line(45, 40, 567, 40)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.setFillColor(colors.HexColor("#943d35"))
        canvas.drawString(45, 27, BANNER)
        canvas.drawRightString(567, 27, "Page " + str(doc.page))
        canvas.restoreState()

    pdf = SimpleDocTemplate(str(destination), pagesize=letter,
                            leftMargin=45, rightMargin=45, topMargin=40, bottomMargin=53,
                            title="Synthetic " + proposal["reference"] + " - NOT FOR DELIVERY",
                            author="BidMason Internal Fixture QA")
    pdf.build(story, onFirstPage=footer, onLaterPages=footer)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    render(json.loads(args.input.read_text(encoding="utf-8")), args.output)


if __name__ == "__main__":
    main()
