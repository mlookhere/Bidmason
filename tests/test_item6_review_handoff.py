"""H01-H13 external review packet is complete, redacted and never authorizing."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from ci.item6_release_evidence import REQUIRED, load
from ci.item6_review_handoff import (
    MAX_RUNBOOK_BYTES, RUNBOOK, _read_runbook, render_markdown, review_packet,
)
from ci.run import STAGES


class ReviewPacketTests(unittest.TestCase):
    def setUp(self):
        self.manifest = load()
        self.runbook = _read_runbook(RUNBOOK)

    def packet(self):
        return review_packet(self.manifest, self.runbook)

    def test_current_thirteen_required_with_no_implied_approvals(self):
        p = self.packet()
        self.assertEqual(p["schema"], "bidmason.item6.review-handoff.v1")
        self.assertEqual(p["releaseState"], "blocked")
        self.assertIs(p["releaseAuthorized"], False)
        self.assertEqual((p["required"], p["unverified"], p["submittedForIndependentReview"]),
                         (13, 13, 0))
        self.assertEqual([x["id"] for x in p["requirements"]], list(REQUIRED))
        for item in p["requirements"]:
            self.assertFalse(item["independentlyVerified"])
            self.assertEqual(item["evidenceStatus"], "unverified")
            self.assertEqual(item["referenceCountNotValidation"], 0)
            self.assertTrue(item["ownerRoleAndArtifact"])
            self.assertTrue(item["mandatoryLiveNegativeValidation"])

    def test_packet_and_markdown_are_deterministic_and_bound_to_sources(self):
        p = self.packet()
        self.assertEqual(p, self.packet())
        canonical = json.dumps(self.manifest, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(p["manifestSha256"], hashlib.sha256(canonical).hexdigest())
        self.assertEqual(p["runbookSha256"], hashlib.sha256(self.runbook).hexdigest())
        text = render_markdown(p)
        self.assertEqual(text, render_markdown(p))
        self.assertIn("BLOCKED", text)
        self.assertEqual(text.count("Independent verification: **not established**"), 13)
        self.assertEqual(text.count("## [ ] H"), 13)
        self.assertNotIn("## [x]", text)
        self.assertNotIn("approved for delivery", text.lower())

    def test_submitted_link_is_never_exposed_or_counted_as_verified(self):
        self.manifest = copy.deepcopy(self.manifest)
        self.manifest["criteria"][0]["status"] = "submitted-for-independent-review"
        self.manifest["criteria"][0]["evidence"] = [
            "https://evidence.example.test/secret-document-name"
        ]
        p = self.packet()
        self.assertEqual(p["unverified"], 12)
        self.assertEqual(p["submittedForIndependentReview"], 1)
        self.assertEqual(p["requirements"][0]["referenceCountNotValidation"], 1)
        self.assertIs(p["releaseAuthorized"], False)
        for output in (json.dumps(p), render_markdown(p)):
            self.assertNotIn("secret-document-name", output)
            self.assertNotIn("evidence.example.test", output)

    def test_changed_runbook_changes_digest_without_granting_access(self):
        original = self.packet()
        new = review_packet(self.manifest, self.runbook + b"\nUnverified reviewer note.\n")
        self.assertNotEqual(new["runbookSha256"], original["runbookSha256"])
        self.assertEqual(new["manifestSha256"], original["manifestSha256"])
        self.assertIs(new["releaseAuthorized"], False)

    def test_removed_duplicate_or_reordered_review_rows_fail_closed(self):
        lines = self.runbook.decode().splitlines(keepends=True)
        rows = [i for i, line in enumerate(lines) if line.startswith("| H")]
        self.assertEqual(len(rows), 13)
        for bad in (
            lines[:rows[0]] + lines[rows[0]+1:],
            lines[:rows[0]] + [lines[rows[0]]] + lines[rows[0]:],
            lines[:rows[0]] + [lines[rows[1]], lines[rows[0]]]
                + lines[rows[1]+1:],
        ):
            with self.assertRaises(ValueError):
                review_packet(self.manifest, "".join(bad).encode())

    def test_wrong_requirement_source_or_missing_negative_case_fails_closed(self):
        source = self.runbook.decode()
        for tampered in (
            source.replace("| `MASTER_PLAN:3` |", "| `INVENTED:3` |", 1),
            source.replace("| H01 |", "| H99 |", 1),
        ):
            with self.assertRaises(ValueError):
                review_packet(self.manifest, tampered.encode())
        target = source.splitlines()
        for i, line in enumerate(target):
            if line.startswith("| H01 |"):
                cols = line.split(" | ")
                cols[-2] = ""
                target[i] = " | ".join(cols)
                break
        with self.assertRaises(ValueError):
            review_packet(self.manifest, "\n".join(target).encode())

    def test_review_instructions_never_echo_links_emails_or_markup(self):
        lines = self.runbook.decode().splitlines()
        row_index = next(i for i, line in enumerate(lines) if line.startswith("| H01 |"))
        for cell_index in (3, 4):
            for unsafe in (
                "https://evidence.example.test/private-buyer",
                "mailto:buyer@example.test",
                "buyer@example.test",
                "www.evidence.example.test/private",
                "[customer record](relative-path)",
                "<img src=x onerror=alert(1)>",
                "operator | hidden extra column",
                "`inline-code`",
                "review\trecipient",
            ):
                with self.subTest(cell=cell_index, unsafe=unsafe):
                    columns = lines[row_index].split(" | ")
                    columns[cell_index] = unsafe
                    tampered = lines.copy()
                    tampered[row_index] = " | ".join(columns)
                    with self.assertRaises(ValueError):
                        review_packet(self.manifest, "\n".join(tampered).encode())

    def test_invalid_manifest_and_fabricated_verification_cannot_generate(self):
        for mutation in (
            lambda m: m.update(releaseState="ready"),
            lambda m: m["criteria"][0].update(status="approved"),
            lambda m: m["criteria"].pop(),
        ):
            m = copy.deepcopy(self.manifest)
            mutation(m)
            with self.assertRaises(ValueError):
                review_packet(m, self.runbook)
        with self.assertRaises(ValueError):
            review_packet(self.manifest, self.runbook.replace(b"**Status: BLOCKED.", b"**Status: APPROVED."))
        with self.assertRaises(ValueError):
            review_packet(self.manifest, self.runbook + b"\n- [x] fake approval\n")

    def test_runbook_symlinks_large_or_non_utf8_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "runbook.md"
            path.write_bytes(b"x" * (MAX_RUNBOOK_BYTES+1))
            with self.assertRaisesRegex(ValueError, "Oversized"):
                _read_runbook(path)
            path.write_bytes(self.runbook)
            with patch.object(Path, "is_symlink", lambda p: p == path):
                with self.assertRaisesRegex(ValueError, "symlink"):
                    _read_runbook(path)
        with self.assertRaisesRegex(ValueError, "encoding"):
            review_packet(self.manifest, b"\xff")

    def test_all_existing_hard_gates_also_run_review_packet_check(self):
        for stage in ("fast", "pr", "security"):
            with self.subTest(stage=stage):
                self.assertIn("item6-review-handoff", STAGES[stage])
                self.assertIn("item6-runtime-boundary", STAGES[stage])
                self.assertIn("item6-release-evidence", STAGES[stage])

    def test_cli_check_and_markdown_never_claim_approval(self):
        repo = Path(__file__).resolve().parents[1]
        for mode in ("check", "markdown", "json"):
            run = subprocess.run(
                [sys.executable, "-m", "ci.item6_review_handoff", "--format", mode],
                cwd=repo, capture_output=True, text=True, check=False,
            )
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn("blocked" if mode == "json" else "BLOCKED", run.stdout)
            self.assertNotIn("releaseAuthorized: true", run.stdout)
            self.assertNotIn("buyer@fictional.example", run.stdout)


if __name__ == "__main__":
    unittest.main()
