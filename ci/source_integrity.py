"""Verify byte-for-byte integrity of original ZIP text imported into the repository.

Hashes are Git blob SHA-1 (sha1("blob <length>\0" + bytes)) of the
uploaded June 2026 archive. This protects provenance, not cryptographic security
of external releases. Imported historical source is not automatically publishable.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORTED_ORIGINAL_BLOBS = {
    "operations/pricing-and-packages.md": "a7ba84db87056f73bf9ec715116ba72e61cb34db",
    "operations/qc-checklists.md": "18a3bbedf5b48dbb2e68dfa2ee93fc820ae8888a",
    "operations/90-day-launch-plan.md": "63e3791e4984bc671eb8e364f6605b3064db6c91",
    "operations/intake-and-client-build-brief.md": "71c773d70f93ef98a6e406c6c023b3f105cc1c96",
    "operations/monthly-report-template.md": "b856c28d3bd97bdf7a610286f9039de57e6677a3",
    "operations/qa-coordinator-hire.md": "ce6b20a5a1cc8daa4a71551ebaf9a94228c20c28",
    "operations/proposal-master-template.md": "1f7fec4e9a43a5a5595701d965213e5b8ff99c87",
    "operations/follow-up-sequences.md": "4a484035adccad6b579a25d725132599c3832743",
    "sales/pitch-and-outreach.md": "e74100d7e97f6fa76da1fdd3b9af171d1da8101f",
    "demo-clients/harbor-coast-painting/01-client-build-brief.md": "c0db6fdda9b475c9af03d32d9b377ed7a0850fc1",
    "demo-clients/harbor-coast-painting/05-walkthrough-voice-note.md": "f56cd82ef5e48c5d4817ea064de0dcc23c1d5bfa",
    "demo-clients/harbor-coast-painting/07-risk-review.md": "08c1fd3c60cd623b479995ff3f3d1980d5a77591",
}

def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def validate(root: Path = ROOT) -> list[str]:
    errors = []
    for relative, expected in IMPORTED_ORIGINAL_BLOBS.items():
        file = root / relative
        if not file.is_file():
            errors.append(f"Missing source file: {relative}")
            continue
        actual = git_blob_sha(file.read_bytes())
        if actual != expected:
            errors.append(f"Altered original: {relative} (expected {expected}, got {actual})")
    return errors


def main() -> int:
    errors = validate()
    for error in errors:
        print(f"FAIL: {error}")
    if errors:
        return 1
    print(f"PASS: {len(IMPORTED_ORIGINAL_BLOBS)} original archive files match byte-for-byte")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
