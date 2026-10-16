"""Execute actual unit tests. No zero-count, skipped, or known-failure CI passes."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
count = suite.countTestCases()
if count < 8:
    raise SystemExit(f"FAIL: expected at least 8 substantive tests, discovered {count}")
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful() or result.testsRun != count or result.skipped or result.expectedFailures:
    raise SystemExit("FAIL: tests failed, skipped, expected-failed or did not execute")
print(f"PASS: {count} tests executed with zero skipped", file=sys.stdout)
