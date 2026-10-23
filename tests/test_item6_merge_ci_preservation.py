"""A merged BidMason tree may not lose previously delivered CI job gates."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ci.workflow_policy import (
    ROOT, WORKFLOW, CORE_JOB_COMMANDS, MERGED_SLICE_GATES, _job_blocks, findings,
    merged_gate_findings,
)


class PreservedSliceCiTests(unittest.TestCase):
    def setUp(self):
        self.workflow = WORKFLOW.read_text(encoding="utf-8")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def source(self, relative_path):
        file = self.root / relative_path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("synthetic marker only", encoding="utf-8")

    def test_item6_branch_still_enforces_existing_required_jobs(self):
        self.assertEqual(findings(self.workflow, ROOT), [])
        self.source("ci/item6_release_evidence.py")
        self.assertEqual(merged_gate_findings(self.workflow, self.root), [])
        jobs, duplicates = _job_blocks(self.workflow)
        self.assertEqual(len(jobs), 8)
        self.assertEqual(duplicates, set())

    def test_missing_predecessor_job_fails_when_its_source_is_integrated(self):
        for marker, job, _ in MERGED_SLICE_GATES[:-1]:
            with self.subTest(job=job):
                self.source(marker)
                self.assertIn(
                    f"missing {job} job for {marker}",
                    merged_gate_findings(self.workflow, self.root),
                )
                (self.root / marker).unlink()

    def test_stub_and_comment_cannot_replace_actual_runner(self):
        marker, job, command = MERGED_SLICE_GATES[0]
        self.source(marker)
        fake_job = f"\n  {job}:\n    name: {job}\n    runs-on: ubuntu-latest\n    # run: {command}\n"
        self.assertIn(
            f"missing substantive {job} run command for {marker}",
            merged_gate_findings(self.workflow + fake_job, self.root),
        )
        fake_job += f"    steps:\n      - name: Verify RLS\n        run: {command}\n"
        self.assertEqual(merged_gate_findings(self.workflow + fake_job, self.root), [])

    def test_duplicate_job_keys_cannot_silently_override_a_required_gate(self):
        fake = self.workflow + (
            "\n  synthetic-webhook-qa:\n    name: synthetic-webhook-qa\n"
            "    runs-on: ubuntu-latest\n    steps: []\n"
        )
        self.assertIn(
            "duplicate workflow job: synthetic-webhook-qa",
            merged_gate_findings(fake, self.root),
        )

    def test_core_checks_cannot_be_conditional_or_nonblocking(self):
        baseline = "  fast:\\n    name: fast\\n    runs-on: ubuntu-latest\\n"
        self.assertIn(baseline.replace("\\n", "\n"), self.workflow)
        for directive in ("    if: false\n",
                          "    if: ${{ github.event_name == 'push' }}\n",
                          "    continue-on-error: true\n",
                          "    if: ${{ false }}\n"):
            with self.subTest(directive=directive):
                altered = self.workflow.replace(
                    baseline.replace("\\n", "\n"),
                    baseline.replace("\\n", "\n") + directive, 1,
                )
                self.assertIn(
                    "conditional or nonblocking required job: fast",
                    " ".join(merged_gate_findings(altered, self.root)),
                )
        step_guard = self.workflow.replace(
            "      - name: Fast checks\n        run: bash ci/run fast",
            "      - name: Fast checks\n        if: false\n        run: bash ci/run fast",
            1,
        )
        self.assertIn(
            "conditional or nonblocking required job: fast (if)",
            merged_gate_findings(step_guard, self.root),
        )

    def test_each_core_runner_must_be_executable_in_its_own_job(self):
        for name, command in CORE_JOB_COMMANDS.items():
            with self.subTest(job=name):
                original = f"        run: {command}\n"
                self.assertIn(original, self.workflow)
                # Keep the command text in the source to prove that a broad
                # string search would miss the silently disabled runner.
                altered = self.workflow.replace(
                    original, "        run: echo skipped\n", 1,
                ) + f"\n# run: {command}\n"
                self.assertIn(
                    f"missing substantive core {name} run command",
                    merged_gate_findings(altered, self.root),
                )

    def test_core_runner_cannot_move_to_another_job(self):
        command = CORE_JOB_COMMANDS["fast"]
        altered = self.workflow.replace(
            f"        run: {command}\n", "        run: echo skipped\n", 1,
        ) + f"\n      - name: Misplaced fast runner\n        run: {command}\n"
        self.assertIn(
            "missing substantive core fast run command",
            merged_gate_findings(altered, self.root),
        )

    def test_inherited_slice_runner_cannot_hide_a_failure(self):
        marker, job, command = MERGED_SLICE_GATES[0]
        self.source(marker)
        for job_option, step in (
            ("    if: false\n", f"      - run: {command}\n"),
            ("    continue-on-error: true\n", f"      - run: {command}\n"),
            ("", f"      - if: false\n        run: {command}\n"),
            ("", f"      - name: SQL test\n        if: false\n        run: {command}\n"),
            ("", f"      - name: SQL test\n        continue-on-error: true\n        run: {command}\n"),
        ):
            with self.subTest(job_option=job_option, step=step):
                fake = (f"\n  {job}:\n    runs-on: ubuntu-latest\n"
                        f"{job_option}    steps:\n{step}")
                found = merged_gate_findings(self.workflow + fake, self.root)
                self.assertTrue(
                    any(f"conditional or nonblocking required job: {job}" in x for x in found),
                    found,
                )

    def test_missing_core_job_is_not_replaced_by_text_in_comments(self):
        altered = self.workflow.replace(
            "  fast:\n    name: fast\n", "  # fast:\n    # name: fast\n", 1,
        )
        self.assertIn("missing required core CI job: fast",
                      merged_gate_findings(altered, self.root))

    def test_all_six_feature_gates_survive_a_simulated_combined_workflow(self):
        extra_jobs = []
        for marker, job, command in MERGED_SLICE_GATES:
            self.source(marker)
            if job == "synthetic-webhook-qa":
                continue  # Already implemented by the current Item 6 branch.
            extra_jobs.append(
                f"\n  {job}:\n    name: {job}\n"
                "    runs-on: ubuntu-latest\n    steps:\n"
                f"      - name: Preserve {job} gate\n        run: {command}\n"
            )
        union = self.workflow + "".join(extra_jobs)
        jobs, duplicates = _job_blocks(union)
        self.assertEqual(len(jobs), 13)
        self.assertEqual(duplicates, set())
        self.assertEqual(merged_gate_findings(union, self.root), [])
        self.assertEqual(findings(union, self.root), [])


if __name__ == "__main__":
    unittest.main()
