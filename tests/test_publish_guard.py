"""Negative regressions for accidentally turning a mockup into a live page."""
from pathlib import Path
import tempfile
import unittest

from ci.publish_guard import findings


class PublishGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "app").mkdir()
        (self.root / "app/layout.tsx").write_text("robots: { index: false, follow: false }")
        (self.root / "app/page.tsx").write_text("No live lead capture")

    def test_clean_development_preview(self):
        self.assertEqual(findings(self.root), [])

    def test_historical_pdf_in_public_is_blocked(self):
        (self.root / "public").mkdir()
        (self.root / "public/harbor-coast-proposal-unit-turn-program-v2026-06-11.pdf").write_bytes(b"%PDF")
        self.assertTrue(any("Historical source" in e for e in findings(self.root)))

    def test_historical_sources_outside_public_paths_are_allowed(self):
        quarantine = self.root / "historical-source"
        quarantine.mkdir()
        (quarantine / "bidmason-website.html").write_text("<form></form>")
        self.assertEqual(findings(self.root), [])

    def test_fake_confirmation_without_backend_is_blocked(self):
        (self.root / "app/page.tsx").write_text("No live lead capture; e.preventDefault(); formSuccess.classList.add('show');")
        self.assertTrue(any("fake form success" in e for e in findings(self.root)))

    def test_noindex_must_remain_until_verified_backend(self):
        (self.root / "app/layout.tsx").write_text("robots: { index: true }")
        self.assertTrue(any("noindex" in e for e in findings(self.root)))

    def test_disabled_intake_notice_must_remain(self):
        (self.root / "app/page.tsx").write_text("<main>Welcome</main>")
        self.assertTrue(any("disabled intake" in e for e in findings(self.root)))
