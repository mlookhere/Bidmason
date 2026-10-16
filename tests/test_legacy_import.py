"""Tests for allowlisted, checksum-pinned, non-publishing legacy asset import."""
from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from scripts.import_legacy_assets import REQUIRED, import_assets


class LegacyImporterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.zip_path = self.root / "legacy.zip"
        self.sample = b"<html>historical, no backend</html>"
        self.relative = "bidmason-website.html"
        self.pinned = {self.relative: (len(self.sample), hashlib.sha256(self.sample).hexdigest())}

    def make_zip(self, *, bad=False, extra=False, missing=False):
        with ZipFile(self.zip_path, "w") as archive:
            if not missing:
                archive.writestr("bidmason/" + self.relative, b"tampered" if bad else self.sample)
            if extra:
                archive.writestr("../../evil.py", "malicious")

    def test_import_only_allowlisted_source(self):
        self.make_zip(extra=True)
        with patch.dict(REQUIRED, self.pinned, clear=True):
            imported = import_assets(self.zip_path, self.root)
        self.assertEqual(len(imported), 1)
        self.assertEqual(imported[0].read_bytes(), self.sample)
        self.assertFalse((self.root / "evil.py").exists())
        self.assertFalse((self.root / "app").exists())

    def test_tampering_fails_closed(self):
        self.make_zip(bad=True)
        with patch.dict(REQUIRED, self.pinned, clear=True):
            with self.assertRaises(ValueError):
                import_assets(self.zip_path, self.root)
        self.assertFalse((self.root / "historical-source").exists())

    def test_missing_asset_fails_closed(self):
        self.make_zip(missing=True)
        with patch.dict(REQUIRED, self.pinned, clear=True):
            with self.assertRaises(KeyError):
                import_assets(self.zip_path, self.root)

    def test_conflicting_existing_file_is_not_replaced(self):
        self.make_zip()
        target = self.root / "historical-source" / self.relative
        target.parent.mkdir(parents=True)
        target.write_bytes(b"previously published? do not overwrite")
        with patch.dict(REQUIRED, self.pinned, clear=True):
            with self.assertRaises(FileExistsError):
                import_assets(self.zip_path, self.root)
        self.assertEqual(target.read_bytes(), b"previously published? do not overwrite")

    def test_source_inventory_pin_count(self):
        self.assertEqual(len(REQUIRED), 4)
        self.assertEqual(len({expected[1] for expected in REQUIRED.values()}), 4)


if __name__ == "__main__":
    unittest.main()
