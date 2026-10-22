"""Adversarial tests for Item 6 live-server import containment policy."""
from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from ci.item6_runtime_boundary import findings


class RuntimeBoundaryTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def write(self, name: str, body: str):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
        return target

    def verify(self, *expected):
        notes = findings(self.root)
        self.assertEqual(len(notes), len(expected), notes)
        for substring in expected:
            self.assertTrue(any(substring in issue for issue in notes), notes)
        return notes

    def test_internal_preview_can_use_non_sending_simulation(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const preview = true;")
        self.write("app/delivery-lab/page.tsx",
                   'import {preview} from "../../lib/synthetic-dispatch-reservation";')
        self.verify()

    def test_direct_live_api_route_import_is_blocked(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const mock = true;")
        self.write("app/api/send/route.ts",
                   'import {mock} from "../../../lib/synthetic-dispatch-reservation";')
        self.verify("imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_top_level_app_route_and_page_api_are_both_checked(self):
        self.write("lib/outbound-preflight.ts", "export const mock=true;")
        self.write("app/route.ts", 'import "../lib/outbound-preflight";')
        self.write("pages/api/send.ts", 'export {mock} from "../../lib/outbound-preflight";')
        self.verify("app/route.ts", "pages/api/send.ts")

    def test_transitive_multiline_imports_and_type_imports_are_blocked(self):
        self.write("src/lib/wrapper.ts",
                   'import type {Type} from "../../lib/buyer-view-grant.ts";')
        self.write("lib/buyer-view-grant.ts", "export type Type = string;")
        self.write("src/app/api/grants/route.ts",
                   'import {\n ignored,\n other \n} from "../../../lib/wrapper";')
        # this file is intentionally in src/lib rather than root lib:
        # fix import to resolve to src/lib, then follow second edge to root lib.
        self.write("src/app/api/grants/route.ts",
                   'import {\n ignored,\n other \n} from "../../../lib/wrapper";')
        self.verify("imports offline-only lib/buyer-view-grant.ts")

    def test_aliases_and_require_are_walked(self):
        self.write("lib/recipient-aware-delivery-triage.ts", "export const x = true;")
        self.write("app/api/triage/route.ts",
                   'const x = require("@/lib/recipient-aware-delivery-triage");')
        self.verify("imports offline-only lib/recipient-aware-delivery-triage.ts")

    def test_server_action_and_global_entrypoints_are_blocked(self):
        self.write("lib/follow-up-assessment.ts", "export const x = true;")
        self.write("app/actions.ts",
                   '"use server";\nimport "@/lib/follow-up-assessment";')
        self.write("middleware.ts", 'import "./lib/follow-up-assessment";')
        self.write("src/instrumentation.ts", 'import "../lib/follow-up-assessment";')
        self.verify("app/actions.ts", "middleware.ts", "src/instrumentation.ts")

    def test_dynamic_literal_is_checked_and_unknown_dynamic_fails_closed(self):
        self.write("lib/buyer-response-draft.ts", "export const x = true;")
        self.write("app/api/respond/route.ts",
                   'async function load(){ return import("../../../lib/buyer-response-draft"); }')
        self.verify("imports offline-only lib/buyer-response-draft.ts")
        self.write("app/api/respond/route.ts",
                   'async function load(name: string){ return import(name); }')
        self.verify("unreviewed dynamic module loading")

    def test_safe_external_packages_and_local_helpers_are_allowed(self):
        self.write("app/api/ping/route.ts",
                   'import {z} from "zod"; import "./health";')
        self.write("app/api/ping/health.ts", 'export const healthy = true;')
        self.verify()

    def test_unresolved_local_module_fails_closed(self):
        self.write("app/api/ping/route.ts", 'import "./not-here";')
        self.verify("Unresolved local code dependency")

    def test_relative_escape_outside_root_fails_closed(self):
        self.write("app/api/ping/route.ts",
                   'import "../../../../../../outside/server";')
        self.verify("escaped repository root")

    def test_default_server_rendered_home_and_route_group_pages_fail_closed(self):
        self.write("lib/follow-up-assessment.ts", "export const helper=true;")
        self.write("app/page.tsx", 'import "../lib/follow-up-assessment";')
        self.write("app/(backoffice)/bids/page.tsx",
                   'import "../../../lib/follow-up-assessment";')
        self.verify("app/page.tsx", "app/(backoffice)/bids/page.tsx")

    def test_layout_template_and_loading_components_cannot_use_offline_models(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const helper=true;")
        self.write("app/layout.tsx", 'import "../lib/synthetic-dispatch-reservation";')
        self.write("app/(private)/template.tsx",
                   'import "../../lib/synthetic-dispatch-reservation";')
        self.write("app/(private)/loading.tsx",
                   'import "../../lib/synthetic-dispatch-reservation";')
        self.verify("app/layout.tsx", "app/(private)/template.tsx",
                    "app/(private)/loading.tsx")

    def test_pages_router_non_api_ssr_entries_also_fail_closed(self):
        self.write("lib/buyer-view-grant.ts", "export const x=true;")
        self.write("pages/quote.tsx", 'import "../lib/buyer-view-grant";')
        self.write("src/pages/deals/list.tsx",
                   'import "../../../lib/buyer-view-grant";')
        self.verify("pages/quote.tsx", "src/pages/deals/list.tsx")

    def test_next_proxy_and_src_proxy_are_live_entrypoints(self):
        self.write("lib/synthetic-webhook-contact-hold.ts", "export const x=true;")
        self.write("proxy.ts", 'import "./lib/synthetic-webhook-contact-hold";')
        self.write("src/proxy.ts",
                   'import "../lib/synthetic-webhook-contact-hold";')
        self.verify("proxy.ts", "src/proxy.ts")

    def test_preview_exemption_is_only_for_the_named_fictional_page(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/delivery-lab/page.tsx",
                   'import "../../lib/synthetic-dispatch-reservation";')
        self.write("app/delivery-lab/layout.tsx",
                   'import "../../lib/synthetic-dispatch-reservation";')
        self.write("app/delivery-lab/api/route.ts",
                   'import "../../../lib/synthetic-dispatch-reservation";')
        self.verify("app/delivery-lab/layout.tsx",
                    "app/delivery-lab/api/route.ts")

    def test_preview_cannot_add_a_server_action_even_with_exact_page_name(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/delivery-lab/page.tsx",
                   '"use server";\nimport "../../lib/synthetic-dispatch-reservation";')
        self.verify("app/delivery-lab/page.tsx")

    def test_transitive_component_import_reachable_from_server_page_is_rejected(self):
        self.write("lib/buyer-response-draft.ts", "export const x=true;")
        self.write("app/components/preview-widget.tsx",
                   'import "../../lib/buyer-response-draft";')
        self.verify()  # an unreferenced module is not a live entrypoint
        self.write("app/page.tsx",
                   'import "./components/preview-widget";')
        self.verify("app/page.tsx")

    def test_src_app_page_and_error_fallback_entries_are_live(self):
        self.write("lib/delivery-event-projection.ts", "export const x=true;")
        self.write("src/app/page.tsx",
                   'import "../../lib/delivery-event-projection";')
        self.write("src/app/(portal)/error.tsx",
                   'import "../../../lib/delivery-event-projection";')
        self.write("src/app/(portal)/not-found.tsx",
                   'import "../../../lib/delivery-event-projection";')
        self.verify("src/app/page.tsx", "src/app/(portal)/error.tsx",
                    "src/app/(portal)/not-found.tsx")

    def test_real_repository_remains_safe_without_live_api_entrypoints(self):
        repo = Path(__file__).resolve().parents[1]
        self.assertEqual(findings(repo), [])


if __name__ == "__main__":
    unittest.main()
