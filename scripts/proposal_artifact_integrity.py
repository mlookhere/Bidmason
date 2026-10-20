"""Synthetic internal PDF content fingerprints; never an approval or signature.

A matching record detects accidental stale or substituted artifacts when the
manifest is trusted. Anyone able to rewrite all three inputs can forge it.
"""
from __future__ import annotations

import hashlib
import json
import re

import fitz

from scripts.render_branded_proposal_pdf import BANNER, money, validated

FORMAT = "synthetic-proposal-integrity-v1"
DISPOSITION = "INTERNAL ONLY - NOT FOR DELIVERY"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _digest(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def _snapshot_bytes(snapshot: dict) -> bytes:
    approved_shape = validated(snapshot)
    return json.dumps(approved_shape, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def _inspect_pdf(snapshot: dict, pdf_bytes: bytes) -> int:
    if type(pdf_bytes) is not bytes or not 2500 <= len(pdf_bytes) <= 16 * 1024 * 1024:
        raise ValueError("Invalid synthetic PDF bytes")
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf:
            if not 1 <= pdf.page_count <= 8 or pdf.needs_pass:
                raise ValueError("PDF page count or encryption invalid")
            first = pdf[0].get_text()
            proposal = snapshot["proposal"]
            brand = snapshot["brand"]
            if any(text not in first for text in (
                proposal["reference"], brand["businessName"], proposal["recipient"]
            )):
                raise ValueError("PDF identity differs from proposal input")
            pages = [page.get_text() for page in pdf]
            if any(BANNER not in text for text in pages):
                raise ValueError("A proposal page is missing its internal warning")
            full_text = "\n".join(pages)
            if "Total: " + money(proposal["totalCents"]) not in full_text:
                raise ValueError("PDF total differs from proposal input")
            return pdf.page_count
    except (fitz.FileDataError, fitz.EmptyFileError) as exc:
        raise ValueError("Unreadable synthetic PDF") from exc


def build_integrity_manifest(snapshot: dict, pdf_bytes: bytes, revision: int) -> dict:
    """Bind one synthetically rendered PDF to exact fixture contents and revision."""
    if type(revision) is not int or not 1 <= revision <= 1000000:
        raise ValueError("Invalid synthetic revision")
    content = _snapshot_bytes(snapshot)
    pages = _inspect_pdf(snapshot, pdf_bytes)
    return {
        "format": FORMAT,
        "disposition": DISPOSITION,
        "reference": snapshot["proposal"]["reference"],
        "revision": revision,
        "snapshotSha256": _digest(content),
        "pdfSha256": _digest(pdf_bytes),
        "pdfBytes": len(pdf_bytes),
        "pageCount": pages,
    }


def verify_integrity_manifest(snapshot: dict, pdf_bytes: bytes,
                              manifest: dict, revision: int) -> bool:
    """Reject stale/tampered manifests; success is never delivery authority."""
    if type(manifest) is not dict or set(manifest) != {
        "format", "disposition", "reference", "revision",
        "snapshotSha256", "pdfSha256", "pdfBytes", "pageCount"
    }:
        raise ValueError("Invalid synthetic manifest shape")
    if any(type(manifest[key]) is not str or not SHA256.fullmatch(manifest[key])
           for key in ("snapshotSha256", "pdfSha256")):
        raise ValueError("Invalid synthetic manifest digests")
    expected = build_integrity_manifest(snapshot, pdf_bytes, revision)
    if any(type(manifest[key]) is not type(value) or manifest[key] != value
           for key, value in expected.items()):
        raise ValueError("Synthetic artifact, revision or manifest mismatch")
    return True
