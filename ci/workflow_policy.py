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


def findings(source: str) -> list[str]:
    problems = []
    if not re.search(r"(?m)^permissions:\s*$", source) or "contents: read" not in source:
        problems.append("missing explicit read-only permissions")
    for needle in ("pull_request:", "push:", "branches: [dev, main]", "  fast:", "  pr:", "  security:", "  web-build:", "bash ci/run web", "bash ci/run fast", "bash ci/run pr", "bash ci/run security"):
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
