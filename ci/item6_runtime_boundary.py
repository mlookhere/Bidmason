"""Keep offline Item 6 simulations out of future live-facing server handlers.

Static guard only. It is deliberately conservative for local module imports;
real Auth/RLS, source authentication, provider integrations and go-live review
remain blocked under H01-H13. Do not treat passing as release authorization.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
EXCLUDED_DIRS = {".git", ".next", "node_modules", ".venv", "__pycache__", "dist", "build"}
# These modules explicitly accept fabricated, caller-supplied facts or run
# volatile in-memory state. None can establish actual send/view authorization.
FORBIDDEN = (
    "lib/synthetic-", "lib/delivery-lab-fixtures",
    "lib/outbound-preflight", "lib/delivery-event-projection",
    "lib/delivery-triage", "lib/delivery-review-summary",
    "lib/recipient-suppression-history", "lib/recipient-aware-delivery-triage",
    "lib/follow-up-assessment", "lib/buyer-view-grant",
    "lib/buyer-response-draft",
)
# Handle ESM imports, exports, import type, multiline named imports and
# side-effect imports. Comments are not a reliable source parser: conservative
# false positives fail CI rather than silently admitting an unsafe dependency.
FROM = re.compile(
    r"\b(?:import|export)\s+(?:(?!;)[\s\S]){0,800}?\bfrom\s*"
    r"(['\"])([^'\"\r\n]+)\1"
)
SIDE_EFFECT = re.compile(r"\bimport\s*(['\"])([^'\"\r\n]+)\1")
CALL = re.compile(r"\b(?:import|require)\s*\(\s*([^)]*?)\s*\)")
LITERAL = re.compile(r"^(['\"])([^'\"]+)\1$")
SERVER_ACTION = re.compile(r"(?m)^\s*['\"]use server['\"]\s*;?\s*$")


# This exact public development preview deliberately renders offline models.
# Every other page/layout shares normal live deployment reachability. The
# publishing guard separately pins and audits the fictional preview page.
PREVIEW_ENTRIES = {"app/delivery-lab/page.tsx", "src/app/delivery-lab/page.tsx"}
APP_ENTRY_STEMS = {
    "route", "page", "layout", "template", "default", "error", "global-error",
    "loading", "not-found",
}
GLOBAL_STEMS = {"middleware", "instrumentation", "proxy"}


def _entrypoints(root: Path) -> list[Path]:
    found = []
    for p in root.rglob("*"):
        if (not p.is_file() or p.suffix not in SOURCE_SUFFIXES
                or any(x in EXCLUDED_DIRS for x in p.relative_to(root).parts)):
            continue
        rel = p.relative_to(root).as_posix()
        pieces = rel.split("/")
        if rel in PREVIEW_ENTRIES:
            # A future server-action directive on the public preview removes
            # this exception rather than quietly opening a write-capable path.
            if not SERVER_ACTION.search(p.read_text(encoding="utf-8")):
                continue
        is_app = ((len(pieces) >= 2 and pieces[0] == "app")
                  or (len(pieces) >= 3 and pieces[:2] == ["src", "app"]))
        is_pages = ((len(pieces) >= 2 and pieces[0] == "pages")
                    or (len(pieces) >= 3 and pieces[:2] == ["src", "pages"]))
        # Next.js pages and layouts are server-rendered entrypoints by
        # default; guarding only API handlers leaves a real execution path.
        is_live_render = (is_app and p.stem in APP_ENTRY_STEMS) or is_pages
        is_global = rel in {
            f"{prefix}{stem}{suffix}"
            for prefix in ("", "src/")
            for stem in GLOBAL_STEMS
            for suffix in SOURCE_SUFFIXES
        }
        if is_live_render or is_global or SERVER_ACTION.search(
            p.read_text(encoding="utf-8")
        ):
            found.append(p)
    return sorted(found)


def _imports(source: str) -> tuple[set[str], bool]:
    imports = {m.group(2) for pattern in (FROM, SIDE_EFFECT)
               for m in pattern.finditer(source)}
    unknown_dynamic = False
    for match in CALL.finditer(source):
        literal = LITERAL.fullmatch(match.group(1).strip())
        if literal:
            imports.add(literal.group(2))
        else:
            unknown_dynamic = True
    return imports, unknown_dynamic


def _resolve(root: Path, owner: Path, spec: str) -> Path | None:
    if spec.startswith("."):
        stem = owner.parent / spec
    elif spec.startswith("@/") or spec.startswith("~/"):
        stem = root / spec[2:]
    elif spec.startswith("lib/") or spec.startswith("src/"):
        stem = root / spec
    else:
        return None  # external packages cannot resolve to our local fixtures
    candidates = [stem]
    if stem.suffix not in SOURCE_SUFFIXES:
        candidates = [Path(str(stem) + ext) for ext in SOURCE_SUFFIXES]
        candidates += [stem / ("index" + ext) for ext in SOURCE_SUFFIXES]
    for candidate in candidates:
        resolved = candidate.resolve()
        if not resolved.is_relative_to(root.resolve()):
            raise ValueError("Local source import escaped repository root")
        if resolved.is_file() and resolved.suffix in SOURCE_SUFFIXES:
            return resolved
    if stem.suffix in (".css", ".json", ".svg", ".png", ".jpg", ".scss"):
        return None  # non-executable resources
    raise ValueError("Unresolved local code dependency")


def _is_offline_only(rel: str) -> bool:
    """Recognize protected helpers in either supported Next.js source root.

    A future move from lib/ to src/lib/ must not remove an existing guard;
    both source layouts can coexist and must be covered at the same time.
    """
    project_relative = rel.removeprefix("src/")
    return any(project_relative.startswith(prefix) for prefix in FORBIDDEN)


def findings(root: Path = ROOT) -> list[str]:
    """Fail live server entrypoints closed on simulated imports and ambiguity."""
    root = root.resolve()
    violations: set[str] = set()
    for entry in _entrypoints(root):
        pending = [entry]
        visited: set[Path] = set()
        while pending:
            path = pending.pop()
            if path in visited:
                continue
            visited.add(path)
            rel = path.relative_to(root).as_posix()
            if _is_offline_only(rel):
                violations.add(f"{entry.relative_to(root).as_posix()} imports offline-only {rel}")
                continue
            specs, dynamic = _imports(path.read_text(encoding="utf-8"))
            if dynamic:
                violations.add(f"{path.relative_to(root).as_posix()} has unreviewed dynamic module loading")
            for spec in sorted(specs):
                try:
                    child = _resolve(root, path, spec)
                except ValueError as error:
                    violations.add(f"{path.relative_to(root).as_posix()}: {error} ({spec})")
                    continue
                if child is not None:
                    pending.append(child)
    return sorted(violations)


def main() -> int:
    problems = findings()
    if problems:
        for problem in problems:
            print("FAIL: Item 6 runtime boundary: " + problem)
        return 1
    print("PASS: Item 6 offline models have no known live server import path; no production authorization implied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
