"""Positive and adversarial tests for the exact legacy source bundle."""
from __future__ import annotations

import base64
import hashlib
import shutil
import tempfile
from pathlib import Path
import unittest

from scripts.import_legacy_assets import REQUIRED
from scripts.source_bundle import BUNDLE, BUNDLE_SHA256, original_assets, restore_assets, ROOT


class OriginalBundleTests(unittest.TestCase):
    def test_actual_bundle_recovers_all_four_byte_exact_assets(self):
        assets = original_assets()
        self.assertEqual(set(assets), set(REQUIRED))
        for name, (length, digest) in REQUIRED.items():
            with self.subTest(name=name):
                self.assertEqual(len(assets[name]), length)
                self.assertEqual(hashlib.sha256(assets[name]).hexdigest(), digest)

    def test_pack_sha_is_correct(self):
        data = base64.b64decode((ROOT / BUNDLE).read_text().strip(), validate=True)
        self.assertEqual(hashlib.sha256(data).hexdigest(), BUNDLE_SHA256)

    def test_corrupt_bundle_fails_closed_without_writing_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / BUNDLE
            target.parent.mkdir(parents=True)
            target.write_text("invalid archive")
            with self.assertRaises(ValueError):
                restore_assets(root)
            self.assertFalse((root / "historical-source/bidmason-website.html").exists())

    def test_restore_writes_only_quarantined_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / BUNDLE
            target.parent.mkdir(parents=True)
            shutil.copyfile(ROOT / BUNDLE, target)
            paths = restore_assets(root)
            self.assertEqual(len(paths), 4)
            self.assertTrue(all(p.relative_to(root).parts[0] == "historical-source" for p in paths))
            self.assertFalse((root / "app").exists())
            self.assertEqual(paths, restore_assets(root))

    def test_existing_conflicting_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / BUNDLE
            target.parent.mkdir(parents=True)
            shutil.copyfile(ROOT / BUNDLE, target)
            output = root / "historical-source/bidmason-website.html"
            output.write_bytes(b"different")
            with self.assertRaises(FileExistsError):
                restore_assets(root)
            self.assertEqual(output.read_bytes(), b"different")


if __name__ == "__main__":
    unittest.main()
