"""H01 opt-in read-only live probe: tested offline; never grants release."""
from __future__ import annotations

import base64
import contextlib
import io
import urllib.error
import urllib.request
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from ci.item6_rls_readonly_probe import (
    MAX_RESPONSE, _NoRedirect, _get, main, probe_readonly_rls,
)

ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
USER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
USER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
REV_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
REV_B = "ffffffff-ffff-4fff-8fff-ffffffffffff"
URL = "https://" + "a" * 20 + ".supabase.co"
KEY = "sb_publishable_" + "k" * 25


def token(sub: str, **overrides) -> str:
    claims = {"sub": sub, "role": "authenticated", "exp": int(time.time()) + 86400}
    claims.update(overrides)
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return "header." + payload + ".signature"


class FakeTransport:
    def __init__(self):
        self.tokens = {token(USER_A): (USER_A, ORG_A), token(USER_B): (USER_B, ORG_B)}
        self.requests = []
        self.leak = False
        self.missing_own = False
        self.auth_rejected = False
        self.anon_leak = False
        self.anon_member_leak = False
        self.member_leak = False
        self.member_list_leak = False
        self.foreign_member_list_leak = False
        self.foreign_revision_list_leak = False
        self.revision_leak = False
        self.revision_list_leak = False
        self.revision_missing = False
        self.anon_revision_leak = False
        self.reject_auth_user = None
        self.anon_denials = {}
        self.auth_table_denial = None

    def __call__(self, url, headers):
        self.requests.append((url, headers))
        parts = urlsplit(url)
        query = parse_qs(parts.query)
        bearer = headers.get("Authorization", "").removeprefix("Bearer ")
        if parts.path == "/auth/v1/user":
            if self.auth_rejected or self.tokens[bearer][0] == self.reject_auth_user:
                return 401, {"message": "not authorized"}
            return 200, {"id": self.tokens[bearer][0], "is_anonymous": False}
        if not bearer:
            for table, denied in self.anon_denials.items():
                if parts.path.endswith("/" + table):
                    return denied
            if parts.path.endswith("/bm_brief_revisions"):
                return 200, ([{"id": REV_B, "organization_id": ORG_B}]
                             if self.anon_revision_leak else [])
            if parts.path.endswith("/bm_memberships"):
                return 200, ([{"organization_id": ORG_B, "user_id": USER_B}]
                             if self.anon_member_leak else [])
            return 200, ([{"id": ORG_A}] if self.anon_leak else [])
        user, own = self.tokens[bearer]
        if self.auth_table_denial is not None:
            return self.auth_table_denial
        if parts.path.endswith("/bm_organizations"):
            requested = query.get("id", [""])[0].removeprefix("eq.")
            rows = [{"id": own}] if not requested or requested == own else []
            if self.leak and requested and requested != own:
                rows = [{"id": requested}]
            if self.missing_own and requested == own:
                rows = []
        elif parts.path.endswith("/bm_memberships"):
            requested = query.get("organization_id", [""])[0].removeprefix("eq.")
            other = ORG_B if own == ORG_A else ORG_A
            other_user = USER_B if user == USER_A else USER_A
            rows = ([{"organization_id": own, "user_id": user}]
                    if requested in ("", own) else [])
            if (self.member_leak and requested == other
                    and query.get("user_id", [""])[0] == "eq." + other_user):
                rows = [{"organization_id": other, "user_id": other_user}]
            if self.member_list_leak and not requested:
                rows.append({"organization_id": other, "user_id": other_user})
            if (self.foreign_member_list_leak and requested == other
                    and "user_id" not in query):
                rows = [{"organization_id": other, "user_id": other_user}]
        elif parts.path.endswith("/bm_brief_revisions"):
            requested = query.get("id", [""])[0].removeprefix("eq.")
            own_rev, other_rev = (REV_A, REV_B) if own == ORG_A else (REV_B, REV_A)
            other_org = ORG_B if own == ORG_A else ORG_A
            scoped_org = query.get("organization_id", [""])[0].removeprefix("eq.")
            rows = ([{"id": own_rev, "organization_id": own}]
                    if requested in ("", own_rev) and scoped_org in ("", own) else [])
            if self.revision_missing and requested == own_rev:
                rows = []
            if self.revision_leak and requested == other_rev:
                rows = [{"id": other_rev, "organization_id": other_org}]
            if self.revision_list_leak and not requested and not scoped_org:
                rows.append({"id": other_rev, "organization_id": other_org})
            if (self.foreign_revision_list_leak
                    and query.get("organization_id") == ["eq." + other_org]
                    and not requested):
                rows = [{"id": other_rev, "organization_id": other_org}]
        else:
            raise AssertionError("Unexpected endpoint: " + parts.path)
        return 200, rows


class AuthenticatedReadOnlyProbeTests(unittest.TestCase):
    def run_probe(self, transport=None, **replacements):
        transport = transport or FakeTransport()
        args = dict(base=URL, publishable_key=KEY,
                    token_a=next(iter(transport.tokens)),
                    token_b=list(transport.tokens)[1],
                    org_a=ORG_A, org_b=ORG_B,
                    revision_a=REV_A, revision_b=REV_B, get=transport)
        args.update(replacements)
        return probe_readonly_rls(**args), transport

    def test_full_two_user_positive_and_negative_matrix_is_review_only(self):
        result, fake = self.run_probe()
        self.assertEqual(result["state"], "requires-independent-review")
        self.assertIs(result["releaseAuthorized"], False)
        self.assertIs(result["h01Accepted"], False)
        self.assertEqual(len(result["checks"]), 27)
        self.assertTrue(all(row["passed"] for row in result["checks"]))
        self.assertEqual(len(fake.requests), 27)
        self.assertEqual(sum(url.endswith("/auth/v1/user") for url, _ in fake.requests), 2)
        self.assertNotIn("Authorization", fake.requests[-1][1])
        # No JWT, project hostname, recipient or tenant identity is emitted.
        rendered = json.dumps(result)
        for secret in (KEY, URL, USER_A, USER_B, ORG_A, ORG_B, REV_A, REV_B,
                       *fake.tokens):
            self.assertNotIn(secret, rendered)
        self.assertIn("session-revocation", result["notTested"])
        self.assertIn("write-boundary", result["notTested"])

    def test_positive_controls_prevent_false_green_on_empty_or_closed_api(self):
        fake = FakeTransport()
        fake.missing_own = True
        result, fake = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(len(fake.requests), 3)
        self.assertFalse(result["checks"][-1]["passed"])

    def test_cross_tenant_data_is_blocking_even_with_positive_own_reads(self):
        fake = FakeTransport()
        fake.leak = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertFalse(result["checks"][-1]["passed"])

    def test_other_authenticated_users_membership_cannot_be_read(self):
        fake = FakeTransport()
        fake.member_leak = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "user-1-other-membership")
        self.assertFalse(result["checks"][-1]["passed"])
        # A query for the current user's ID would miss the leaked other user.
        self.assertEqual(parse_qs(urlsplit(fake.requests[-1][0]).query)["user_id"],
                         ["eq." + USER_B])

    def test_unfiltered_membership_listing_detects_cross_tenant_leak(self):
        fake = FakeTransport()
        fake.member_list_leak = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "user-1-enumerate-memberships")
        self.assertFalse(result["checks"][-1]["passed"])

    def test_foreign_tenant_brief_revision_is_not_visible(self):
        fake = FakeTransport()
        fake.revision_leak = True
        result, fake = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "user-1-other-brief-revision")
        self.assertFalse(result["checks"][-1]["passed"])
        self.assertEqual(parse_qs(urlsplit(fake.requests[-1][0]).query)["id"],
                         ["eq." + REV_B])

    def test_brief_revision_list_detects_cross_tenant_content_exposure(self):
        fake = FakeTransport()
        fake.revision_list_leak = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "user-1-enumerate-brief-revisions")
        self.assertFalse(result["checks"][-1]["passed"])

    def test_missing_own_brief_revision_is_not_a_false_positive(self):
        fake = FakeTransport()
        fake.revision_missing = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "user-1-own-brief-revision")
        self.assertFalse(result["checks"][-1]["passed"])

    def test_anonymous_brief_revisions_must_remain_invisible(self):
        fake = FakeTransport()
        fake.anon_revision_leak = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "anonymous-brief-revisions")
        self.assertFalse(result["checks"][-1]["passed"])

    def test_foreign_tenant_membership_filter_catches_unlisted_members(self):
        fake = FakeTransport()
        fake.foreign_member_list_leak = True
        result, fake = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"],
                         "user-1-foreign-organization-memberships")
        self.assertFalse(result["checks"][-1]["passed"])
        query = parse_qs(urlsplit(fake.requests[-1][0]).query)
        self.assertEqual(query["organization_id"], ["eq." + ORG_B])
        self.assertNotIn("user_id", query)

    def test_foreign_tenant_revision_filter_catches_unlisted_revisions(self):
        fake = FakeTransport()
        fake.foreign_revision_list_leak = True
        result, fake = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"],
                         "user-1-foreign-organization-brief-revisions")
        self.assertFalse(result["checks"][-1]["passed"])
        query = parse_qs(urlsplit(fake.requests[-1][0]).query)
        self.assertEqual(query["organization_id"], ["eq." + ORG_B])
        self.assertNotIn("id", query)

    def test_anonymous_membership_visibility_is_not_a_success(self):
        fake = FakeTransport()
        fake.anon_member_leak = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "anonymous-memberships")
        self.assertFalse(result["checks"][-1]["passed"])

    def test_both_sessions_must_be_authenticated_before_tenant_reads(self):
        fake = FakeTransport()
        fake.reject_auth_user = USER_B
        result, fake = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual([urlsplit(url).path for url, _ in fake.requests],
                         ["/auth/v1/user", "/auth/v1/user"])
        self.assertEqual(result["checks"][-1]["name"], "user-2-auth")

    def test_anonymous_visibility_is_not_a_success(self):
        fake = FakeTransport()
        fake.anon_leak = True
        result, _ = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(result["checks"][-1]["name"], "anonymous-organizations")
        self.assertFalse(result["checks"][-1]["passed"])

    def test_anonymous_postgrest_permission_denials_do_not_false_fail(self):
        tables = ("bm_organizations", "bm_memberships", "bm_brief_revisions")
        for table in tables:
            for http_status in (401, 403):
                with self.subTest(table=table, http_status=http_status):
                    fake = FakeTransport()
                    fake.anon_denials[table] = (http_status, None)
                    result, checked = self.run_probe(fake)
                    self.assertEqual(len(checked.requests), 27)
                    self.assertEqual(result["state"], "requires-independent-review")
                    self.assertIs(result["releaseAuthorized"], False)
                    self.assertIs(result["h01Accepted"], False)
                    self.assertEqual(len(result["checks"]), 27)
                    self.assertTrue(all(c["passed"] for c in result["checks"]))

    def test_anonymous_server_errors_and_nonempty_denial_are_not_evidence(self):
        for table in ("bm_organizations", "bm_memberships", "bm_brief_revisions"):
            for returned in ((500, None), (400, None), (302, None),
                             (401, [{"id": ORG_A}]), (403, []),
                             (200, [{"id": ORG_A}])):
                with self.subTest(table=table, response=returned[0]):
                    fake = FakeTransport()
                    fake.anon_denials[table] = returned
                    result, _ = self.run_probe(fake)
                    self.assertEqual(result["state"], "blocked")
                    self.assertFalse(result["checks"][-1]["passed"])

    def test_authenticated_permission_denial_is_not_cross_tenant_proof(self):
        for status in (401, 403):
            fake = FakeTransport()
            fake.auth_table_denial = (status, None)
            result, _ = self.run_probe(fake)
            self.assertEqual(result["state"], "blocked")
            self.assertEqual(result["checks"][-1]["name"], "user-1-own-organization")
            self.assertFalse(result["checks"][-1]["passed"])

    def test_auth_failure_stops_before_tenant_queries(self):
        fake = FakeTransport()
        fake.auth_rejected = True
        result, fake = self.run_probe(fake)
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(len(fake.requests), 1)
        self.assertEqual(result["checks"][0]["name"], "user-1-auth")

    def test_rejects_nonuser_expired_duplicate_and_anonymous_tokens_before_http(self):
        invalid = [
            {"token_a": token(USER_A, role="service_role")},
            {"token_a": token(USER_A, role="anon")},
            {"token_a": token(USER_A, is_anonymous=True)},
            {"token_a": token(USER_A, exp=1)},
            {"token_a": "service-key"},
            {"token_b": token(USER_A)},
            {"token_a": token(USER_A), "token_b": token(USER_A)},
        ]
        for changes in invalid:
            with self.subTest(changes=list(changes)):
                fake = FakeTransport()
                with self.assertRaises(ValueError):
                    self.run_probe(fake, **changes)
                self.assertEqual(fake.requests, [])

    def test_rejects_wrong_origin_secret_keys_and_reused_orgs_before_http(self):
        invalid = [
            {"base": "http://" + "a"*20 + ".supabase.co"},
            {"base": URL + "/rest/v1"},
            {"base": URL + "?token=secret"},
            {"base": URL + "\n"},
            {"base": "\t" + URL},
            {"base": URL.replace(".supabase.co", "\r.supabase.co")},
            {"base": URL.upper()},
            {"base": URL + "/"},
            {"base": URL + "#fragment"},
            {"base": "https://"+ "a"*20 + ".supabase.co.evil.test"},
            {"base": "https://localhost"},
            {"publishable_key": "sb_secret_" + "x"*30},
            {"publishable_key": "service_role"},
            {"org_b": ORG_A},
            {"org_a": "not-a-uuid"},
            {"revision_a": "not-a-uuid"},
            {"revision_b": REV_A},
            {"revision_b": ORG_B, "revision_a": ORG_B},
        ]
        for changes in invalid:
            with self.subTest(changes=list(changes)):
                fake = FakeTransport()
                with self.assertRaises(ValueError):
                    self.run_probe(fake, **changes)
                self.assertEqual(fake.requests, [])

    def test_transport_uses_no_proxy_no_redirect_and_only_get(self):
        class SafeResponse(io.BytesIO):
            status = 200

        class FakeOpener:
            def open(self, req, timeout):
                self_req.append((req, timeout))
                return SafeResponse(b'{"id":"synthetic-only"}')

        self_req = []
        with patch("ci.item6_rls_readonly_probe.urllib.request.build_opener",
                   return_value=FakeOpener()) as build:
            status, payload = _get(URL + "/auth/v1/user", {
                "Authorization": "Bearer fake-jwt", "apikey": KEY})
        self.assertEqual((status, payload), (200, {"id": "synthetic-only"}))
        self.assertEqual(len(self_req), 1)
        self.assertEqual(self_req[0][0].get_method(), "GET")
        self.assertEqual(self_req[0][1], 8)
        handlers = build.call_args.args
        self.assertEqual(len(handlers), 2)
        self.assertIsInstance(handlers[0], urllib.request.ProxyHandler)
        self.assertEqual(handlers[0].proxies, {})
        self.assertIs(handlers[1], _NoRedirect)

    def test_transport_redirects_and_large_or_malformed_bodies_fail_closed(self):
        class FakeOpener:
            def __init__(self, response=None, error=None):
                self.response = response
                self.error = error
                self.calls = 0

            def open(self, req, timeout):
                self.calls += 1
                if self.error:
                    raise self.error
                return self.response

        redirected = FakeOpener(error=urllib.error.HTTPError(
            URL + "/auth/v1/user", 302, "Found",
            {"Location": "https://untrusted.example.test/steal"}, None))
        with patch("ci.item6_rls_readonly_probe.urllib.request.build_opener",
                   return_value=redirected):
            self.assertEqual(_get(URL + "/auth/v1/user", {
                "Authorization": "Bearer fake-jwt"}), (302, None))
        self.assertEqual(redirected.calls, 1)

        for body in (b"x" * (MAX_RESPONSE + 1), b"{not-json}"):
            with self.subTest(body_length=len(body)):
                response = io.BytesIO(body)
                response.status = 200
                opened = FakeOpener(response=response)
                with patch("ci.item6_rls_readonly_probe.urllib.request.build_opener",
                           return_value=opened):
                    with self.assertRaisesRegex(ValueError,
                                                "Oversized|Malformed"):
                        _get(URL + "/rest/v1/bm_memberships", {"apikey": KEY})
                self.assertEqual(opened.calls, 1)

    def test_without_explicit_live_optin_cli_never_connects(self):
        with patch("sys.argv", ["item6_rls_readonly_probe"]), patch(
                "ci.item6_rls_readonly_probe._get",
                side_effect=AssertionError("Unexpected live HTTP")):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(), 2)
            self.assertIn("no network by default", output.getvalue())


if __name__ == "__main__":
    unittest.main()
