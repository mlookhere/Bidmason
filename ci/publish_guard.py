"""Fail closed on accidental publication of the historical demo or fake lead capture.

Temporary staging policy: this preview has no verified backend. Replace these rules
with tests for a real persisted intake before deliberately enabling public forms.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISHABLE = ("app", "pages", "src/app", "src/pages", "public")
LEGACY_NAMES = frozenset({
    "bidmason-website.html",
    "04-website-harbor-coast.html",
    "make_proposal_pdf.py",
    "harbor-coast-proposal-unit-turn-program-v2026-06-11.pdf",
})


def findings(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    for folder in PUBLISHABLE:
        base = root / folder
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(root)
            if path.name in LEGACY_NAMES or "historical-source" in path.parts:
                errors.append(f"Historical source in publishable path: {relative}")
            if path.suffix.lower() not in {".html", ".htm", ".js", ".jsx", ".ts", ".tsx"}:
                continue
            content = path.read_text(encoding="utf-8", errors="replace").lower()
            if "preventdefault(" in content and "classlist.add('show')" in content:
                errors.append(f"Potential fake form success in publishable code: {relative}")
    layout = root / "app/layout.tsx"
    page = root / "app/page.tsx"
    if not layout.is_file() or "index: false" not in layout.read_text(encoding="utf-8"):
        errors.append("Development preview must remain noindex")
    if not page.is_file() or "No live lead capture" not in page.read_text(encoding="utf-8"):
        errors.append("Development preview must disclose disabled intake")
    return errors


def main() -> int:
    problems = findings()
    for error in problems:
        print(f"FAIL: {error}")
    if problems:
        return 1
    print("PASS: historical source quarantined and preview limitations enforced")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
