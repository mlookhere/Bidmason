"""Build a deterministic, non-authorizing Item 6 external review handoff.

The manifest and runbook are project-controlled collection instructions, not
authenticated environment proof. No customer records, provider calls, approval
or production authorization are produced by this tool.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from ci.item6_release_evidence import MANIFEST, REQUIRED, evaluate, load

ROOT = Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "docs" / "ITEM6_EXTERNAL_ACCEPTANCE_RUNBOOK.md"
ROW = re.compile(
    r"^\| H(\d{2}) \| `([a-z0-9-]+)` \| `([A-Za-z0-9_:-]+)` "
    r"\| (.*?) \| (.*?) \|$", re.MULTILINE,
)
MAX_RUNBOOK_BYTES = 128 * 1024
# Reviewer instructions are source-controlled plain text, not evidence locations.
# Do not echo user/tenant URLs, email addresses or Markdown/HTML from cells.
UNSAFE_INSTRUCTION = re.compile(
    r"(?i:[a-z][a-z0-9+.-]*://|www\.|mailto:)|[<>\[\]@`|]"
)


def _plain_instruction(value: str) -> bool:
    return (bool(value.strip()) and len(value) <= 800
            # This project's reviewer checklist is English/ASCII. Disallow
            # bidi overrides, zero-width joiners and Unicode lookalikes that
            # can visually disguise contact details or approval language.
            and all(32 <= ord(char) <= 126 for char in value)
            and UNSAFE_INSTRUCTION.search(value) is None)


def _read_runbook(path: Path) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing or symlinked Item 6 acceptance runbook")
    with path.open("rb") as handle:
        data = handle.read(MAX_RUNBOOK_BYTES + 1)
    if len(data) > MAX_RUNBOOK_BYTES:
        raise ValueError("Oversized Item 6 acceptance runbook")
    return data


def review_packet(manifest: dict, runbook_bytes: bytes) -> dict:
    """Join every BLOCKED evidence entry to its reviewer checklist, no approval."""
    state = evaluate(manifest)  # validation MUST precede any output
    if type(runbook_bytes) is not bytes:
        raise ValueError("Invalid acceptance runbook source")
    try:
        runbook = runbook_bytes.decode("utf-8")
    except UnicodeError as exc:
        raise ValueError("Invalid acceptance runbook encoding") from exc
    if "**Status: BLOCKED." not in runbook or "- [x]" in runbook:
        raise ValueError("Unreviewed acceptance runbook status")
    rows = ROW.findall(runbook)
    if len(rows) != len(REQUIRED):
        raise ValueError("Incomplete or duplicate acceptance runbook requirements")

    details = {}
    for number, identifier, source, owner, negative in rows:
        if (identifier in details or identifier not in REQUIRED
                or source != REQUIRED[identifier]
                or int(number) != list(REQUIRED).index(identifier) + 1
                or not _plain_instruction(owner)
                or not _plain_instruction(negative)):
            raise ValueError("Conflicting or incomplete acceptance runbook requirement")
        details[identifier] = (number, owner, negative)
    if set(details) != set(REQUIRED):
        raise ValueError("Missing acceptance runbook requirement")
    if list(details) != list(REQUIRED):
        raise ValueError("Out-of-order acceptance runbook requirements")

    by_id = {entry["id"]: entry for entry in manifest["criteria"]}
    rows_out = []
    for ident, source in REQUIRED.items():
        item = by_id[ident]
        number, owner, negative = details[ident]
        rows_out.append({
            "criterion": "H" + number,
            "id": ident,
            "source": source,
            "ownerRoleAndArtifact": owner,
            "mandatoryLiveNegativeValidation": negative,
            "evidenceStatus": item["status"],
            "referenceCountNotValidation": len(item["evidence"]),
            "independentlyVerified": False,
        })
    # The source fingerprints bind a handoff to exact bytes, not a GitHub SHA
    # or signed human approval. Evidence URLs are deliberately NOT echoed.
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return {
        "schema": "bidmason.item6.review-handoff.v1",
        "releaseState": "blocked",
        "releaseAuthorized": False,
        "verification": "requires-independent-human-validation",
        "manifestSha256": hashlib.sha256(canonical).hexdigest(),
        "runbookSha256": hashlib.sha256(runbook_bytes).hexdigest(),
        "required": state["required"],
        "unverified": state["unverified"],
        "submittedForIndependentReview": state["submittedForIndependentReview"],
        "requirements": rows_out,
    }


def render_markdown(packet: dict) -> str:
    """A compact, identity-free human checklist, never a signed release record."""
    output = [
        "# Item 6 external acceptance review packet (BLOCKED)",
        "",
        "**Not verified or approved. No sending, buyer access or release is authorized.**",
        "",
        f"Manifest SHA-256: `{packet['manifestSha256']}`",
        f"Runbook SHA-256: `{packet['runbookSha256']}`",
        f"Requirements: {packet['required']} | Unverified: {packet['unverified']} "
        f"| Submitted only: {packet['submittedForIndependentReview']}",
        "",
    ]
    for item in packet["requirements"]:
        output += [
            f"## [ ] {item['criterion']} — {item['id']}",
            f"Source: `{item['source']}`",
            f"Owner role / required artifact: {item['ownerRoleAndArtifact']}",
            f"Mandatory live negative validation: {item['mandatoryLiveNegativeValidation']}",
            f"Evidence: {item['evidenceStatus']} "
            f"({item['referenceCountNotValidation']} untrusted links withheld)",
            "Independent verification: **not established**",
            "",
        ]
    output.append("No authorization can be inferred from this packet or its hashes.")
    return "\n".join(output) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate BLOCKED Item 6 review handoff")
    parser.add_argument("--format", choices=("check", "json", "markdown"),
                        default="check")
    args = parser.parse_args()
    manifest = load(MANIFEST)
    source = _read_runbook(RUNBOOK)
    packet = review_packet(manifest, source)
    if args.format == "check":
        print(f"BLOCKED: review handoff consistent for {packet['required']} H01-H13 "
              "requirements; independent approval missing; no sending authorized")
    elif args.format == "json":
        print(json.dumps(packet, sort_keys=True, indent=2))
    else:
        print(render_markdown(packet), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
