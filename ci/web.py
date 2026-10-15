"""Web gate: type checking, explicit tests and real production build."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    commands = [
        ["npm", "run", "typecheck"],
        ["npm", "run", "test:web"],
        ["npm", "run", "build"],
        ["npm", "run", "smoke:web"],
    ]
    for args in commands:
        print("WEB:", " ".join(args), flush=True)
        code = subprocess.run(args, cwd=ROOT, check=False).returncode
        if code:
            return code
    print("PASS: web typecheck, test and build")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
