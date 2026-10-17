"""Render one non-deliverable synthetic proposal from an already priced JSON snapshot.

No pricing calculations, credential claims or user-controlled HTML markup are accepted.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, Flowable, PageBreak

NAVY = colors.HexColor("#142b3b")
GOLD = colors.HexColor("#b68145")
INK = colors.HexColor("#233442")
PALE = colors.HexColor("#f5f1eb")
BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=14, textColor=INK)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8, leading=11)
H1 = ParagraphStyle("title", parent=BODY, fontName="Helvetica-Bold", fontSize=19, leading=24, textColor=NAVY)
H2 = ParagraphStyle("section", parent=BODY, fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=15, spaceAfter=7)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8, leading=11)
CELL_HEAD = ParagraphStyle("cellhead", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)


def dollars(cents: int) -> str:
    if not isinstance(cents, int) or cents < 0:
        raise ValueError("Already priced input must use nonnegative integer cents")
    return f"\u0024{cents // 100:,}.{cents % 100:02d}"


class OptionSquares(Flowable):
    def __init__(self, labels: list[str]):
        super().__init__()
        self.labels = labels
        self.width, self.height = 510, 22 * len(labels)

    def draw(self):
        for i, label in enumerate(self.labels):
            y = self.height - 15 - i * 22
            self.canv.setStrokeColor(NAVY)
            self.canv.setLineWidth(1)
            self.canv.rect(1, y, 11, 11, fill=0, stroke=1)
            self.canv.setFont("Helvetica", 9)
            self.canv.setFillColor(INK)
            self.canv.drawString(21, y + 1, label)


def render(snapshot: dict, destination: Path) -> None:
    if snapshot.get("kind") != "synthetic-demo-not-for-delivery":
        raise ValueError("Only approved synthetic fixture input is supported")
    programs = snapshot["programs"]
    quarterly = snapshot["quarterly"]
    if len(programs) != 3 or not quarterly.get("fixtureAssumptionOnly"):
        raise ValueError("Three simulated tiers and explicit quarterly assumption required")
    if quarterly["included"] and quarterly["additionalCents"]:
        raise ValueError("Quarterly touch-up is both included and billed")
    if quarterly.get("status") != "pending-owner-approval" or quarterly.get("included") is not None or quarterly.get("additionalCents") is not None:
        raise ValueError("Unapproved quarterly terms must remain unspecified")

    story = [
        Paragraph(escape(snapshot["business"]).upper(), H1),
        Paragraph("Commercial unit-turn proposal | INTERNAL SYNTHETIC DEMO", SMALL),
        Spacer(1, 18),
        Paragraph(f"Prepared for: {escape(snapshot['prospect'])}", BODY),
        Paragraph(f"Reference: {escape(snapshot['proposalId'])}", SMALL),
        Paragraph("1. Overview", H2),
        Paragraph("Illustrative painting programs for vacant apartment units. Scope, rates and policy assumptions require contractor approval before any external use.", BODY),
        Paragraph("2. Scope of Work", H2),
    ]
    for item in snapshot["scope"]:
        story.append(Paragraph("- " + escape(item), BODY))
    story.append(Paragraph("3. Service Options", H2))
    header = [Paragraph("Unit / service", CELL_HEAD)] + [Paragraph(escape(item["name"]), CELL_HEAD) for item in programs]
    data = [header]
    for name, key in (("Studio", "studioCents"), ("1 Bedroom", "oneBedCents"), ("2 Bedroom", "twoBedCents")):
        data.append([Paragraph(name, CELL)] + [Paragraph(dollars(item[key]), CELL) for item in programs])
    data.append([Paragraph("Heavy-condition surcharge", CELL)] + [Paragraph("+40% of base before discount / minimum", CELL)] * 3)
    data.append([Paragraph("Quarterly common-area touch-up", CELL), Paragraph("Quoted separately", CELL), Paragraph("Quoted separately", CELL), Paragraph("Terms pending owner approval", CELL)])
    table = Table(data, colWidths=[120, 125, 125, 125], repeatRows=1, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("GRID", (0, 0), (-1, -1), .4, colors.HexColor("#d6d8d9")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([table, Spacer(1, 7)])
    story.append(Paragraph(
        "Synthetic pricing fixture: after discount, all unit rates respect the $450 minimum. "
        "The historic standalone touch-up rate was $475 per visit. Whether the Full Property tier "
        "includes this service or bills it separately is UNRESOLVED. No price or inclusion "
        "for that tier is approved for customer use.", SMALL))
    story.append(Paragraph("4. Service Expectations", H2))
    story.append(Paragraph("Confirm notice, crew access, insurance documents and safety prerequisites before work. A 48-hour target is not a guarantee.", BODY))
    story.append(PageBreak())
    story.append(Paragraph("5. Assumptions", H2))
    for item in snapshot["assumptions"]:
        story.append(Paragraph("- " + escape(item), BODY))
    story.append(Paragraph("6. Exclusions", H2))
    for item in snapshot["exclusions"]:
        story.append(Paragraph("- " + escape(item), BODY))
    story.append(Paragraph("7. Timeline", H2))
    story.append(Paragraph("Scheduling to be confirmed in writing after site and owner review.", BODY))
    story.append(KeepTogether([
        Paragraph("8. Acceptance (disabled for demo)", H2),
        OptionSquares(["As-Needed Turns", "Reserved Turn Program", "Full Property Program"]),
        Paragraph("Not valid for signature, payment or customer delivery. This is a visual QA artifact only.", SMALL),
    ]))

    destination.parent.mkdir(parents=True, exist_ok=True)
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(1.5)
        canvas.line(45, 40, 567, 40)
        canvas.setFillColor(colors.HexColor("#8b3f37"))
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.drawString(45, 28, "SYNTHETIC DEMO - NOT FOR DELIVERY")
        canvas.drawRightString(567, 28, f"Page {doc.page}")
        canvas.restoreState()
    doc = SimpleDocTemplate(str(destination), pagesize=letter, leftMargin=45, rightMargin=45, topMargin=44, bottomMargin=53,
                            title="Harbor Coast Synthetic Proposal - NOT FOR DELIVERY", author="BidMason Demo QA")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    render(json.loads(args.input.read_text(encoding="utf8")), args.output)


if __name__ == "__main__":
    main()