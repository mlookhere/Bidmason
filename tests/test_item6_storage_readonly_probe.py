"""Offline H02 byte-range private Storage isolation tests; no live calls."""
from __future__ import annotations

import base64
import contextlib
import io
import json
import time
import unittest
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from ci.item6_rls_readonly_probe import _NoRedirect
from ci.item6_storage_readonly_probe import (
    _peek, main, probe_readonly_storage,
)
URL = "https://" + "a" * 20 + ".supabase.co"
KEY = "sb_publishable_" + "k" * 25
ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
USER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
USER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def token(sub: str) -> str:
    claims = {"sub":sub,"role":"authenticated","exp":int(time.time())+86400}
    encoded=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return "header." + encoded + ".signature"


PATH_A = ORG_A + "/" + "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" + ".pdf"
PATH_B = ORG_B + "/" + "ffffffff-ffff-4fff-8fff-ffffffffffff" + ".png"


class StorageTransport:
    def __init__(self):
        self.tokens = {token(USER_A): USER_A, token(USER_B): USER_B}
        self.calls = []
        self.foreign_leak = False
        self.anon_leak = False
        self.public_leak = False
        self.public_key_leak = False
        self.missing_own = False
        self.bad_auth = False
        self.missing_membership = False
        self.foreign_membership_leak = False
        self.membership_error = False

    def get(self, url, headers):
        self.calls.append(("GET-AUTH" if "/auth/v1/user" in url else "GET-MEMBER",
                           url, headers))
        bearer = headers.get("Authorization", "").removeprefix("Bearer ")
        if self.bad_auth:
            return 401, None
        if "/auth/v1/user" in url:
            return 200, {"id": self.tokens[bearer], "is_anonymous": False}
        if not urlsplit(url).path.endswith("/rest/v1/bm_memberships"):
            raise AssertionError("Unexpected read-only endpoint")
        if self.membership_error:
            return 500, None
        user = self.tokens[bearer]
        own = ORG_A if user == USER_A else ORG_B
        foreign = ORG_B if own == ORG_A else ORG_A
        filters = parse_qs(urlsplit(url).query)
        requested = filters["organization_id"][0].removeprefix("eq.")
        if requested == own and not self.missing_membership:
            return 200, [{"organization_id": own, "user_id": user}]
        if requested == foreign and self.foreign_membership_leak:
            return 200, [{"organization_id": foreign,
                          "user_id": USER_B if user == USER_A else USER_A}]
        return 200, []

    def peek(self, url, headers):
        self.calls.append(("GET-RANGE", url, headers))
        bearer = headers.get("Authorization", "").removeprefix("Bearer ")
        if "/storage/v1/object/public/" in url:
            exposed = (self.public_leak
                or (self.public_key_leak and "apikey" in headers))
            return (206, True) if exposed else (404, False)
        if not bearer:
            return (206, True) if self.anon_leak else (403, False)
        user = self.tokens[bearer]
        own = PATH_A if user == USER_A else PATH_B
        target = url.split("/bm-evidence/", 1)[1]
        if target == own:
            return (404, False) if self.missing_own else (206, True)
        return (206, True) if self.foreign_leak else (404, False)


class H02StorageReadOnlyTests(unittest.TestCase):
    def run_probe(self, fixture=None, **overrides):
        fixture = fixture or StorageTransport()
        args = dict(base=URL, key=KEY, token_a=list(fixture.tokens)[0],
                    token_b=list(fixture.tokens)[1], path_a=PATH_A, path_b=PATH_B,
                    get=fixture.get, peek=fixture.peek)
        args.update(overrides)
        return probe_readonly_storage(**args), fixture

    def test_positive_controls_and_negative_reads_are_non_authorizing(self):
        result, fake = self.run_probe()
        self.assertEqual(result["state"], "requires-independent-review")
        self.assertEqual(len(result["checks"]), 16)
        self.assertEqual(len(fake.calls), 16)
        self.assertTrue(all(row["passed"] for row in result["checks"]))
        self.assertIs(result["h02Accepted"], False)
        self.assertIs(result["releaseAuthorized"], False)
        self.assertIn("signed-url-expiry", result["notTested"])
        output=json.dumps(result)
        for secret in (*fake.tokens, PATH_A, PATH_B, USER_A, USER_B, URL, KEY):
            self.assertNotIn(secret, output)

    def test_missing_own_membership_blocks_before_object_reads(self):
        fake=StorageTransport()
        fake.missing_membership=True
        report, fixture=self.run_probe(fake)
        self.assertEqual(report["state"],"blocked")
        self.assertEqual(report["checks"][-1]["name"],"user-1-own-membership")
        self.assertEqual(len(fixture.calls),3)
        self.assertTrue(all(call[0] != "GET-RANGE" for call in fixture.calls))

    def test_foreign_tenant_membership_disclosure_blocks(self):
        fake=StorageTransport()
        fake.foreign_membership_leak=True
        report, fixture=self.run_probe(fake)
        self.assertEqual(report["state"],"blocked")
        self.assertEqual(report["checks"][-1]["name"],"user-1-foreign-memberships")
        self.assertEqual(len(fixture.calls),4)
        self.assertTrue(all(call[0] != "GET-RANGE" for call in fixture.calls))
        query=parse_qs(urlsplit(fixture.calls[-1][1]).query)
        self.assertEqual(query["organization_id"],["eq."+ORG_B])
        self.assertNotIn("user_id",query)

    def test_member_api_error_never_masquerades_as_denial(self):
        fake=StorageTransport()
        fake.membership_error=True
        report, fixture=self.run_probe(fake)
        self.assertEqual(report["state"],"blocked")
        self.assertEqual(report["checks"][-1]["name"],"user-1-own-membership")
        self.assertEqual(len(fixture.calls),3)

    def test_missing_own_positive_control_blocks(self):
        fake=StorageTransport()
        fake.missing_own=True
        report, fixture=self.run_probe(fake)
        self.assertEqual(report["state"], "blocked")
        self.assertEqual(report["checks"][-1]["name"], "user-1-own-object")
        self.assertEqual(len(fixture.calls), 7)

    def test_cross_tenant_object_leak_is_not_ignored(self):
        fake=StorageTransport()
        fake.foreign_leak=True
        report, _=self.run_probe(fake)
        self.assertEqual(report["state"], "blocked")
        self.assertEqual(report["checks"][-1]["name"], "user-1-other-object")

    def test_anonymous_private_object_leak_is_not_ignored(self):
        fake=StorageTransport()
        fake.anon_leak=True
        report, _=self.run_probe(fake)
        self.assertEqual(report["state"], "blocked")
        self.assertEqual(report["checks"][-1]["name"], "anonymous-object-1")

    def test_public_storage_url_leak_blocks_even_if_authenticated_path_denies(self):
        fake=StorageTransport()
        fake.public_leak=True
        report, fixture=self.run_probe(fake)
        self.assertEqual(report["state"],"blocked")
        self.assertEqual(report["checks"][-1]["name"],"public-object-1")
        self.assertFalse(report["checks"][-1]["passed"])
        self.assertTrue(fixture.calls[-1][1].endswith("/public/bm-evidence/"+PATH_A))
        self.assertNotIn("Authorization",fixture.calls[-1][2])
        self.assertNotIn("apikey",fixture.calls[-1][2])

    def test_public_route_server_errors_are_not_negative_security_proof(self):
        for status in (200, 206, 302, 400, 500):
            with self.subTest(status=status):
                fake=StorageTransport()
                def peek(url,headers):
                    if "/storage/v1/object/public/" in url:
                        return (status,False)
                    return fake.peek(url,headers)
                result=probe_readonly_storage(
                    URL,KEY,list(fake.tokens)[0],list(fake.tokens)[1],
                    PATH_A,PATH_B,get=fake.get,peek=peek)
                self.assertEqual(result["state"],"blocked")
                self.assertEqual(result["checks"][-1]["name"],"public-object-1")

    def test_anonymous_with_publishable_key_cannot_access_public_object(self):
        fake=StorageTransport()
        fake.public_key_leak=True
        report, fixture=self.run_probe(fake)
        self.assertEqual(report["state"],"blocked")
        self.assertEqual(report["checks"][-1]["name"],"public-with-key-object-1")
        self.assertFalse(report["checks"][-1]["passed"])
        self.assertEqual(fixture.calls[-1][2],{"apikey":KEY})
        # Completely keyless public GETs succeeded as DENIAL, but adding
        # the publishable key must not open a private object.
        self.assertEqual(fixture.calls[-3][2],{})
        self.assertEqual(fixture.calls[-2][2],{})

    def test_keyless_and_publishable_public_routes_are_both_exercised(self):
        report, fake=self.run_probe()
        self.assertEqual(report["state"],"requires-independent-review")
        public_calls=fake.calls[-4:]
        self.assertEqual(
            [c[1].split("/bm-evidence/")[1] for c in public_calls],
            [PATH_A,PATH_B,PATH_A,PATH_B])
        self.assertTrue(all("/object/public/" in c[1] for c in public_calls))
        self.assertEqual([c[2] for c in public_calls],
                         [{},{},{"apikey":KEY},{"apikey":KEY}])
        self.assertTrue(all(c["passed"] for c in report["checks"]))

    def test_auth_fail_closed_before_storage_request(self):
        fake=StorageTransport()
        fake.bad_auth=True
        report, fixture=self.run_probe(fake)
        self.assertEqual(report["state"], "blocked")
        self.assertEqual(len(fixture.calls), 1)
        self.assertEqual(fixture.calls[0][0], "GET-AUTH")

    def test_invalid_credentials_origin_and_object_paths_stop_before_http(self):
        invalid = [
            {"base":"http://"+URL.split("://")[1]},
            {"base":URL+"/storage"},
            {"base":" "+URL},
            {"key":"sb_secret_"+"a"*25},
            {"key":"service_role"},
            {"path_a":"../secret.pdf"},
            {"path_a":"https://evil.test/a.pdf"},
            {"path_a":ORG_A+"/foo.pdf"},
            {"path_a":ORG_A+"/"+"e"*8+"-"+"e"*4+"-"+"4"+"e"*3+"-"+"8"+"e"*3+"-"+"e"*12+".PDF"},
            {"path_a":PATH_A+"?download=1"},
            {"path_a":ORG_B+"/"+"1"*8+"-"+"1"*4+"-"+"4"+"1"*3+"-"+"8"+"1"*3+"-"+"1"*12+".jpg"},
            {"path_b":PATH_A},
            {"token_b":token(USER_A)},
            {"token_a":"not-jwt"},
        ]
        for changed in invalid:
            with self.subTest(changed=list(changed)):
                fake=StorageTransport()
                with self.assertRaises(ValueError):
                    self.run_probe(fake, **changed)
                self.assertEqual(fake.calls, [])

    def test_different_error_statuses_do_not_disguise_data_exposure(self):
        for status, expected in ((400,False),(401,True),(403,True),
                                 (404,True),(500,False),(302,False),
                                 (200,False),(206,False)):
            with self.subTest(status=status):
                fake=StorageTransport()
                def leak(url, headers):
                    if "Bearer" in headers.get("Authorization",""):
                        if url.endswith(PATH_A) and headers["Authorization"].endswith(list(fake.tokens)[1]):
                            return (status,False)
                    return fake.peek(url, headers)
                result=probe_readonly_storage(
                    URL,KEY,list(fake.tokens)[0],list(fake.tokens)[1],
                    PATH_A,PATH_B,get=fake.get,peek=leak)
                self.assertEqual(result["state"]=="requires-independent-review",expected)

    def test_peek_reads_one_byte_only_and_disables_proxy_and_redirect(self):
        class Response(io.BytesIO):
            status=206
            headers={"Content-Range":"bytes 0-0/128"}
        requests=[]
        class Opener:
            def open(self,req,timeout):
                requests.append((req,timeout))
                return Response(b"x")
        with patch("ci.item6_storage_readonly_probe.urllib.request.build_opener",
                   return_value=Opener()) as opener:
            self.assertEqual(_peek(URL+"/storage/v1/object/authenticated/bm-evidence/"+
                PATH_A,{"Authorization":"Bearer fake","apikey":KEY}), (206,True))
        self.assertEqual(len(requests),1)
        self.assertEqual(requests[0][0].get_method(),"GET")
        self.assertEqual(requests[0][0].get_header("Range"),"bytes=0-0")
        self.assertEqual(requests[0][1],8)
        handlers=opener.call_args.args
        self.assertEqual(handlers[0].proxies,{})
        self.assertIs(handlers[1],_NoRedirect)

    def test_range_ignored_or_malformed_does_not_pass(self):
        class Response(io.BytesIO):
            def __init__(self,status,data,content_range):
                super().__init__(data)
                self.status=status
                self.headers={"Content-Range":content_range}
        cases=[
            (200,b"full-unrequested-document",""),
            (206,b"x","bytes 0-0/0"),
            (206,b"xx","bytes 0-0/100"),
            (206,b"x","bytes 1-1/100"),
            (206,b"", "bytes 0-0/100"),
        ]
        for status,data,content_range in cases:
            with self.subTest(status=status,cr=content_range):
                class Opener:
                    def open(self,req,timeout):
                        return Response(status,data,content_range)
                with patch("ci.item6_storage_readonly_probe.urllib.request.build_opener",
                           return_value=Opener()):
                    self.assertEqual(_peek(URL+"/test",{"apikey":KEY}),(status,False))

    def test_provider_denial_never_reads_error_body_or_follows_redirect(self):
        error=urllib.error.HTTPError(URL,302,"Moved",
             {"Location":"https://evil.test/steal"},io.BytesIO(b"token-leak"))
        class Opener:
            def open(self,req,timeout):
                raise error
        with patch("ci.item6_storage_readonly_probe.urllib.request.build_opener",
                   return_value=Opener()):
            self.assertEqual(_peek(URL+"/test",{"apikey":KEY}),(302,False))

    def test_cli_no_network_default(self):
        with patch("sys.argv",["item6_storage_readonly_probe"]):
            with patch("ci.item6_storage_readonly_probe._get",
                       side_effect=AssertionError("unexpected network")):
                output=io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(main(),2)
                self.assertIn("no network by default",output.getvalue())


if __name__ == "__main__":
    unittest.main()
