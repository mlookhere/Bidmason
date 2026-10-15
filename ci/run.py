#!/usr/bin/env python3
"""Noninteractive BidMason validation entry point."""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['fast', 'pr', 'security'])
    stage = parser.parse_args().stage
    commands = [[sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v']]
    if stage in {'pr', 'security'}:
        commands.append([sys.executable, 'ci/security.py'])
    for command in commands:
        code = subprocess.run(command, cwd=ROOT, check=False).returncode
        if code:
            return code
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
