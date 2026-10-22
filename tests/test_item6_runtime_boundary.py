"""Adversarial tests for Item 6 live-server import containment policy."""
from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
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

    def test_comment_separated_direct_import_and_reexport_are_not_invisible(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const mock = true;")
        self.write("app/api/send/route.ts",
                   'import/*comment*/{mock} from/*comment*/"../../../lib/synthetic-dispatch-reservation";')
        self.write("app/api/review/route.ts",
                   'export {mock} from /* multi line\n note */ "../../../lib/synthetic-dispatch-reservation";')
        self.verify("app/api/send/route.ts", "app/api/review/route.ts")

    def test_comment_separated_side_effect_dynamic_and_require_imports_block(self):
        self.write("lib/buyer-view-grant.ts", "export const mock = true;")
        self.write("app/api/grant/route.ts",
                   'import/* comment */"../../../lib/buyer-view-grant";')
        self.write("app/api/grant2/route.ts",
                   'async function load() { return import/* comment */("../../../lib/buyer-view-grant"); }')
        self.write("app/api/grant3/route.ts",
                   'const mock = require/* comment */("../../../lib/buyer-view-grant");')
        self.verify("app/api/grant/route.ts", "app/api/grant2/route.ts",
                    "app/api/grant3/route.ts")

    def test_comment_separated_import_still_blocks_missing_local_dependency(self):
        self.write("app/api/ping/route.ts",
                   'import {missing} from/* ignored */"./not-here";')
        self.verify("Unresolved local code dependency")

    def test_comment_separated_safe_dependency_still_permitted(self):
        self.write("app/api/ping/route.ts",
                   'import/* local */{healthy} from/* comment */"./health";')
        self.write("app/api/ping/health.ts", "export const healthy=true;")
        self.verify()

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

    def test_server_action_directive_before_code_on_same_line_blocks_import(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/actions.ts",
                   "\'use server\'; import {x} from \"../lib/synthetic-dispatch-reservation\";")
        self.verify("app/actions.ts imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_server_action_comment_separated_directive_and_reexport_block(self):
        self.write("src/lib/buyer-view-grant.ts", "export const x=true;")
        self.write("src/actions.ts",
                   "\"use server\"/* comment */;export {x} from \"./lib/buyer-view-grant\";")
        self.verify("src/actions.ts imports offline-only src/lib/buyer-view-grant.ts")

    def test_server_action_asi_directive_with_line_comment_is_scanned(self):
        self.write("lib/outbound-preflight.ts", "export const x=true;")
        self.write("lib/exported-action.ts",
                   "\'use server\' // harmless note\n"
                   'export {x} from "./outbound-preflight";')
        self.verify("lib/exported-action.ts imports offline-only lib/outbound-preflight.ts")

    def test_ecmascript_bom_before_module_directive_cannot_hide_action(self):
        self.write("lib/buyer-view-grant.ts", "export const x=true;")
        self.write("src/actions.ts",
                   '\ufeff/* header */ "use server";'
                   ' import {x} from "../lib/buyer-view-grant";')
        self.verify("src/actions.ts imports offline-only lib/buyer-view-grant.ts")

    def test_ecmascript_bom_inside_function_action_cannot_hide_import(self):
        self.write("src/lib/buyer-response-draft.ts", "export const x=true;")
        self.write("src/actions.ts",
                   'export async function submit(){\ufeff"use server";'
                   ' return import\ufeff("./lib/buyer-response-draft"); }')
        self.verify("src/actions.ts imports offline-only src/lib/buyer-response-draft.ts")

    def test_ecmascript_bom_between_static_import_tokens_is_not_invisible(self):
        self.write("lib/outbound-preflight.ts", "export const x=true;")
        self.write("app/api/submit/route.ts",
                   'import\ufeff{x}\ufefffrom\ufeff"../../../lib/outbound-preflight";')
        self.verify("app/api/submit/route.ts imports offline-only lib/outbound-preflight.ts")

    def test_bom_and_leading_comment_remove_preview_action_exemption(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/delivery-lab/page.tsx",
                   '\ufeff// note\n"use server";'
                   ' import "../../lib/synthetic-dispatch-reservation";')
        self.verify("app/delivery-lab/page.tsx imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_leading_module_block_comment_does_not_hide_server_action(self):
        self.write("lib/buyer-view-grant.ts", "export const x=true;")
        self.write("src/actions.ts",
                   '/* file header */ "use server";'
                   ' import {x} from "../lib/buyer-view-grant";')
        self.verify("src/actions.ts imports offline-only lib/buyer-view-grant.ts")

    def test_line_comment_before_module_directive_cannot_hide_server_action(self):
        self.write("lib/outbound-preflight.ts", "export const x=true;")
        self.write("src/actions.ts",
                   '// ownership review\n"use server";'
                   ' export {x} from "../lib/outbound-preflight";')
        self.verify("src/actions.ts imports offline-only lib/outbound-preflight.ts")

    def test_function_scoped_server_action_with_line_comment_blocks(self):
        self.write("src/lib/buyer-view-grant.ts", "export const x=true;")
        self.write("src/actions.ts",
                   'export async function grant() { // review rationale\n'
                   ' "use server"; return import("./lib/buyer-view-grant"); }')
        self.verify("src/actions.ts imports offline-only src/lib/buyer-view-grant.ts")

    def test_preview_leading_comment_cannot_preserve_server_action_exception(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/delivery-lab/page.tsx",
                   '/* fictional only */ "use server";'
                   ' import "../../lib/synthetic-dispatch-reservation";')
        self.verify("app/delivery-lab/page.tsx imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_comment_header_with_safe_local_dependency_remains_permitted(self):
        self.write("src/lib/ordinary.ts", "export const ok=true;")
        self.write("src/app/api/health/route.ts",
                   '/* header */ // note\n'
                   'import {ok} from "../../../lib/ordinary";'
                   ' export const GET = () => ok;')
        self.verify()

    def test_inline_server_directive_removes_named_preview_exemption(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/delivery-lab/page.tsx",
                   "\'use server\'; import {x} from \"../../lib/synthetic-dispatch-reservation\";")
        self.verify("app/delivery-lab/page.tsx imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_inline_server_directive_with_safe_import_is_not_blocked(self):
        self.write("lib/normal-helper.ts", "export const x=true;")
        self.write("app/actions.ts",
                   "\'use server\'; import {x} from \"../lib/normal-helper\";")
        self.verify()

    def test_inline_function_scoped_server_action_cannot_import_synthetic(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const fake=true;")
        self.write("lib/actions.ts",
                   'export async function reserve(){ "use server";'
                   ' return import("./synthetic-dispatch-reservation"); }')
        self.verify("lib/actions.ts imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_inline_function_scoped_action_with_leading_comment_blocks(self):
        self.write("src/lib/buyer-view-grant.ts", "export const x=true;")
        self.write("src/actions.ts",
                   'export async function view(){ /* audit note */ "use server";'
                   ' return require("./lib/buyer-view-grant"); }')
        self.verify("src/actions.ts imports offline-only src/lib/buyer-view-grant.ts")

    def test_inline_function_server_directive_removes_preview_exemption(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/delivery-lab/page.tsx",
                   'export default async function Page(){ "use server";'
                   ' return import("../../lib/synthetic-dispatch-reservation"); }')
        self.verify("app/delivery-lab/page.tsx imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_plain_string_and_safe_inline_action_do_not_create_false_violation(self):
        self.write("lib/ordinary-helper.ts", "export const ok=true;")
        self.write("lib/ordinary-action.ts",
                   'const description = "{ use server; }"; '
                   'export async function run(){ "use server";'
                   ' return import("./ordinary-helper"); }')
        self.verify()

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

    def test_direct_src_lib_import_from_src_api_route_fails_closed(self):
        self.write("src/lib/synthetic-dispatch-reservation.ts",
                   "export const volatile=true;")
        self.write("src/app/api/delivery/route.ts",
                   'import "../../../lib/synthetic-dispatch-reservation";')
        self.verify("imports offline-only src/lib/synthetic-dispatch-reservation.ts")

    def test_root_app_page_detects_alias_to_src_lib_offline_module(self):
        self.write("src/lib/buyer-view-grant.ts", "export const claim=true;")
        self.write("app/buyer/page.tsx",
                   'import "@/src/lib/buyer-view-grant";')
        self.verify("app/buyer/page.tsx imports offline-only src/lib/buyer-view-grant.ts")

    def test_transitive_src_lib_barrel_does_not_hide_synthetic_module(self):
        self.write("src/lib/synthetic-webhook-contact-hold.ts",
                   "export const pending=true;")
        self.write("src/lib/index.ts",
                   'export {pending} from "./synthetic-webhook-contact-hold";')
        self.write("src/app/api/callback/route.ts",
                   'import {pending} from "../../../lib";')
        self.verify("imports offline-only src/lib/synthetic-webhook-contact-hold.ts")

    def test_both_source_roots_reject_their_own_synthetic_module(self):
        self.write("lib/follow-up-assessment.ts", "export const x=true;")
        self.write("src/lib/follow-up-assessment.ts", "export const x=true;")
        self.write("app/api/first/route.ts",
                   'import "../../../lib/follow-up-assessment";')
        self.write("app/api/second/route.ts",
                   'import "../../../src/lib/follow-up-assessment";')
        self.verify("lib/follow-up-assessment.ts",
                    "src/lib/follow-up-assessment.ts")

    def test_src_lib_only_protects_named_helpers_not_unrelated_library(self):
        self.write("src/lib/ordinary-display.ts", "export const text=true;")
        self.write("src/app/api/health/route.ts",
                   'import "../../../lib/ordinary-display";')
        self.verify()

    def test_fictional_preview_exception_still_scoped_with_src_lib_module(self):
        self.write("src/lib/synthetic-dispatch-reservation.ts",
                   "export const fake=true;")
        self.write("app/delivery-lab/page.tsx",
                   'import "../../src/lib/synthetic-dispatch-reservation";')
        self.verify()  # Only the exact non-sending preview remains exempt.
        self.write("app/delivery-lab/api/route.ts",
                   'import "../../../src/lib/synthetic-dispatch-reservation";')
        self.verify("imports offline-only src/lib/synthetic-dispatch-reservation.ts")

    def test_long_multiline_named_import_cannot_bypass_policy(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const sample=true;")
        imports = ",\n  ".join(f"illustrativeIdentifier{number:03d}" for number in range(110))
        self.assertGreater(len(imports), 800)
        self.write("app/page.tsx",
                   'import {\n  ' + imports
                   + '\n} from "../lib/synthetic-dispatch-reservation";')
        self.verify("imports offline-only lib/synthetic-dispatch-reservation.ts")

    def test_long_reexport_from_barrel_is_also_checked(self):
        self.write("src/lib/recipient-suppression-history.ts",
                   "export const sample=true;")
        names = ",\n  ".join(f"syntheticName{number:03d}" for number in range(125))
        self.write("src/lib/barrel.ts",
                   'export {\n  ' + names
                   + '\n} from "./recipient-suppression-history";')
        self.write("src/app/page.tsx", 'import "../lib/barrel";')
        self.verify("imports offline-only src/lib/recipient-suppression-history.ts")

    def test_long_type_only_import_does_not_hide_offline_code(self):
        self.write("lib/buyer-view-grant.ts", "export type BuyerView=never;")
        names = ",\n  ".join(f"UnverifiedClaim{number:03d}" for number in range(130))
        self.write("app/api/grants/route.ts",
                   'import type {\n  ' + names
                   + '\n} from "../../../lib/buyer-view-grant";')
        self.verify("imports offline-only lib/buyer-view-grant.ts")

    def test_long_safe_import_does_not_hide_a_later_forbidden_import(self):
        self.write("lib/delivery-event-projection.ts", "export const sample=true;")
        self.write("app/api/test/long-import.ts", "export const fake=true;")
        names = ",\n  ".join(f"AllowedIdentifier{number:03d}" for number in range(100))
        self.write("app/api/test/route.ts",
                   'import {\n  ' + names + '\n} from "./long-import";\n'
                   + 'import "../../../lib/delivery-event-projection";')
        self.verify("imports offline-only lib/delivery-event-projection.ts")

    def test_unbounded_import_rule_does_not_drop_safe_long_module(self):
        names = ",\n  ".join(f"ReadableField{number:03d}" for number in range(160))
        self.write("lib/normal-data-shape.ts", "export const sample=true;")
        self.write("app/page.tsx",
                   'import {\n  ' + names
                   + '\n} from "../lib/normal-data-shape";')
        self.verify()

    def test_tsconfig_paths_alias_cannot_redirect_ignored_specifier(self):
        self.write("lib/synthetic-dispatch-reservation.ts", "export const x=true;")
        self.write("app/api/send/route.ts", 'import "#hidden";')
        self.verify()  # No module alias currently resolves this bare specifier.
        self.write("tsconfig.json",
                   '{"compilerOptions":{"paths":{"#hidden":["./lib/synthetic-dispatch-reservation"]}}}')
        self.verify("unreviewed TS path aliases/baseUrl resolution")

    def test_src_tsconfig_alias_does_not_escape_scan(self):
        self.write("src/tsconfig.json",
                   '{"compilerOptions":{"paths":{"@/*":["lib/*"]}}}')
        self.verify("src/tsconfig.json: unreviewed TS path aliases/baseUrl")

    def test_baseurl_only_is_not_treated_as_external_package_resolution(self):
        self.write("tsconfig.json",
                   '{"compilerOptions":{"baseUrl":"./"}}')
        self.verify("unreviewed TS path aliases/baseUrl")

    def test_extended_tsconfig_cannot_inherit_unreviewed_aliases(self):
        self.write("tsconfig.json",
                   '{"extends":"./tsconfig.aliases.json","compilerOptions":{}}')
        self.write("tsconfig.aliases.json",
                   '{"compilerOptions":{"paths":{"#private":["./lib/synthetic-dispatch-reservation"]}}}')
        self.verify("unreviewed inherited/referenced TS module resolution",
                    "unreviewed TS path aliases/baseUrl resolution")

    def test_referenced_tsconfig_requires_explicit_resolver_review(self):
        self.write("tsconfig.json",
                   '{"references":[{"path":"./src"}],"compilerOptions":{}}')
        self.verify("unreviewed inherited/referenced TS module resolution")

    def test_jsconfig_alias_is_not_implicitly_trusted(self):
        self.write("jsconfig.json",
                   '{"compilerOptions":{"baseUrl":".","paths":{"#/*":["lib/*"]}}}')
        self.verify("jsconfig.json: unreviewed TS path aliases/baseUrl")

    def test_package_import_map_cannot_hide_offline_model(self):
        self.write("package.json",
                   '{"name":"fictional-package","imports":{"#internal":"./lib/synthetic-dispatch-reservation.ts"}}')
        self.verify("package.json: unreviewed package imports/exports resolution")

    def test_package_self_exports_cannot_hide_offline_model(self):
        self.write("app/package.json",
                   '{"name":"app","exports":{"./private":"../lib/buyer-view-grant.ts"}}')
        self.verify("app/package.json: unreviewed package imports/exports resolution")

    def test_malformed_or_nonobject_module_configs_fail_closed(self):
        self.write("tsconfig.json", "{\n // hidden aliases\n }")
        self.write("jsconfig.json", "[]")
        self.verify("tsconfig.json: unreadable/unreviewed module configuration",
                    "jsconfig.json: module configuration must be an object")

    def test_unrelated_valid_module_config_remains_permitted(self):
        self.write("tsconfig.json",
                   '{"compilerOptions":{"strict":true,"moduleResolution":"bundler"}}')
        self.write("package.json",
                   '{"name":"safe-fictional-preview","private":true}')
        self.write("app/page.tsx", 'import {fake} from "external-package";')
        self.verify()

    # Match logical file components: Windows may canonicalize TemporaryDirectory
    # roots to a different absolute spelling than the fixture Path objects.
    def test_symlinked_live_route_is_not_trusted_as_scanned_source(self):
        entry = self.write("app/api/send/route.ts", "export const GET = () => null;")
        with patch.object(Path, "is_symlink",
                          autospec=True, side_effect=lambda p: p.name == "route.ts" and p.parent.name == "send"):
            self.verify("app/api/send/route.ts: unreviewed symlinked source path")

    def test_symlinked_local_helper_is_not_assumed_to_resolve_safely(self):
        helper = self.write("lib/safe-looking-helper.ts", "export const x = true;")
        self.write("app/api/ping/route.ts",
                   'import {x} from "../../../lib/safe-looking-helper";')
        with patch.object(Path, "is_symlink",
                          autospec=True, side_effect=lambda p: p.name == "safe-looking-helper.ts"):
            self.verify("lib/safe-looking-helper.ts: unreviewed symlinked source path")

    def test_symlinked_source_directory_blocks_even_without_visible_children(self):
        self.write("src/lib/ordinary-helper.ts", "export const ok = true;")
        suspect = self.root / "src/lib"
        with patch.object(Path, "is_symlink",
                          autospec=True, side_effect=lambda p: p.name == "lib" and p.parent.name == "src"):
            self.verify("src/lib: unreviewed symlinked source path")

    def test_symlinked_root_proxy_is_a_runtime_boundary_violation(self):
        proxy = self.write("proxy.ts", "export const proxy = () => null;")
        with patch.object(Path, "is_symlink",
                          autospec=True, side_effect=lambda p: p.name == "proxy.ts"):
            self.verify("proxy.ts: unreviewed symlinked source path")

    def test_real_repository_remains_safe_without_live_api_entrypoints(self):
        repo = Path(__file__).resolve().parents[1]
        self.assertEqual(findings(repo), [])


if __name__ == "__main__":
    unittest.main()
