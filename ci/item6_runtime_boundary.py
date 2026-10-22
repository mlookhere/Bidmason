"""Keep offline Item 6 simulations out of future live-facing server handlers.

Static guard only. It is deliberately conservative for local module imports;
real Auth/RLS, source authentication, provider integrations and go-live review
remain blocked under H01-H13. Do not treat passing as release authorization.
"""
from __future__ import annotations

import json
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
# side-effect imports. Import specifier lists have no fixed legal length:
# a previous 800-character limit silently missed valid long import/re-export
# statements and bypassed the offline-only dependency boundary. Stop at the
# statement's first semicolon, never silently stop scanning at a byte budget.
# This is a conservative source scanner rather than a complete TS/JS parser.
# JavaScript treats block comments as lexical space. Ignoring them between
# import/from/require tokens misses real static and dynamic dependencies.
# Keep this separator narrow: the scanner does not claim full JS parsing.
# Consume a complete block comment only through its FIRST closing delimiter;
# do not misinterpret intervening executable import tokens as comment text.
GAP = r"(?:\s|/\*(?:(?!\*/)[\s\S])*\*/)*"
FROM = re.compile(
    r"\b(?:import|export)" + GAP + r"(?:(?!;)[\s\S])*?\bfrom" + GAP
    + r"(['\"])([^'\"\r\n]+)\1"
)
SIDE_EFFECT = re.compile(r"\bimport" + GAP + r"(['\"])([^'\"\r\n]+)\1")
CALL = re.compile(r"\b(?:import|require)" + GAP + r"\(" + GAP + r"([^)]*?)\s*\)")
LITERAL = re.compile(r"^(['\"])([^'\"]+)\1$")
# A module-level server directive is a JS directive-prologue statement,
# not necessarily a whole line: 'use server'; export ... is still executable.
# Honor block/line comments without swallowing later executable statements.
# Leading comments are lexical whitespace for a directive prologue, too:
# /* license */ "use server" and { // rationale\n "use server" remain
# executable server actions. A scanner that only skips comments AFTER the
# directive can misclassify these otherwise non-entrypoint modules as safe.
DIRECTIVE_GAP = r"(?:\s|/\*(?:(?!\*/)[\s\S])*\*/|//[^\r\n]*(?:\r?\n|$))*"
SERVER_ACTION = re.compile(
    r"(?m)^[ \t]*" + DIRECTIVE_GAP + r"['\"]use server['\"]"
    + GAP + r"(?:;|(?://[^\r\n]*)?$)"
)

# Next.js also permits a function-scoped directive at the first statement of
# an async server action. On one line it follows "{", not a line boundary;
# treating only line-start directives as server-reachable misses this module.
# Reuse the lexical whitespace/comment rule, not an unbounded wildcard.
FUNCTION_SERVER_ACTION = re.compile(
    r"\{" + DIRECTIVE_GAP + r"['\"]use server['\"]" + GAP
    + r"(?:;|(?://[^\r\n]*)?$)", re.M
)


def _has_server_action(source: str) -> bool:
    return bool(SERVER_ACTION.search(source) or FUNCTION_SERVER_ACTION.search(source))


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
            if not _has_server_action(p.read_text(encoding="utf-8")):
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
        if is_live_render or is_global or _has_server_action(p.read_text(encoding="utf-8")):
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


def _module_mapping_findings(root: Path) -> list[str]:
    """Fail closed if configuration can redirect otherwise external imports.

    This scanner only resolves known local paths. Unreviewed TS path aliases,
    package self-reference/\u0023imports and baseUrl mappings would invalidate
    that assumption; refuse the configuration rather than guessing.
    """
    problems: list[str] = []
    for p in sorted(root.rglob("*.json")):
        if any(part in EXCLUDED_DIRS for part in p.relative_to(root).parts):
            continue
        if not (p.name in ("tsconfig.json", "jsconfig.json", "package.json")
                or (p.name.startswith("tsconfig.") and p.suffix == ".json")):
            continue
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            problems.append(f"{rel}: unreviewed symlinked module configuration")
            continue
        try:
            config = json.loads(p.read_text(encoding="utf-8"))
        except (UnicodeError, OSError, ValueError):
            problems.append(f"{rel}: unreadable/unreviewed module configuration")
            continue
        if not isinstance(config, dict):
            problems.append(f"{rel}: module configuration must be an object")
            continue
        if p.name == "package.json":
            if "imports" in config or "exports" in config:
                problems.append(
                    f"{rel}: unreviewed package imports/exports resolution"
                )
        else:
            if "extends" in config or "references" in config:
                problems.append(
                    f"{rel}: unreviewed inherited/referenced TS module resolution"
                )
            opts = config.get("compilerOptions", {})
            if not isinstance(opts, dict):
                problems.append(f"{rel}: compilerOptions must be an object")
            elif "paths" in opts or "baseUrl" in opts:
                problems.append(
                    f"{rel}: unreviewed TS path aliases/baseUrl resolution"
                )
    return problems


def _source_symlink_findings(root: Path) -> list[str]:
    """Symlinked live sources can evade ordinary entrypoint traversal.

    Refuse executable symlinks and source-tree directory symlinks before
    following any imports; do not follow symlinks or inspect their targets.
    Generated dependencies and build directories are outside this policy.
    """
    problems: list[str] = []
    for path in root.rglob("*"):
        rel = path.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in rel.parts):
            continue
        parts = rel.parts
        is_source_tree = parts[0] in {"app", "pages", "lib", "src"}
        is_root_runtime = (len(parts) == 1
            and path.stem in GLOBAL_STEMS
            and path.suffix in SOURCE_SUFFIXES)
        if not (is_source_tree or is_root_runtime) or not path.is_symlink():
            continue
        # A symlinked directory may hide arbitrarily many executable files.
        # A source file symlink may resolve beyond the repository entirely.
        if path.suffix in SOURCE_SUFFIXES or path.is_dir() or not path.exists():
            problems.append(f"{rel.as_posix()}: unreviewed symlinked source path")
    return problems


def findings(root: Path = ROOT) -> list[str]:
    """Fail live server entrypoints closed on simulated imports and ambiguity."""
    root = root.resolve()
    violations: set[str] = set(_module_mapping_findings(root))
    violations.update(_source_symlink_findings(root))
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
