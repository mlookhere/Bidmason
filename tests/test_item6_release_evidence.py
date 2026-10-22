"""Adversarial regression for the Item 6 release-evidence BLOCKED inventory."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ci.item6_release_evidence import REQUIRED, MAX_MANIFEST_BYTES, evaluate, load
from ci.run import STAGES


class Item6EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.original = load()

    def changed(self, action):
        data = copy.deepcopy(self.original)
        action(data)
        return data

    def test_current_inventory_is_blocked_not_production_authorized(self):
        state = evaluate(self.original)
        self.assertEqual(state, {
            "state": "blocked", "releaseAuthorized": False,
            "required": len(REQUIRED), "unverified": len(REQUIRED),
            "submittedForIndependentReview": 0,
        })

    def test_external_acceptance_runbook_covers_every_source_requirement(self):
        """Human evidence-collection guidance must not silently drift from the gate."""
        import re

        path = Path(__file__).resolve().parents[1] / "docs/ITEM6_EXTERNAL_ACCEPTANCE_RUNBOOK.md"
        text = path.read_text(encoding="utf-8")
        self.assertIn("**Status: BLOCKED", text)
        self.assertIn("releaseAuthorized: false", text)
        self.assertIn("No category has been independently", text)
        pattern = r'^\| H(\d{2}) \| `([a-z0-9-]+)` \| `([^`]+)` \| (.+) \|$'
        rows = re.findall(pattern, text, re.MULTILINE)
        self.assertEqual(len(rows), len(REQUIRED))
        self.assertEqual([int(number) for number, _, _, _ in rows],
                         list(range(1, len(REQUIRED) + 1)))
        self.assertEqual([identifier for _, identifier, _, _ in rows],
                         list(REQUIRED))
        for _, identifier, source, remainder in rows:
            self.assertEqual(source, REQUIRED[identifier])
            # An assigned owner role and a concrete negative test are mandatory.
            self.assertEqual(len(remainder.split(" | ")), 2)
            self.assertTrue(all(part.strip() for part in remainder.split(" | ")))
        # The runbook is a collection plan, never a recorded human approval.
        self.assertNotIn("- [x]", text)

    def test_every_required_python_ci_stage_enforces_release_inventory(self):
        for stage in ("fast", "pr", "security"):
            with self.subTest(stage=stage):
                self.assertIn("item6-release-evidence", STAGES[stage])
                self.assertEqual(STAGES[stage].count("item6-release-evidence"), 1)
                # Added enforcement must never remove the original stage gates.
                for original in (("tests", "source-integrity", "publish")
                                 if stage == "fast" else
                                 ("tests", "source-integrity", "publish", "workflow", "security")):
                    self.assertIn(original, STAGES[stage])
        self.assertEqual(STAGES["web"], ("web",))
        self.assertEqual(STAGES["pdf"], ("pdf",))

    def test_corrupted_or_missing_manifest_fails_independent_gate(self):
        import subprocess
        import sys
        source = Path(__file__).resolve().parents[1] / "ci" / "item6_release_evidence.py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "ci").mkdir()
            (root / "docs").mkdir()
            (root / "ci/item6_release_evidence.py").write_bytes(source.read_bytes())
            manifest = root / "docs/ITEM6_RELEASE_EVIDENCE.json"
            valid = json.dumps(self.original)
            for content in (None, valid.replace('"blocked"', '"ready"', 1),
                            valid.replace('"tenant-auth-and-rls"', '"send-allowed"', 1)):
                if content is None:
                    manifest.unlink(missing_ok=True)
                else:
                    manifest.write_text(content)
                result = subprocess.run(
                    [sys.executable, str(root / "ci/item6_release_evidence.py")],
                    cwd=root, text=True, capture_output=True, check=False)
                self.assertNotEqual(result.returncode, 0)
            manifest.write_text(valid)
            result = subprocess.run([sys.executable, str(root / "ci/item6_release_evidence.py")],
                                    cwd=root, text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("BLOCKED: Item 6 has 13 unverified", result.stdout)

    def test_missing_requirement_never_passes(self):
        with self.assertRaisesRegex(ValueError, "Missing"):
            evaluate(self.changed(lambda m: m["criteria"].pop()))

    def test_duplicate_requirement_never_replaces_another(self):
        def corrupt(m):
            m["criteria"][1] = copy.deepcopy(m["criteria"][0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            evaluate(self.changed(corrupt))

    def test_unknown_requirement_is_not_accepted(self):
        with self.assertRaisesRegex(ValueError, "Unknown"):
            evaluate(self.changed(lambda m: m["criteria"][0].update(id="send-allowed")))

    def test_source_reference_cannot_be_rewritten(self):
        with self.assertRaisesRegex(ValueError, "source"):
            evaluate(self.changed(lambda m: m["criteria"][0].update(source="synthetic-demo")))

    def test_fabricated_verified_or_approved_status_is_rejected(self):
        for status in ("verified", "passed", "approved", True, None):
            with self.subTest(status=status), self.assertRaises(ValueError):
                evaluate(self.changed(lambda m: m["criteria"][0].update(status=status)))

    def test_claimed_release_ready_is_rejected(self):
        for state in ("ready", "passed", "production", True):
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "blocked"):
                evaluate(self.changed(lambda m: m.update(releaseState=state)))

    def test_submitted_evidence_without_reference_fails(self):
        with self.assertRaisesRegex(ValueError, "reference"):
            evaluate(self.changed(lambda m: m["criteria"][0].update(
                status="submitted-for-independent-review")))

    def test_referenced_evidence_is_still_blocked_not_approved(self):
        m = self.changed(lambda m: m["criteria"][0].update(
            status="submitted-for-independent-review",
            evidence=["https://github.com/mlookhere/Bidmason/issues/7"]))
        state = evaluate(m)
        self.assertEqual(state["state"], "blocked")
        self.assertIs(state["releaseAuthorized"], False)
        self.assertEqual(state["submittedForIndependentReview"], 1)

    def test_unverified_evidence_must_not_pretend_to_be_proof(self):
        with self.assertRaisesRegex(ValueError, "Unverified"):
            evaluate(self.changed(lambda m: m["criteria"][0].update(
                evidence=["https://github.com/mlookhere/Bidmason/issues/7"])))

    def test_hidden_action_or_reused_reference_fails(self):
        m = self.changed(lambda m: m["criteria"][0].update(allowSend=True))
        with self.assertRaisesRegex(ValueError, "shape"):
            evaluate(m)
        m = self.changed(lambda m: m["criteria"][0].update(
            status="submitted-for-independent-review",
            evidence=["https://example.test/report", "https://example.test/report"]))
        with self.assertRaisesRegex(ValueError, "reference"):
            evaluate(m)

    def test_duplicate_json_field_cannot_override_blocked_status(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.json"
            path.write_text('{"releaseState":"blocked","releaseState":"ready"}')
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                load(path)

    def test_malformed_https_evidence_refs_fail_closed(self):
        bad = (
            "https://", "https:///report", "https://localhost/report",
            "https://127.0.0.1/report", "https://[::1]/report",
            "https://operator:secret@example.test/report",
            "https://github.com@evil.test/report", "https://example.test:8080/report",
            "https://github.com/report?token=private", "https://github.com\\@evil.test/report",
            "https://github.com/report\nspoofed", "https://github.com/report#access=private",
            "https://invalid..test/report",
        )
        for url in bad:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "reference"):
                evaluate(self.changed(lambda manifest: manifest["criteria"][0].update(
                    status="submitted-for-independent-review", evidence=[url])))
        valid = self.changed(lambda manifest: manifest["criteria"][0].update(
            status="submitted-for-independent-review",
            evidence=["https://github.com/mlookhere/Bidmason/issues/7#issuecomment-123"]))
        self.assertIs(evaluate(valid)["releaseAuthorized"], False)

    def test_manifest_file_is_bounded_and_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.json"
            path.write_bytes(b" " * (MAX_MANIFEST_BYTES + 1))
            with self.assertRaisesRegex(ValueError, "Oversized"):
                load(path)
            path.write_text(json.dumps(self.original), encoding="utf-8")
            with patch.object(Path, "is_symlink", lambda candidate: candidate == path):
                with self.assertRaisesRegex(ValueError, "symlinked"):
                    load(path)
            self.assertEqual(evaluate(load(path))["state"], "blocked")

    def test_bad_reference_and_missing_schema_are_rejected(self):
        for ref in ("javascript:alert(1)", "http://example.test", 
                    "https://example.test/a b", "https://example.test/<x>"):
            m = self.changed(lambda m: m["criteria"][0].update(
                status="submitted-for-independent-review", evidence=[ref]))
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                evaluate(m)
        with self.assertRaises(ValueError):
            evaluate(self.changed(lambda m: m.pop("schema")))


if __name__ == "__main__":
    unittest.main()
