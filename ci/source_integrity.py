"""Verify byte-for-byte integrity of original ZIP text imported into the repository.

Hashes are Git blob SHA-1 (sha1("blob <length>\0" + bytes)) of the
uploaded June 2026 archive. This protects provenance, not cryptographic security
of external releases. Imported historical source is not automatically publishable.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
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
    "agents/01-market-analyst.md": "91b1c87c633492bd2f555f88c25429bc6c13b045",
    "agents/02-offer-architect.md": "1c5b5b2e409cda8bea2904391a077635d3f8f8de",
    "agents/03-web-builder.md": "389ca36f0f014c989390e8575fc051131f050be7",
    "agents/04-sales-copywriter.md": "69d43ed22e151c2737696b71abb554e8e3b3444b",
    "agents/05-bid-writer.md": "2d839eeab2f4827e2e64313dc5b03d0d87b91c62",
    "agents/06-risk-reviewer.md": "228c6e8dd31a82b256d10f20d16bb6c95757eea7",
    "agents/07-sales-assistant.md": "48f066aaa0d44fcba7348c1b18ec778bd1107825",
    "agents/08-inspector.md": "d18a6003cef9dea5dae7b06e8b7e3bf271eb85f8",
    "agents/09-account-analyst.md": "7970301a69265e268a0780ac7988e996c97360f9",
    "docs/HISTORICAL_SOURCE_README.md": "f3aefe16ca4611db756dc1368868598a720358a7",
    "demo-clients/harbor-coast-painting/02-market-research-memo.md": "81a1e4fec3650f0efaafeb6fa55b072166c22f1e",
    "demo-clients/harbor-coast-painting/03-offer-blueprint.md": "9913f814f520a26fb40f2616e9c7477de647472f",
    "demo-clients/harbor-coast-painting/09-qa-report.md": "f1d9511bfe7c897ad469590b6043f96a35046f4e",
    "demo-clients/harbor-coast-painting/10-monthly-report-sample.md": "1a6d312bf99e4b05609bc8a67fff2e8fdd56008f",
    "demo-clients/harbor-coast-painting/06-proposal-mariners-landing.md": "ebdef1b8f4acfb7ca5959cb21549b968e6e1fe48",
    "demo-clients/harbor-coast-painting/08-follow-up-sequence.md": "cd5bb3e0d51bae6e009656b67406588556c10be5",
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
    from scripts.source_bundle import original_assets
    assets = original_assets()
    if len(assets) != 4:
        raise SystemExit("FAIL: missing original archived assets")
    print(f"PASS: {len(IMPORTED_ORIGINAL_BLOBS) + len(assets)} original archive files verified (28 loose + 4 quarantined)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
