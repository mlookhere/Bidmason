"""Opt-in read-only PostgREST H01 visibility probe. Not release acceptance.

Uses two genuine, distinct Supabase Auth user tokens, never service credentials.
Never creates test users, alters records, or calls send/storage endpoints.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlencode, urlsplit

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
HOST = re.compile(r"[a-z0-9]{20}\.supabase\.co\Z")
KEY = re.compile(r"sb_publishable_[A-Za-z0-9_-]{10,}\Z")
MAX_RESPONSE = 16384


def _claims(token: str) -> str:
    """Reject obvious non-user or expired JWTs, not substitute for Auth /user."""
    if type(token) is not str or len(token) > 8192 or len(token.split(".")) != 3:
        raise ValueError("A real signed-in user JWT is required")
    try:
        segment = token.split(".")[1]
        decoded = base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))
        claims = json.loads(decoded)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Invalid user JWT") from exc
    if (type(claims) is not dict or claims.get("role") != "authenticated"
            or type(claims.get("sub")) is not str
            or not UUID.fullmatch(claims["sub"])
            or claims.get("is_anonymous") is True
            or type(claims.get("exp")) is not int
            or claims["exp"] <= time.time()):
        raise ValueError("Expired or non-user JWT")
    return claims["sub"]


def _validate(base: str, publishable_key: str, tokens: tuple[str, str],
              orgs: tuple[str, str]) -> tuple[str, str]:
    if type(base) is not str:
        raise ValueError("Explicit Supabase HTTPS endpoint required")
    parts = urlsplit(base)
    if (parts.scheme != "https" or parts.username or parts.password or parts.port
            or not parts.hostname or not HOST.fullmatch(parts.hostname)
            or parts.path or parts.query or parts.fragment):
        raise ValueError("Unsafe or ambiguous Supabase endpoint")
    if type(publishable_key) is not str or not KEY.fullmatch(publishable_key):
        raise ValueError("A publishable key is required; secret/service keys prohibited")
    if (len(tokens) != 2 or len(orgs) != 2
            or any(type(org) is not str or not UUID.fullmatch(org) for org in orgs)
            or orgs[0] == orgs[1]):
        raise ValueError("Two distinct synthetic organization IDs required")
    users = tuple(_claims(token) for token in tokens)
    if users[0] == users[1] or tokens[0] == tokens[1]:
        raise ValueError("Two distinct authenticated user sessions required")
    return users


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _get(url: str, headers: dict[str, str]) -> tuple[int, object]:
    # Disable ambient HTTPS_PROXY to prevent accidental credential forwarding.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(req, timeout=8) as response:
            raw = response.read(MAX_RESPONSE + 1)
            status = response.status
    except urllib.error.HTTPError as error:
        # Never log provider response bodies (they may contain secrets).
        return error.code, None
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Oversized authentication or PostgREST response")
    try:
        return status, json.loads(raw)
    except (UnicodeError, ValueError) as exc:
        raise ValueError("Malformed authentication or PostgREST response") from exc


def probe_readonly_rls(base: str, publishable_key: str, token_a: str, token_b: str,
                       org_a: str, org_b: str, get=_get) -> dict:
    """Positive controls + cross-tenant and anonymous reads; NO mutation.

    A passing matrix is still NOT H01 acceptance: writes, missing membership,
    session revocation, RLS adversarial cases and independent signoff remain.
    """
    tokens, orgs = (token_a, token_b), (org_a, org_b)
    users = _validate(base, publishable_key, tokens, orgs)
    cases: dict[str, bool] = {}

    for index, (token, user) in enumerate(zip(tokens, users)):
        headers = {"apikey": publishable_key, "Authorization": "Bearer " + token,
                   "Accept": "application/json"}
        status, payload = get(base + "/auth/v1/user", headers)
        cases[f"user-{index+1}-auth"] = (status == 200 and type(payload) is dict
            and payload.get("id") == user and payload.get("is_anonymous") is not True)
        if not cases[f"user-{index+1}-auth"]:
            # No further tenant request with an unverified authenticated identity.
            return _result(cases)
        own, other = orgs[index], orgs[1-index]
        checks = (
            ("own-organization", "bm_organizations",
             {"select": "id", "id": "eq." + own}, [{"id": own}]),
            ("other-organization", "bm_organizations",
             {"select": "id", "id": "eq." + other}, []),
            ("enumerate-organizations", "bm_organizations",
             {"select": "id", "limit": "100"}, [{"id": own}]),
            ("own-membership", "bm_memberships",
             {"select": "organization_id,user_id", "organization_id": "eq." + own,
              "user_id": "eq." + user}, [{"organization_id": own, "user_id": user}]),
            ("other-membership", "bm_memberships",
             {"select": "organization_id,user_id", "organization_id": "eq." + other,
              "user_id": "eq." + user}, []),
        )
        for name, table, query, expected in checks:
            status, rows = get(base + "/rest/v1/" + table + "?" + urlencode(query), headers)
            cases[f"user-{index+1}-{name}"] = status == 200 and rows == expected
            if not cases[f"user-{index+1}-{name}"]:
                return _result(cases)

    # Anonymous requests must not enumerate either synthetic tenant.
    anonymous_headers = {"apikey": publishable_key, "Accept": "application/json"}
    status, rows = get(base + "/rest/v1/bm_organizations?select=id&limit=100",
                       anonymous_headers)
    cases["anonymous-organizations"] = status == 200 and rows == []
    return _result(cases)


def _result(cases: dict[str, bool]) -> dict:
    return {"schema": "bidmason.item6.h01-readonly-probe.v1",
            "state": "requires-independent-review" if len(cases) == 13
                     and all(cases.values()) else "blocked",
            "releaseAuthorized": False, "h01Accepted": False,
            "checks": [{"name": name, "passed": passed} for name, passed in cases.items()],
            "notTested": ["write-boundary", "missing-membership", "session-revocation",
                          "storage", "independent-human-review"]}


def main() -> int:
    parser = argparse.ArgumentParser(description="Opt-in H01 live read-only tenant probe")
    parser.add_argument("--live-readonly", action="store_true")
    args = parser.parse_args()
    if not args.live_readonly:
        print("BLOCKED: no network by default; --live-readonly and two authorized synthetic users required")
        return 2
    names = ("BIDMASON_H01_URL", "BIDMASON_H01_PUBLISHABLE_KEY",
             "BIDMASON_H01_USER_A_JWT", "BIDMASON_H01_USER_B_JWT",
             "BIDMASON_H01_ORG_A", "BIDMASON_H01_ORG_B")
    try:
        result = probe_readonly_rls(*(os.environ[name] for name in names))
    except (KeyError, ValueError, OSError, urllib.error.URLError):
        # No token, actor identity, URL, remote body or tenant ID in output.
        print("BLOCKED: invalid or unavailable H01 read-only probe context")
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result["state"] == "requires-independent-review" else 1


if __name__ == "__main__":
    raise SystemExit(main())
