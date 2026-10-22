"""Adversarial regression for the Item 6 release-evidence BLOCKED inventory."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from ci.item6_release_evidence import REQUIRED, evaluate, load


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
