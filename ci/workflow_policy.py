"""Offline GitHub Actions guard. Fail closed for missing and dangerous checks."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci-pr.yml"
PINNED = re.compile(r"(?m)^\s*-\s+uses:\s+[\w./-]+@[0-9a-f]{40}(?:\s|$)")
USES = re.compile(r"(?m)^\s*-\s+uses:\s+(\S+)")
UNSAFE = (
    (r"\bwrite-all\b", "write-all permissions"),
    (r"\bpull_request_target\b", "unsafe pull_request_target event"),
    (r"(?m)^\s*persist-credentials:\s*true\b", "checkout credentials persisted"),
    (r"(?m)^\s*(contents|issues|pull-requests):\s*write\b", "write permissions in CI"),
    (r"(?i)\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:bash|sh)\b", "remote pipe to shell"),
    (r"(?i)(?:anthropics/claude|claude-code-action|claude-exec)", "Claude runtime"),
)


# Once a slice's substantive tests exist in the combined tree, its CI job
# must survive workflow merges. Independent work branches keep their gate
# sets; an integration conflict must not replace an earlier runner with a stub.
# The command must occur in an executable run step, not only a comment.
# Every core PR check must remain an unconditional, failure-propagating job.
# Additional slice gates become mandatory when their executable marker exists.
CORE_JOBS = ("fast", "pr", "security", "web-build", "win-fast", "pdf-qa", "browser-e2e")
NONBLOCKING_DIRECTIVE = re.compile(r"(?m)^[ \t]+(?:-[ \t]+)?(if|continue-on-error):(?:[ \t]|$)")


MERGED_SLICE_GATES = (
    ("ci/db_rls_test.sql", "db-rls",
     "psql -X -v ON_ERROR_STOP=1 -f ci/db_rls_test.sql"),
    ("ci/clamav_real_integration.test.mjs", "av-real",
     "node --test ci/clamav_real_integration.test.mjs"),
    ("db/typed_note_foundation.sql", "intake-db",
     "psql -X -v ON_ERROR_STOP=1 -f db/typed_note_foundation.sql"),
    ("ci/item3_item4_migration_parity.test.mjs", "item3-intake-compat",
     "node --test ci/item3_item4_migration_parity.test.mjs"),
    ("ci/branded_pdf_qa.py", "proposal-pdf-qa",
     "python3 ci/branded_pdf_qa.py"),
    ("ci/item6_release_evidence.py", "synthetic-webhook-qa",
     "node --test tests-web/synthetic-webhook-*.test.mjs"),
)


def _job_blocks(source: str) -> tuple[dict[str, str], set[str]]:
    """Extract top-level job bodies, not unrelated YAML or comments."""
    _, sep, jobs_source = source.partition("\njobs:\n")
    if not sep:
        return {}, set()
    boundaries = list(re.finditer(
        r"(?m)^  ([a-z][a-z0-9-]*):[ \t]*$", jobs_source,
    ))
    blocks: dict[str, str] = {}
    duplicates: set[str] = set()
    for index, match in enumerate(boundaries):
        name = match.group(1)
        if name in blocks:
            duplicates.add(name)
        blocks[name] = jobs_source[match.end():(
            boundaries[index + 1].start()
            if index + 1 < len(boundaries) else len(jobs_source)
        )]
    return blocks, duplicates


def merged_gate_findings(source: str, root: Path = ROOT) -> list[str]:
    """Preserve unconditional, failure-propagating core and feature CI gates."""
    blocks, duplicates = _job_blocks(source)
    problems = [f"duplicate workflow job: {name}" for name in sorted(duplicates)]
    required = set(CORE_JOBS)
    for marker, name, command in MERGED_SLICE_GATES:
        if not (root / marker).is_file():
            continue
        required.add(name)
        block = blocks.get(name)
        if block is None:
            problems.append(f"missing {name} job for {marker}")
        elif not re.search(
            r"(?m)^[ \t]+run:[ \t]*" + re.escape(command) + r"[ \t]*$",
            block,
        ):
            problems.append(f"missing substantive {name} run command for {marker}")

    for name in sorted(required):
        block = blocks.get(name)
        if block is None:
            if name in CORE_JOBS:
                problems.append(f"missing required core CI job: {name}")
            continue
        # A job-level or step-level condition can silently skip its only test.
        # continue-on-error can hide an actual failure behind a green job.
        # Do not parse these fragile YAML constructs as harmless conditions.
        for directive in sorted(set(NONBLOCKING_DIRECTIVE.findall(block))):
            problems.append(f"conditional or nonblocking required job: {name} ({directive})")
    return problems


def findings(source: str, root: Path = ROOT) -> list[str]:
    problems = []
    if not re.search(r"(?m)^permissions:\s*$", source) or "contents: read" not in source:
        problems.append("missing explicit read-only permissions")
    for needle in ("pull_request:", "push:", "branches: [dev, main]", "  fast:", "  pr:", "  security:", "  web-build:", "  win-fast:", "  pdf-qa:", "bash ci/run pdf", "python3 -m pip install --requirement requirements-pdf.txt", "  browser-e2e:", "python3 ci/browser_qa.py", "python3 -m playwright install --with-deps chromium", "python3 -m pip install --requirement requirements-browser.txt", "./scripts/bootstrap.ps1 -CI", "./ci/run.ps1 fast", "bash ci/run web", "npm ci --no-audit --no-fund", "npm audit --audit-level=high --omit=dev", "bash ci/run fast", "bash ci/run pr", "bash ci/run security"):
        if needle not in source:
            problems.append(f"missing gate/trigger: {needle}")
    uses = USES.findall(source)
    if not uses:
        problems.append("missing workflow Actions")
    for action in uses:
        if not re.fullmatch(r"[\w./-]+@[0-9a-f]{40}", action):
            problems.append(f"unpinned action: {action}")
    if len(re.findall(r"(?m)^\s*persist-credentials:\s*false\s*$", source)) < sum("actions/checkout@" in action for action in uses):
        problems.append("checkout must set persist-credentials: false")
    for pattern, reason in UNSAFE:
        if re.search(pattern, source):
            problems.append(reason)
    problems.extend(merged_gate_findings(source, root))
    return problems


def main() -> int:
    if not WORKFLOW.is_file():
        print("FAIL: required GitHub Actions workflow absent")
        return 1
    problems = findings(WORKFLOW.read_text(encoding="utf-8"))
    for problem in problems:
        print(f"FAIL: {problem}")
    if problems:
        return 1
    print("PASS: required workflow gates, pinning and dangerous patterns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
