"""Regression tests for source imports and tamper detection."""
from pathlib import Path
import tempfile
import unittest

from ci.source_integrity import IMPORTED_ORIGINAL_BLOBS, git_blob_sha, validate


class OriginalArchiveTests(unittest.TestCase):
    def test_imports_match_original_zip_blobs(self):
        self.assertEqual(validate(), [])

    def test_total_imports_recorded(self):
        self.assertEqual(len(IMPORTED_ORIGINAL_BLOBS), 28)

    def test_git_blob_sha_known_example(self):
        self.assertEqual(git_blob_sha(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")

    def test_missing_original_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            errors = validate(Path(folder))
            self.assertEqual(len(errors), 28)

    def test_tampered_original_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for relative in IMPORTED_ORIGINAL_BLOBS:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"tampered")
            errors = validate(root)
            self.assertEqual(len(errors), 28)


if __name__ == "__main__":
    unittest.main()
