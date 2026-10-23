"""Strict, offline inventory of Item 6 missing production evidence.

A valid inventory means blockers are faithfully recorded, NOT that a release
gate is green. Submitted URLs are untrusted claims; only an independently
approved live integration and written go/no-go can authorize release.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs" / "ITEM6_RELEASE_EVIDENCE.json"
SCHEMA = "bidmason.item6.evidence.v1"
REQUIRED = {
    "tenant-auth-and-rls": "MASTER_PLAN:3",
    "private-tenant-storage": "MASTER_PLAN:3",
    "approved-company-policy": "MASTER_PLAN:4",
    "exact-revision-approvals": "BM-015b",
    "recipient-consent": "BM-031",
    "email-provider-and-domain": "DEC-06",
    "signed-webhook-replay": "BM-030",
    "transactional-dispatch-uniqueness": "BM-029",
    "recipient-stop-contact": "BM-031",
    "buyer-view-response-authorization": "BM-033",
    "crm-recovery-and-observability": "BM-032",
    "live-adversarial-safety-tests": "BM-034",
    "independent-reviews-and-go-no-go": "MASTER_PLAN:8",
}
STATUSES = {"unverified", "submitted-for-independent-review"}
MAX_MANIFEST_BYTES = 128 * 1024
DNS_HOST = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z", re.I)
SAFE_FRAGMENT = re.compile(r"[a-zA-Z0-9_./%~-]{0,120}\Z")


def _reference_url(value):
    """Only stable HTTPS DNS links; never trust a link as proof of approval."""
    if (type(value) is not str or len(value) > 600 or not value.startswith("https://")
            or "\\" in value or any(ord(c) < 33 or ord(c) > 126 or c in "<>" for c in value)):
        return False
    try:
        parts = urlsplit(value)
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        return False
    return (parts.scheme == "https" and hostname is not None
            and DNS_HOST.fullmatch(hostname) is not None
            and parts.username is None and parts.password is None
            and port in (None, 443) and not parts.query
            and SAFE_FRAGMENT.fullmatch(parts.fragment) is not None)



def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate Item 6 evidence JSON field")
        value[key] = item
    return value


def load(path: Path = MANIFEST):
    """Read untrusted JSON; duplicate keys must not silently replace blockers."""
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing or symlinked Item 6 evidence manifest")
    with path.open("rb") as manifest:
        raw = manifest.read(MAX_MANIFEST_BYTES + 1)
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ValueError("Oversized Item 6 evidence manifest")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)


def evaluate(value):
    """Return only a BLOCKED inventory, never release/send authorization."""
    if type(value) is not dict or set(value) != {"schema", "releaseState", "criteria"}:
        raise ValueError("Invalid Item 6 evidence manifest shape")
    if value["schema"] != SCHEMA or value["releaseState"] != "blocked":
        raise ValueError("Item 6 production gate must remain blocked")
    entries = value["criteria"]
    if type(entries) is not list or len(entries) != len(REQUIRED):
        raise ValueError("Missing or unexpected Item 6 evidence criteria")
    seen = set()
    submitted = 0
    for entry in entries:
        if type(entry) is not dict or set(entry) != {"id", "source", "status", "evidence"}:
            raise ValueError("Invalid Item 6 evidence entry shape")
        identifier = entry["id"]
        if type(identifier) is not str or identifier not in REQUIRED or identifier in seen:
            raise ValueError("Unknown or duplicate Item 6 evidence criterion")
        seen.add(identifier)
        if entry["source"] != REQUIRED[identifier] or entry["status"] not in STATUSES:
            raise ValueError("Invalid source or fabricated Item 6 approval state")
        references = entry["evidence"]
        if type(references) is not list or len(references) > 10:
            raise ValueError("Invalid Item 6 evidence references")
        if any(not _reference_url(item)
               for item in references) or len(set(references)) != len(references):
            raise ValueError("Malformed or repeated Item 6 evidence reference")
        if entry["status"] == "unverified" and references:
            raise ValueError("Unverified Item 6 evidence must not claim proof")
        if entry["status"] == "submitted-for-independent-review":
            if not references:
                raise ValueError("Submitted Item 6 evidence needs a reference")
            submitted += 1
    if seen != set(REQUIRED):
        raise ValueError("Missing Item 6 production requirement")
    return {"state": "blocked", "releaseAuthorized": False,
            "required": len(REQUIRED), "unverified": len(REQUIRED)-submitted,
            "submittedForIndependentReview": submitted}


if __name__ == "__main__":
    state = evaluate(load())
    print(f"BLOCKED: Item 6 has {state['unverified']} unverified and "
          f"{state['submittedForIndependentReview']} awaiting independent "
          f"review; no release or customer sending is authorized")
