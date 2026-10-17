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

    def test_missing_tenant_db_job_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("  db-rls:", "  removed-db:")))

    def test_missing_real_rls_test_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("psql -X -v ON_ERROR_STOP=1 -f ci/db_rls_test.sql", "echo fake rls check")))

    def test_missing_fact_review_gate_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("psql -X -v ON_ERROR_STOP=1 -f ci/db_fact_review_test.sql", "echo skipped fact reviews")))

    def test_missing_storage_rls_gate_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "psql -X -v ON_ERROR_STOP=1 -f ci/db_storage_test.sql", "echo skipped storage security")))

    def test_missing_storage_policy_install_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "psql -X -v ON_ERROR_STOP=1 -f db/storage_policies.sql", "echo skipped storage policies")))

    def test_missing_evidence_receipt_gate_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "psql -X -v ON_ERROR_STOP=1 -f ci/db_receipt_test.sql", "echo no receipt test")))

    def test_missing_evidence_receipt_policy_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "psql -X -v ON_ERROR_STOP=1 -f db/evidence_receipts.sql", "echo no receipt FK")))

    def test_missing_storage_policy_drift_audit_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "psql -X -v ON_ERROR_STOP=1 -f db/storage_policy_audit.sql -f ci/db_storage_audit_test.sql",
            "echo skipped policy shadowing audit")))

    def test_missing_generated_migration_consistency_check_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "python3 scripts/build_migration.py --check", "echo stale migration allowed")))

    def test_missing_foundation_migration_replay_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "PGDATABASE=bm_migration_ci psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261017035109_bidmason_tenant_foundation.sql",
            "echo foundation skipped")))

    def test_missing_storage_migration_replay_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "PGDATABASE=bm_migration_ci psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261017035151_bidmason_evidence_storage.sql",
            "echo storage skipped")))

    def test_missing_review_fk_index_migration_replay_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace(
            "PGDATABASE=bm_migration_ci psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261017035730_bidmason_evidence_review_fk_index.sql",
            "echo missing review FK index")))

    def test_missing_pdf_job_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("  pdf-qa:", "  missing-pdf:")))

    def test_missing_pdf_gate_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("bash ci/run pdf", "echo skipped PDF QA")))

    def test_missing_browser_job_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("  browser-e2e:", "  removed-e2e:")))

    def test_missing_browser_execution_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("python3 ci/browser_qa.py", "echo skipped real browser")))

    def test_missing_browser_install_blocks_release(self):
        self.assertTrue(workflow_findings(self.good.replace("python3 -m playwright install --with-deps chromium", "echo browser unavailable")))

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
