import tempfile
import unittest
from pathlib import Path

from ci.security import findings as secret_findings
from ci.workflow_policy import findings as workflow_findings, WORKFLOW


class WorkflowPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.good = WORKFLOW.read_text(encoding="utf-8")

    def test_real_workflow_declares_all_stages(self):
        self.assertEqual(workflow_findings(self.good), [])

    def test_missing_job_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("  security:", "  omitted:")))

    def test_missing_windows_job_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("  win-fast:", "  omitted:")))

    def test_missing_windows_bootstrap_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("./scripts/bootstrap.ps1 -CI", "echo skipped bootstrap")))

    def test_missing_windows_runner_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("./ci/run.ps1 fast", "echo skipped win gate")))

    def test_missing_pdf_job_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("  pdf-qa:", "  missing-pdf:")))

    def test_missing_pdf_gate_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("bash ci/run pdf", "echo skipped PDF QA")))

    def test_missing_web_build_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("  web-build:", "  omitted:")))

    def test_web_uses_exact_dependency_lock(self):
        self.assertTrue(workflow_findings(self.good.replace("npm ci --no-audit --no-fund", "npm install --no-audit --no-fund")))

    def test_dependency_audit_is_required(self):
        self.assertTrue(workflow_findings(self.good.replace("npm audit --audit-level=high --omit=dev", "echo skipped audit")))

    def test_unpinned_action_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v4")))

    def test_write_permissions_block_release(self):
        self.assertTrue(workflow_findings(self.good + "\ncontents: write\n"))

    def test_claude_action_blocks_release(self):
        self.assertTrue(workflow_findings(self.good + "\n# anthropics/claude-code-action\n"))

    def test_missing_persistence_setting_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("persist-credentials: false", "persist-credentials: true")))

    def test_no_remote_pipe_to_shell(self):
        self.assertTrue(workflow_findings(self.good + "\n# curl https://example.com/x | sh\n"))


class SecretPolicyTests(unittest.TestCase):
    def test_secret_pattern_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.py"
            path.write_text("TOKEN = 'sk_" + "live_" + "1234567890abcdefghijklmnop'\n")
            self.assertEqual(len(secret_findings(Path(tmp))), 1)

    def test_safe_example_not_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / ".env.example").write_text("TOKEN=replace-me\n")
            self.assertEqual(secret_findings(Path(tmp)), [])


if __name__ == "__main__":
    unittest.main()
