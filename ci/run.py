#!/usr/bin/env python3
"""Headless, zero-dependency BidMason CI runner; no skipped or empty test suites."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGES = {
    "fast": ("tests", "source-integrity"),
    "pr": ("tests", "source-integrity", "workflow", "security"),
    "security": ("tests", "source-integrity", "workflow", "security"),
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run non-optional BidMason CI gates")
    parser.add_argument("stage", choices=sorted(STAGES))
    stage = parser.parse_args().stage
    commands = {
        "tests": [sys.executable, "ci/tests.py"],
        "source-integrity": [sys.executable, "ci/source_integrity.py"],
        "workflow": [sys.executable, "ci/workflow_policy.py"],
        "security": [sys.executable, "ci/security.py"],
    }
    for gate in STAGES[stage]:
        print(f"=== {stage}: {gate} ===", flush=True)
        result = subprocess.run(commands[gate], cwd=ROOT, check=False)
        if result.returncode != 0:
            return result.returncode
    print(f"PASS: {stage} ({len(STAGES[stage])} substantive gates)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
