import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class RepoTests(unittest.TestCase):
    def test_repository_identity(self):
        config = json.loads((ROOT / '.chatfreept/project.json').read_text())
        self.assertEqual(config['repository'], 'mlookhere/Bidmason')
        self.assertEqual(config['agent'], 'ChatGPT')
        self.assertNotEqual(config['developmentBranch'], config['productionBranch'])

    def test_plan_has_all_slices(self):
        plan = (ROOT / 'docs/MASTER_PLAN.md').read_text()
        for number in range(1, 9):
            self.assertIn(f'### {number}.', plan)

    def test_required_gate_script_exists(self):
        for path in ('ci/run', 'ci/run.py', 'scripts/bootstrap', '.github/workflows/ci-pr.yml'):
            self.assertTrue((ROOT / path).is_file(), path)

if __name__ == '__main__':
    unittest.main()
