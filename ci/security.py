"""Best-effort source secret guard; not a substitute for security review."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDE = {".git", "node_modules", ".venv", "__pycache__", ".next"}
EXTENSIONS = {".md", ".html", ".py", ".js", ".ts", ".tsx", ".json", ".yml", ".yaml", ".txt"}
SECRET_PATTERNS = (
    re.compile("sk_" + "live_" + r"[0-9a-zA-Z]{12,}"),
    re.compile("gh" + "p_" + r"[A-Za-z0-9]{30,}"),
    re.compile("-----BEGIN " + r"(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)


def findings(root: Path = ROOT) -> list[str]:
    problems = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in EXTENSIONS or any(part in EXCLUDE for part in path.parts):
            continue
        if path.name.startswith(".env") and path.name != ".env.example":
            problems.append(f"private env file committed: {path.relative_to(root)}")
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        if any(pattern.search(content) for pattern in SECRET_PATTERNS):
            problems.append(f"probable committed secret: {path.relative_to(root)}")
    return problems


def main() -> int:
    problems = findings()
    for problem in problems:
        print(f"FAIL: {problem}")
    if problems:
        return 1
    print("PASS: repository secret patterns; no production credential tests implied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
