"""Negative regressions for accidentally turning a mockup into a live page."""
from pathlib import Path
from shutil import copyfile
import tempfile
import unittest
from unittest.mock import patch

from ci.publish_guard import findings, delivery_lab_findings, LAB_TRANSITIVE_IMPORTS


class PublishGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "app").mkdir()
        (self.root / "app/layout.tsx").write_text("robots: { index: false, follow: false }")
        (self.root / "app/page.tsx").write_text("No live lead capture")
        copyfile(Path(__file__).resolve().parents[1] / "next.config.ts",
                 self.root / "next.config.ts")


    def with_lab(self):
        repo = Path(__file__).resolve().parents[1]
        (self.root / "app/delivery-lab").mkdir(exist_ok=True)
        (self.root / "lib").mkdir(exist_ok=True)
        copyfile(repo / "app/delivery-lab/page.tsx", self.root / "app/delivery-lab/page.tsx")
        copyfile(repo / "lib/delivery-lab-fixtures.ts", self.root / "lib/delivery-lab-fixtures.ts")
        for relative in LAB_TRANSITIVE_IMPORTS:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            copyfile(repo / relative, target)

    def replace_lab(self, path, old, new):
        target = self.root / path
        source = target.read_text()
        assert old in source, f"Missing fixture marker: {old}"
        target.write_text(source.replace(old, new, 1))

    def test_actual_public_lab_fixture_is_allowlisted(self):
        self.with_lab()
        self.assertEqual(delivery_lab_findings(self.root), [])
        self.assertEqual(findings(self.root), [])


    def test_indirect_helper_network_storage_and_actions_are_rejected(self):
        for code in ("fetch('https://real.example/api')",
                     "process.env.REAL_PROVIDER_KEY",
                     "import('./unreviewed-backend.ts')",
                     "localStorage.getItem('token')",
                     "'use server'"):
            with self.subTest(code=code):
                self.with_lab()
                helper = self.root / "lib/delivery-triage.ts"
                helper.write_text(helper.read_text() + "\n// unapproved\n" + code + ";\n")
                self.assertTrue(any("Public lab dependency must remain offline" in e
                                    for e in findings(self.root)))

    def test_indirect_helper_import_reexport_and_side_effect_drift_are_rejected(self):
        for code in ('import {createClient} from "@supabase/supabase-js";',
                     'import "./new-side-effect.ts";',
                     'export {send} from "./mailer.ts";'):
            with self.subTest(code=code):
                self.with_lab()
                helper = self.root / "lib/delivery-review-summary.ts"
                helper.write_text(helper.read_text() + "\n" + code)
                self.assertTrue(any("Unreviewed public lab transitive imports" in e
                                    for e in findings(self.root)))

    def test_new_deal_outcome_dependency_stays_publicly_safe(self):
        # The exact fictional outcome helper is reachable from the public lab
        # via current CRM triage; additions must not gain external side effects.
        self.with_lab()
        self.assertEqual(findings(self.root), [])
        target = self.root / "lib/synthetic-deal-outcome.ts"
        for code in ("fetch('https://customer.example/api')",
                     "process.env.PROVIDER_SECRET",
                     'import {send} from "./mailer.ts";',
                     'export {send} from "./mailer.ts";',
                     'import "./side-effect.ts";'):
            with self.subTest(code=code):
                self.with_lab()
                target.write_text(target.read_text() + "\\n" + code + "\\n")
                self.assertTrue(any("lib/synthetic-deal-outcome.ts" in message
                                    for message in findings(self.root)))
        self.with_lab()
        target.unlink()
        self.assertTrue(any("Missing or symlinked lab dependency" in message
                            and "lib/synthetic-deal-outcome.ts" in message
                            for message in findings(self.root)))

    def test_missing_and_symlinked_transitive_modules_fail_closed(self):
        self.with_lab()
        helper = self.root / "lib/recipient-suppression-history.ts"
        helper.unlink()
        self.assertTrue(any("Missing or symlinked lab dependency" in e
                            for e in findings(self.root)))
        self.with_lab()
        old = Path.is_symlink
        with patch.object(Path, "is_symlink",
                          lambda path: path == helper or old(path)):
            self.assertTrue(any("Missing or symlinked lab dependency" in e
                                for e in findings(self.root)))

    def test_nonfictional_email_in_indirect_dependency_is_rejected(self):
        self.with_lab()
        helper = self.root / "lib/recipient-suppression-history.ts"
        helper.write_text(helper.read_text() + '\nconst address="buyer@real-domain.com";\n')
        self.assertTrue(any("Nonfictional email in public lab dependency" in e
                            for e in findings(self.root)))

    def test_unrelated_module_is_not_a_public_lab_dependency(self):
        self.with_lab()
        other = self.root / "lib/unrelated-private-experiment.ts"
        other.write_text("const test = () => fetch('/unrelated');")
        self.assertEqual(findings(self.root), [])

    def test_missing_fixture_and_added_api_subroute_fail_closed(self):
        self.with_lab()
        (self.root / "lib/delivery-lab-fixtures.ts").unlink()
        self.assertTrue(any("requires fixed" in x for x in findings(self.root)))
        self.with_lab()
        (self.root / "app/delivery-lab/route.ts").write_text("export async function POST() {}")
        self.assertTrue(any("Unreviewed public delivery lab route" in x for x in findings(self.root)))

    def test_external_and_side_effect_imports_are_rejected(self):
        for code in ('import {createClient} from "@supabase/supabase-js";',
                     'import "./unreviewed-side-effect";'):
            with self.subTest(code=code):
                self.with_lab()
                file = self.root / "app/delivery-lab/page.tsx"
                file.write_text(file.read_text() + "\n" + code)
                self.assertTrue(any("Unreviewed public delivery lab imports" in x
                                    for x in findings(self.root)))

    def test_dynamic_data_sources_and_storage_are_rejected(self):
        for code in ("fetch('/api/customers')", "process.env.SECRET_KEY",
                     "cookies()", "import('./private-data')",
                     "localStorage.getItem('token')"):
            with self.subTest(code=code):
                self.with_lab()
                file = self.root / "app/delivery-lab/page.tsx"
                file.write_text(file.read_text() + "\nconst leak = () => " + code + ";")
                self.assertTrue(any("offline and read-only" in x for x in findings(self.root)))

    def test_forms_and_send_buttons_are_rejected(self):
        self.with_lab()
        self.replace_lab("app/delivery-lab/page.tsx", '<div className="lab-grid">',
                         '<div className="lab-grid"><form><button>Send</button></form>')
        self.assertTrue(any("offline and read-only" in x for x in findings(self.root)))

    def test_lab_requires_noindex_and_all_warning_copy(self):
        for old, new in (("index: false", "index: true"),
                         ("Synthetic records only", "Customer activity"),
                         ("not access controlled", "private"),
                         ("Delivery remains disabled", "Send now")):
            with self.subTest(old=old):
                self.with_lab()
                self.replace_lab("app/delivery-lab/page.tsx", old, new)
                self.assertTrue(any("missing safety marker" in x for x in findings(self.root)))

    def test_real_email_and_company_labels_are_rejected(self):
        self.with_lab()
        self.replace_lab("lib/delivery-lab-fixtures.ts",
                         "Fictional painting contractor", "Real Contractor LLC")
        self.assertTrue(any("six fictional scenarios" in x for x in findings(self.root)))
        self.with_lab()
        self.replace_lab("lib/delivery-lab-fixtures.ts",
                         "buyer-reply@fictional.example", "buyer-reply@customer-company.com")
        self.assertTrue(any("Nonfictional email" in x for x in findings(self.root)))


    def test_new_app_api_and_route_group_endpoints_are_blocked(self):
        for path in ("app/api/send/route.ts", "src/app/api/webhooks/route.js",
                     "app/(operator)/dispatch/route.ts",
                     "src/app/(buyer)/reply/route.ts"):
            with self.subTest(path=path):
                route = self.root / path
                route.parent.mkdir(parents=True, exist_ok=True)
                route.write_text("export async function POST() { return new Response('ok') }")
                self.assertTrue(any("Unapproved live Next endpoint" in x
                                    for x in findings(self.root)))
                route.unlink()

    def test_pages_api_endpoints_are_blocked(self):
        for path in ("pages/api/send.ts", "src/pages/api/notify.js"):
            with self.subTest(path=path):
                route = self.root / path
                route.parent.mkdir(parents=True, exist_ok=True)
                route.write_text("export default function handler() {}")
                self.assertTrue(any("Unapproved live Next endpoint" in x
                                    for x in findings(self.root)))
                route.unlink()

    def test_next_server_actions_outside_fictional_lab_are_blocked(self):
        for code in ('"use server"; export async function dispatch() {}',
                     "async function save(){ 'use server'; return 1; }"):
            with self.subTest(code=code):
                route = self.root / "app/operator/page.tsx"
                route.parent.mkdir(exist_ok=True)
                route.write_text(code)
                self.assertTrue(any("Unapproved Next server action" in x
                                    for x in findings(self.root)))
                route.unlink()

    def test_form_action_and_react_form_action_are_blocked(self):
        for code in ('<form action="/api/deliver"><button>Send</button></form>',
                     "<button formAction={send}>Send</button>"):
            with self.subTest(code=code):
                route = self.root / "app/operator/page.tsx"
                route.parent.mkdir(exist_ok=True)
                route.write_text(code)
                self.assertTrue(any("Unapproved mutating form action" in x
                                    for x in findings(self.root)))
                route.unlink()

    def test_middleware_proxy_and_instrumentation_entrypoints_are_blocked(self):
        for path in ("middleware.ts", "src/proxy.ts", "src/instrumentation.js"):
            with self.subTest(path=path):
                route = self.root / path
                route.parent.mkdir(parents=True, exist_ok=True)
                route.write_text("export default function handler() {}")
                self.assertTrue(any("Unapproved Next request handler" in x
                                    for x in findings(self.root)))
                route.unlink()

    def test_symlink_under_publishable_next_code_is_rejected(self):
        # Mock the platform-dependent filesystem predicate: no Windows skip.
        shortcut = self.root / "app/shortcut.ts"
        shortcut.write_text("export const secret = true")
        original = Path.is_symlink
        with patch.object(Path, "is_symlink",
                          lambda candidate: candidate == shortcut
                          or original(candidate)):
            self.assertTrue(any("Symlink in publishable Next tree" in x
                                for x in findings(self.root)))

    def test_unapproved_io_from_other_next_pages_is_rejected(self):
        for path, code in (
            ("app/operator/page.tsx", "const send = () => fetch('/api/send')"),
            ("src/app/(operator)/page.tsx", "navigator.sendBeacon('/contact', 'body')"),
            ("pages/lead.tsx", "const live = new WebSocket('wss://example.test')"),
            ("src/pages/contact.tsx", "localStorage.setItem('customer', 'x')"),
            ("app/operator/page.tsx", "const secret = process.env.SENDER_KEY"),
            ("pages/lead.tsx", "const db = createClient('https://example.test')"),
            ("app/operator/page.tsx", "const db = indexedDB.open('leads')"),
            ("pages/lead.tsx", "const stream = new EventSource('/events')"),
        ):
            with self.subTest(path=path, code=code):
                candidate = self.root / path
                candidate.parent.mkdir(parents=True, exist_ok=True)
                candidate.write_text(code)
                self.assertTrue(any("Unapproved Next network, storage or environment IO"
                                    in finding for finding in findings(self.root)))
                candidate.unlink()
        # Plain static views and explanatory text are allowed.
        page = self.root / "app/operator/page.tsx"
        page.parent.mkdir(exist_ok=True)
        page.write_text("export default function Page(){return <main>Fictional preview</main>}")
        self.assertEqual(findings(self.root), [])

    def test_static_public_pages_remain_permitted(self):
        page = self.root / "app/operator/page.tsx"
        page.parent.mkdir(exist_ok=True)
        page.write_text("export default function Demo(){return <main>Fictional preview</main>}")
        self.assertEqual(findings(self.root), [])
        self.with_lab()
        self.assertEqual(findings(self.root), [])


    def test_next_rewrites_and_redirects_cannot_be_enabled_silently(self):
        config = self.root / "next.config.ts"
        original = config.read_text(encoding="utf-8")
        for policy in ("rewrites: async () => [{source: '/send', destination: '/api/send'}],",
                       "redirects: async () => [{source: '/new', destination: '/external', permanent: false}],",
                       "experimental: { serverActions: { bodySizeLimit: '10mb' } },"):
            with self.subTest(policy=policy):
                config.write_text(original.replace("reactStrictMode: true,",
                                                   "reactStrictMode: true,\n  " + policy))
                self.assertTrue(any("Unreviewed Next runtime config drift" in x
                                    for x in findings(self.root)))
        config.write_text(original)
        self.assertEqual(findings(self.root), [])

    def test_missing_or_symlinked_reviewed_config_fails_closed(self):
        config = self.root / "next.config.ts"
        config.unlink()
        self.assertTrue(any("Missing or symlinked reviewed Next config" in x
                            for x in findings(self.root)))
        config.write_text("unreviewed")
        with patch.object(Path, "is_symlink", lambda path: path == config):
            self.assertTrue(any("Missing or symlinked reviewed Next config" in x
                                for x in findings(self.root)))

    def test_shadow_next_config_variants_are_rejected(self):
        for name in ("next.config.js", "next.config.mjs",
                     "next.config.cjs", "next.config.mts", "next.config.cts"):
            with self.subTest(name=name):
                candidate = self.root / name
                candidate.write_text("export default { rewrites: async () => [] }")
                self.assertTrue(any("Unreviewed alternate Next config" in x
                                    for x in findings(self.root)))
                candidate.unlink()

    def test_even_comment_drift_requires_explicit_next_config_review(self):
        config = self.root / "next.config.ts"
        current = config.read_text(encoding="utf-8")
        config.write_text(current + "\n// unreviewed deployment policy\n")
        self.assertTrue(any("Unreviewed Next runtime config drift" in x
                            for x in findings(self.root)))
        config.write_text(current)
        self.assertEqual(findings(self.root), [])

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

    def test_double_quoted_fake_confirmation_is_blocked(self):
        (self.root / "app/page.tsx").write_text(
            'No live lead capture; e.preventDefault(); document.getElementById("pfSuccess").classList.add("show");'
        )
        self.assertTrue(any("fake form success" in e for e in findings(self.root)))

    def test_noindex_must_remain_until_verified_backend(self):
        (self.root / "app/layout.tsx").write_text("robots: { index: true }")
        self.assertTrue(any("noindex" in e for e in findings(self.root)))

    def test_disabled_intake_notice_must_remain(self):
        (self.root / "app/page.tsx").write_text("<main>Welcome</main>")
        self.assertTrue(any("disabled intake" in e for e in findings(self.root)))
