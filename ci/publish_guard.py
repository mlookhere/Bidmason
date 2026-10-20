"""Fail closed on accidental publication of the historical demo or fake lead capture.

Temporary staging policy: this preview has no verified backend. Replace these rules
with tests for a real persisted intake before deliberately enabling public forms.
"""
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PUBLISHABLE = ("app", "pages", "src/app", "src/pages", "public")
LEGACY_NAMES = frozenset({
    "bidmason-website.html",
    "04-website-harbor-coast.html",
    "make_proposal_pdf.py",
    "harbor-coast-proposal-unit-turn-program-v2026-06-11.pdf",
})


# Static drift prevention for the PUBLIC, fictional delivery lab (not auth).
LAB_ROUTE = "app/delivery-lab/page.tsx"
LAB_FIXTURE = "lib/delivery-lab-fixtures.ts"
LAB_IMPORTS = {
    LAB_ROUTE: {"next", "../../lib/delivery-lab-fixtures.ts"},
    LAB_FIXTURE: {
        "./outbound-preflight.ts", "./follow-up-assessment.ts",
        "./delivery-event-projection.ts", "./recipient-aware-delivery-triage.ts",
        "./recipient-suppression-history.ts", "./delivery-review-summary.ts",
    },
}
LAB_IMPORT = re.compile(
    r"^\s*import\s+(?!\()(.*?)\s+from\s+['\"]([^'\"]+)['\"]\s*;",
    re.M | re.S,
)
LAB_UNSAFE = re.compile(
    r"(?i)(?:"
    r"['\"]use client['\"]|['\"]use server['\"]|"
    r"\b(?:fetch|eval|XMLHttpRequest|WebSocket|EventSource|sendBeacon|"
    r"localStorage|sessionStorage|setTimeout|setInterval|cookies|headers|"
    r"searchParams|prisma|supabase|createClient|readFile|writeFile|"
    r"process\.env|globalThis)\b|"
    r"\b(?:require|import)\s*\(|"
    r"<\s*(?:form|input|textarea|button|select)\b|"
    r"\b(?:onSubmit|formAction|action)\s*=|https?://)"
)
LAB_EMAIL = re.compile(r"[a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,}", re.I)



# Review the COMPLETE runtime import chain reachable from the public lab.
# Direct-only allowlisting is insufficient: a trusted helper can import an
# unreviewed dependency or introduce a side-effect after the page is approved.
# These exact specifiers are review checkpoints, not a proof of JS purity.
LAB_TRANSITIVE_IMPORTS = {
    "lib/outbound-preflight.ts": {"node:crypto"},
    "lib/delivery-event-projection.ts": {"./outbound-preflight.ts"},
    "lib/follow-up-assessment.ts": {
        "./outbound-preflight.ts", "./delivery-event-projection.ts",
    },
    "lib/delivery-triage.ts": {
        "./outbound-preflight.ts", "./follow-up-assessment.ts",
        "./delivery-event-projection.ts",
    },
    "lib/recipient-suppression-history.ts": {
        "./outbound-preflight.ts", "./delivery-event-projection.ts",
    },
    "lib/recipient-aware-delivery-triage.ts": {
        "./outbound-preflight.ts", "./delivery-event-projection.ts",
        "./follow-up-assessment.ts", "./delivery-triage.ts",
        "./recipient-suppression-history.ts",
    },
    "lib/delivery-review-summary.ts": {
        "./outbound-preflight.ts", "./delivery-event-projection.ts",
        "./follow-up-assessment.ts", "./delivery-triage.ts",
        "./recipient-aware-delivery-triage.ts",
        "./recipient-suppression-history.ts",
    },
}
LAB_REEXPORT = re.compile(r"\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s*['\"]", re.S)


def lab_dependency_findings(root: Path) -> list[str]:
    """Reject drift in any indirect module the public fictional lab executes."""
    problems: list[str] = []
    for relative, expected in LAB_TRANSITIVE_IMPORTS.items():
        path = root / relative
        if path.is_symlink() or not path.is_file():
            problems.append(f"Missing or symlinked lab dependency: {relative}")
            continue
        source = path.read_text(encoding="utf-8", errors="replace")
        imports = list(LAB_IMPORT.finditer(source))
        count = len(re.findall(r"(?m)^\s*import\b", source))
        actual = [match.group(2) for match in imports]
        if (count != len(imports) or set(actual) != expected
                or len(actual) != len(expected) or LAB_REEXPORT.search(source)):
            problems.append(f"Unreviewed public lab transitive imports: {relative}")
        if LAB_UNSAFE.search(source):
            problems.append(f"Public lab dependency must remain offline and read-only: {relative}")
        for address in LAB_EMAIL.findall(source):
            if not address.lower().endswith((".example", ".test", ".invalid", ".localhost")):
                problems.append(f"Nonfictional email in public lab dependency: {relative}")
    return problems


def delivery_lab_findings(root: Path) -> list[str]:
    """Require explicit review before adding dynamic inputs or actions to the lab.

    Conservative source checks only; not a data-flow proof or tenant security.
    """
    route = root / LAB_ROUTE
    fixture = root / LAB_FIXTURE
    if not route.exists() and not fixture.exists():
        return []
    if (not route.is_file() or not fixture.is_file()
            or route.is_symlink() or fixture.is_symlink()):
        return ["Public delivery lab requires fixed non-symlink fixture and route"]
    errors: list[str] = []
    for extra in (root / "app/delivery-lab").rglob("*"):
        if extra.is_file() and extra != route:
            errors.append(f"Unreviewed public delivery lab route asset: {extra.relative_to(root)}")
    for relative, allowed in LAB_IMPORTS.items():
        source = (root / relative).read_text(encoding="utf-8", errors="replace")
        imports = list(LAB_IMPORT.finditer(source))
        count = len(re.findall(r"(?m)^\s*import\b", source))
        if count != len(imports) or {m.group(2) for m in imports} != allowed:
            errors.append(f"Unreviewed public delivery lab imports: {relative}")
        if LAB_UNSAFE.search(source):
            errors.append(f"Public delivery lab must remain offline and read-only: {relative}")
        for address in LAB_EMAIL.findall(source):
            if not address.lower().endswith((".example", ".test", ".invalid", ".localhost")):
                errors.append(f"Nonfictional email in public delivery lab: {relative}")
    page = route.read_text(encoding="utf-8")
    for marker in ("index: false", "follow: false", "Synthetic records only",
                   "not access controlled", "Delivery remains disabled"):
        if marker not in page:
            errors.append(f"Public delivery lab missing safety marker: {marker}")
    source = fixture.read_text(encoding="utf-8")
    companies = re.findall(r"\bcompany\s*:\s*['\"]([^'\"]+)['\"]", source)
    if len(companies) != 5 or any(not c.startswith("Fictional ") for c in companies):
        errors.append("Public delivery lab requires exactly five fictional scenarios")
    if ("buildSyntheticDeliveryLabCases" not in source
            or "assessSimulatedFollowUp" not in source
            or "classifySimulatedRecipientAwareTriage" not in source):
        errors.append("Public delivery lab must use reviewed offline projections")
    errors.extend(lab_dependency_findings(root))
    return errors


# No authenticated live backend is approved for the Item 6 development preview.
# Conservative CI drift protection; this is not proof of tenant security.
NEXT_SOURCE_ROOTS = ("app", "src/app", "pages", "src/pages")
ROUTE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts")
SERVER_ENTRYPOINTS = ("middleware", "proxy", "instrumentation")
SERVER_ACTION_MARKER = re.compile(r"""['"]use server['"]""")
FORM_ACTION_MARKER = re.compile(r"<\s*form\b[^>]*\baction\s*=|\bformAction\s*=", re.I | re.S)


def outbound_endpoint_findings(root: Path) -> list[str]:
    """Fail closed on unreviewed Next HTTP routes, actions and request hooks."""
    problems: list[str] = []
    for folder in NEXT_SOURCE_ROOTS:
        base = root / folder
        if not base.exists():
            continue
        if base.is_symlink():
            problems.append(f"Symlinked publishable Next root: {folder}")
            continue
        if not base.is_dir():
            continue
        for item in base.rglob("*"):
            relative = item.relative_to(root)
            if item.is_symlink():
                problems.append(f"Symlink in publishable Next tree: {relative}")
                continue
            if not item.is_file() or item.suffix.lower() not in ROUTE_EXTENSIONS:
                continue
            parts = item.relative_to(base).parts
            if (folder.endswith("app") and item.stem.lower() == "route"
                    or folder.endswith("pages") and parts[0].lower() == "api"):
                problems.append(f"Unapproved live Next endpoint: {relative}")
            content = item.read_text(encoding="utf-8", errors="replace")
            if SERVER_ACTION_MARKER.search(content):
                problems.append(f"Unapproved Next server action: {relative}")
            if FORM_ACTION_MARKER.search(content):
                problems.append(f"Unapproved mutating form action: {relative}")
    for base in (root, root / "src"):
        for basename in SERVER_ENTRYPOINTS:
            for suffix in ROUTE_EXTENSIONS:
                entry = base / (basename + suffix)
                if entry.is_symlink() or entry.is_file():
                    problems.append(f"Unapproved Next request handler: {entry.relative_to(root)}")
    return problems



# Next settings can expose rewrites even when route files remain unchanged.
# Deliberately fail closed until real Auth/RLS/provider release approval.
REVIEWED_NEXT_CONFIG = "import type { NextConfig } from \"next\";\n\nconst config: NextConfig = {\n  reactStrictMode: true,\n};\n\nexport default config;\n"
NEXT_CONFIG_VARIANTS = ("next.config.js", "next.config.mjs",
                        "next.config.cjs", "next.config.mts",
                        "next.config.cts", "next.config.ts")


def next_config_findings(root: Path) -> list[str]:
    """Require the exact reviewed static-preview Next config, no shadows."""
    problems: list[str] = []
    config = root / "next.config.ts"
    if not config.is_file() or config.is_symlink():
        problems.append("Missing or symlinked reviewed Next config")
    elif config.read_text(encoding="utf-8") != REVIEWED_NEXT_CONFIG:
        problems.append("Unreviewed Next runtime config drift")
    for name in NEXT_CONFIG_VARIANTS:
        if name == "next.config.ts":
            continue
        alternate = root / name
        if alternate.is_symlink() or alternate.exists():
            problems.append(f"Unreviewed alternate Next config: {name}")
    return problems


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
            if (
                re.search(r"\bpreventdefault\s*\(", content)
                and re.search(r"\b(?:formsuccess|pfsuccess)\b", content)
                and re.search(r"\.classlist\.add\(\s*['\"]show['\"]\s*\)", content)
            ):
                errors.append(f"Potential fake form success in publishable code: {relative}")
    layout = root / "app/layout.tsx"
    page = root / "app/page.tsx"
    if not layout.is_file() or "index: false" not in layout.read_text(encoding="utf-8"):
        errors.append("Development preview must remain noindex")
    if not page.is_file() or "No live lead capture" not in page.read_text(encoding="utf-8"):
        errors.append("Development preview must disclose disabled intake")
    errors.extend(delivery_lab_findings(root))
    errors.extend(outbound_endpoint_findings(root))
    errors.extend(next_config_findings(root))
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
