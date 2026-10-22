"""Opt-in H02 synthetic-object GET probe. No uploads, signing or release authority."""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from ci.item6_rls_readonly_probe import _claims, _get, _NoRedirect, UUID, HOST, KEY

PATH = re.compile(
    r"([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"
    r"\.(pdf|png|jpg|jpeg)\Z"
)
CONTENT_RANGE = re.compile(r"bytes 0-0/([1-9][0-9]{0,9})\Z")
BUCKET = "bm-evidence"
EXPECTED = (
    "user-1-auth", "user-2-auth",
    "user-1-own-object", "user-1-other-object",
    "user-2-own-object", "user-2-other-object",
    "anonymous-object-1", "anonymous-object-2",
    "public-object-1", "public-object-2",
)


def _peek(url: str, headers: dict[str, str]) -> tuple[int, bool]:
    """Bounded GET; never expose or retain the response body."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)
    req = urllib.request.Request(url, headers={**headers, "Range": "bytes=0-0"},
                                 method="GET")
    try:
        with opener.open(req, timeout=8) as response:
            status = response.status
            # If Range is not honored, refuse rather than read an entire file.
            if status != 206:
                return status, False
            content_range = response.headers.get("Content-Range", "")
            if not CONTENT_RANGE.fullmatch(content_range):
                return status, False
            return status, len(response.read(2)) == 1
    except urllib.error.HTTPError as error:
        # Do not read/log a provider error body, redirect target or signed URL.
        return error.code, False


def _input(base: str, key: str, tokens: tuple[str, str],
           paths: tuple[str, str]) -> tuple[str, str]:
    if type(base) is not str:
        raise ValueError("Invalid project origin")
    parts = urlsplit(base)
    if (parts.scheme != "https" or not parts.hostname
            or not HOST.fullmatch(parts.hostname)
            or base != "https://" + parts.hostname):
        raise ValueError("Invalid project origin")
    if type(key) is not str or not KEY.fullmatch(key):
        raise ValueError("Only publishable API keys are permitted")
    if (len(paths) != 2 or any(type(p) is not str or not PATH.fullmatch(p) for p in paths)
            or paths[0] == paths[1]
            or paths[0].split("/", 1)[0] == paths[1].split("/", 1)[0]):
        raise ValueError("Two distinct tenant-scoped synthetic object paths are required")
    if len(tokens) != 2:
        raise ValueError("Two signed-in users required")
    users = tuple(_claims(token) for token in tokens)
    if users[0] == users[1] or tokens[0] == tokens[1]:
        raise ValueError("Two distinct signed-in users required")
    return users


def _report(checks: dict[str, bool]) -> dict:
    return {
        "schema": "bidmason.item6.h02-readonly-object-probe.v1",
        "state": "requires-independent-review" if tuple(checks) == EXPECTED
                 and all(checks.values()) else "blocked",
        "h02Accepted": False, "releaseAuthorized": False,
        "checks": [{"name": name, "passed": passed} for name, passed in checks.items()],
        "notTested": ["uploads", "upserts", "signed-url-expiry", "signed-url-revocation",
                      "malicious-paths", "session-revocation", "independent-human-review"],
    }


def probe_readonly_storage(base: str, key: str, token_a: str, token_b: str,
                           path_a: str, path_b: str,
                           get=_get, peek=_peek) -> dict:
    """Proves narrowly scoped synthetic byte-range isolation, NEVER go-live."""
    tokens = (token_a, token_b)
    paths = (path_a, path_b)
    users = _input(base, key, tokens, paths)
    checks: dict[str, bool] = {}

    for i, (token, user) in enumerate(zip(tokens, users), start=1):
        status, payload = get(base + "/auth/v1/user",
                              {"apikey": key, "Authorization": "Bearer " + token,
                               "Accept": "application/json"})
        checks[f"user-{i}-auth"] = (status == 200 and type(payload) is dict
            and payload.get("id") == user and payload.get("is_anonymous") is not True)
        if not checks[f"user-{i}-auth"]:
            return _report(checks)

    prefix = base + "/storage/v1/object/authenticated/" + BUCKET + "/"
    for i, token in enumerate(tokens):
        headers = {"apikey": key, "Authorization": "Bearer " + token}
        own_status, own_byte = peek(prefix + paths[i], headers)
        checks[f"user-{i+1}-own-object"] = own_status == 206 and own_byte
        if not checks[f"user-{i+1}-own-object"]:
            return _report(checks)
        other_status, other_byte = peek(prefix + paths[1-i], headers)
        checks[f"user-{i+1}-other-object"] = (
            other_status in (401, 403, 404) and not other_byte
        )
        if not checks[f"user-{i+1}-other-object"]:
            return _report(checks)

    for i, path in enumerate(paths, start=1):
        status, byte = peek(prefix + path, {"apikey": key})
        checks[f"anonymous-object-{i}"] = (
            status in (401, 403, 404) and not byte
        )
        if not checks[f"anonymous-object-{i}"]:
            return _report(checks)
    # A private bucket must ALSO deny the unsigned public delivery route.
    # Testing only /authenticated/ could overlook an accidentally public
    # bucket, even when unauthenticated reads on that route are rejected.
    public_prefix = base + "/storage/v1/object/public/" + BUCKET + "/"
    for i, path in enumerate(paths, start=1):
        status, byte = peek(public_prefix + path, {"apikey": key})
        checks[f"public-object-{i}"] = (
            status in (401, 403, 404) and not byte
        )
        if not checks[f"public-object-{i}"]:
            return _report(checks)
    return _report(checks)


def main() -> int:
    parser = argparse.ArgumentParser(description="Opt-in read-only private Storage probe")
    parser.add_argument("--live-readonly", action="store_true")
    if not parser.parse_args().live_readonly:
        print("BLOCKED: no network by default; two authorized synthetic objects required")
        return 2
    names = ("BIDMASON_H02_URL", "BIDMASON_H02_PUBLISHABLE_KEY",
             "BIDMASON_H02_USER_A_JWT", "BIDMASON_H02_USER_B_JWT",
             "BIDMASON_H02_PATH_A", "BIDMASON_H02_PATH_B")
    try:
        result = probe_readonly_storage(*(os.environ[name] for name in names))
    except (KeyError, ValueError, OSError, urllib.error.URLError):
        print("BLOCKED: invalid or unavailable H02 read-only probe context")
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result["state"] == "requires-independent-review" else 1


if __name__ == "__main__":
    raise SystemExit(main())
