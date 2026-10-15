"""Guard imported original operating policies against accidental rewriting."""
from hashlib import sha256
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class OriginalPolicyIntegrityTests(unittest.TestCase):
    def test_pricing_policy_exact_original(self):
        source = (ROOT / "operations/pricing-and-packages.md").read_bytes()
        self.assertEqual(sha256(source).hexdigest(), "26d0a8362a4e1c5f74bc5c1805144e0e00d4f769aff80a71ffdcfb803ee27646")

    def test_qc_policy_exact_original(self):
        source = (ROOT / "operations/qc-checklists.md").read_bytes()
        self.assertEqual(sha256(source).hexdigest(), "d29ddc37abd9cf94620ff76c3e3c9bdcd9182ac073314dfde068676ffa63a50d")

    def test_full_blueprint_and_tracker_present(self):
        self.assertGreater((ROOT / "docs/BIDMASON_MASTER_IMPLEMENTATION_PLAN.md").stat().st_size, 50000)
        self.assertGreater((ROOT / "docs/BIDMASON_EXECUTION_TRACKER.md").stat().st_size, 10000)


if __name__ == "__main__":
    unittest.main()
