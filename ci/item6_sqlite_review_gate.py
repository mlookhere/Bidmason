"""Fictional dual-review and consent gate on the disposable SQLite fixture.

Not an authenticated reviewer, real recipient permission, app endpoint, or
production database operation. Never sends, signs, issues tokens or queues jobs.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from ci.item6_sqlite_rehearsal import (
    _DRY_KEY, _UUID, _identity, _reserve_in_transaction, _transaction,
)

_DIGEST = re.compile(r"[a-f0-9]{64}\Z")
_ROLES = frozenset({"operator", "contractor"})


def _revision(value: object) -> bool:
    return type(value) is int and 1 <= value <= 1_000_000


def _digest(value: object) -> bool:
    return type(value) is str and _DIGEST.fullmatch(value) is not None


def record_fictional_review(
    path: Path, organization_id: str, proposal_id: str, revision: int,
    content_sha256: str, role: str, actor_id: str,
) -> str:
    """An invented review receipt, not proof a human checked a real proposal."""
    _identity(organization_id, proposal_id, "review@fictional.example")
    if (not _revision(revision) or not _digest(content_sha256)
            or type(role) is not str or role not in _ROLES
            or type(actor_id) is not str or _UUID.fullmatch(actor_id) is None):
        raise ValueError("Invalid fictional review claim")

    def act(db: sqlite3.Connection) -> str:
        if db.execute("SELECT 1 FROM rehearsal_deal_closures "
                      "WHERE organization_id=? AND proposal_id=?",
                      (organization_id, proposal_id)).fetchone():
            return "blocked-closed-deal"
        newest = db.execute(
            "SELECT MAX(revision) FROM rehearsal_review_receipts "
            "WHERE organization_id=? AND proposal_id=?",
            (organization_id, proposal_id)).fetchone()[0]
        if newest is not None and newest > revision:
            return "blocked-stale-review"
        existing = db.execute(
            "SELECT content_sha256,actor_id FROM rehearsal_review_receipts "
            "WHERE organization_id=? AND proposal_id=? AND revision=? AND role=?",
            (organization_id, proposal_id, revision, role)).fetchone()
        if existing is not None:
            if existing != (content_sha256, actor_id):
                raise ValueError("Conflicting fictional review receipt")
            return "blocked-duplicate-review"
        if db.execute(
            "SELECT 1 FROM rehearsal_review_receipts "
            "WHERE organization_id=? AND proposal_id=? AND revision=? AND actor_id=?",
            (organization_id, proposal_id, revision, actor_id)).fetchone():
            raise ValueError("Fictional reviewer cannot approve in both roles")
        if db.execute(
            "SELECT 1 FROM rehearsal_review_receipts "
            "WHERE organization_id=? AND proposal_id=? AND revision=? "
            "AND content_sha256<>?",
            (organization_id, proposal_id, revision, content_sha256)).fetchone():
            raise ValueError("Conflicting fictional revision content")
        db.execute("INSERT INTO rehearsal_review_receipts VALUES (?,?,?,?,?,?)",
                   (organization_id, proposal_id, revision, content_sha256,
                    role, actor_id))
        # The first newly recorded review of a later revision supersedes any
        # still-pending reviewed reservations of earlier revisions in this
        # SAME transaction. An outcome_unknown row may already represent an
        # external side effect and must remain unresolved and held.
        db.execute(
            "UPDATE rehearsal_reservations SET state='invalidated' "
            "WHERE organization_id=? AND proposal_id=? "
            "AND state='reserved' AND reviewed_revision < ?",
            (organization_id, proposal_id, revision))
        return "fictional-review-recorded"

    return _transaction(path, act)


def record_fictional_consent(
    path: Path, organization_id: str, recipient: str, event_id: str,
) -> str:
    """Store an invented confirmation; source authenticity remains unverified."""
    _identity(organization_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", recipient)
    if type(event_id) is not str or _UUID.fullmatch(event_id) is None:
        raise ValueError("Invalid fictional consent event")

    def act(db: sqlite3.Connection) -> str:
        if db.execute("SELECT 1 FROM rehearsal_contact_signals "
                      "WHERE organization_id=? AND recipient=?",
                      (organization_id, recipient)).fetchone():
            return "blocked-contact-hold"
        previous = db.execute(
            "SELECT event_id FROM rehearsal_consent_confirmations "
            "WHERE organization_id=? AND recipient=?",
            (organization_id, recipient)).fetchone()
        if previous is not None:
            if previous != (event_id,):
                raise ValueError("Conflicting fictional consent confirmation")
            return "blocked-duplicate-consent"
        if db.execute("SELECT 1 FROM rehearsal_consent_confirmations "
                      "WHERE organization_id=? AND event_id=?",
                      (organization_id, event_id)).fetchone():
            raise ValueError("Conflicting fictional consent event ID")
        db.execute("INSERT INTO rehearsal_consent_confirmations VALUES (?,?,?)",
                   (organization_id, recipient, event_id))
        return "fictional-consent-recorded"

    return _transaction(path, act)



def record_fictional_recipient_confirmation(
    path: Path, organization_id: str, proposal_id: str, revision: int,
    content_sha256: str, recipient: str, contractor_actor_id: str,
    event_id: str,
) -> str:
    """An invented per-recipient, per-revision claim, never send permission."""
    _identity(organization_id, proposal_id, recipient)
    if (not _revision(revision) or not _digest(content_sha256)
            or type(contractor_actor_id) is not str
            or _UUID.fullmatch(contractor_actor_id) is None
            or type(event_id) is not str or _UUID.fullmatch(event_id) is None):
        raise ValueError("Invalid fictional recipient confirmation")

    def act(db: sqlite3.Connection) -> str:
        if db.execute(
            "SELECT 1 FROM rehearsal_deal_closures WHERE organization_id=? "
            "AND proposal_id=?", (organization_id, proposal_id)
        ).fetchone():
            return "blocked-closed-deal"
        if db.execute(
            "SELECT 1 FROM rehearsal_contact_signals WHERE organization_id=? "
            "AND recipient=?", (organization_id, recipient)
        ).fetchone():
            return "blocked-contact-hold"
        newest = db.execute(
            "SELECT MAX(revision) FROM rehearsal_review_receipts "
            "WHERE organization_id=? AND proposal_id=?",
            (organization_id, proposal_id)
        ).fetchone()[0]
        if newest is not None and newest > revision:
            return "blocked-stale-revision"
        review = db.execute(
            "SELECT content_sha256 FROM rehearsal_review_receipts "
            "WHERE organization_id=? AND proposal_id=? AND revision=? "
            "AND role='contractor' AND actor_id=?",
            (organization_id, proposal_id, revision, contractor_actor_id)
        ).fetchone()
        if review != (content_sha256,):
            return "blocked-contractor-review-required"
        if not db.execute(
            "SELECT 1 FROM rehearsal_consent_confirmations "
            "WHERE organization_id=? AND recipient=?",
            (organization_id, recipient)
        ).fetchone():
            return "blocked-unconfirmed-consent"
        old = db.execute(
            "SELECT content_sha256,contractor_actor_id,event_id "
            "FROM rehearsal_recipient_confirmations "
            "WHERE organization_id=? AND proposal_id=? AND revision=? "
            "AND recipient=?",
            (organization_id, proposal_id, revision, recipient)
        ).fetchone()
        if old is not None:
            if old != (content_sha256, contractor_actor_id, event_id):
                raise ValueError("Conflicting fictional recipient confirmation")
            return "blocked-duplicate-recipient-confirmation"
        if db.execute(
            "SELECT 1 FROM rehearsal_recipient_confirmations "
            "WHERE organization_id=? AND event_id=?",
            (organization_id, event_id)
        ).fetchone():
            raise ValueError("Conflicting fictional recipient event ID")
        db.execute(
            "INSERT INTO rehearsal_recipient_confirmations VALUES (?,?,?,?,?,?,?)",
            (organization_id, proposal_id, revision, content_sha256, recipient,
             contractor_actor_id, event_id)
        )
        return "fictional-recipient-confirmed"

    return _transaction(path, act)

def _recipient_confirmed_in_transaction(
    db: sqlite3.Connection, organization_id: str, proposal_id: str,
    revision: int, content_sha256: str, recipient: str,
) -> bool:
    """Validate the invented exact-recipient claim against contractor review."""
    return db.execute(
        "SELECT 1 FROM rehearsal_recipient_confirmations AS c "
        "JOIN rehearsal_review_receipts AS r "
        "ON r.organization_id=c.organization_id "
        "AND r.proposal_id=c.proposal_id AND r.revision=c.revision "
        "AND r.role='contractor' AND r.actor_id=c.contractor_actor_id "
        "AND r.content_sha256=c.content_sha256 "
        "WHERE c.organization_id=? AND c.proposal_id=? AND c.revision=? "
        "AND c.content_sha256=? AND c.recipient=?",
        (organization_id, proposal_id, revision, content_sha256, recipient)
    ).fetchone() is not None


def reserve_reviewed_fictional(
    path: Path, organization_id: str, proposal_id: str, revision: int,
    content_sha256: str, recipient: str, idempotency_key: str,
) -> str:
    """Atomic, fail-closed fictional review/consent check and CAS reservation.

    Inputs are *only* caller-provided fictitious evidence: success remains
    simulation-only and cannot authorize a contact or customer message.
    """
    _identity(organization_id, proposal_id, recipient)
    if (not _revision(revision) or not _digest(content_sha256)
            or type(idempotency_key) is not str
            or _DRY_KEY.fullmatch(idempotency_key) is None):
        raise ValueError("Invalid fictional reviewed reservation")

    def act(db: sqlite3.Connection) -> str:
        verdict = _review_gate_in_transaction(
            db, organization_id, proposal_id, revision, content_sha256, recipient)
        if verdict is not None:
            return verdict
        if not _recipient_confirmed_in_transaction(
            db, organization_id, proposal_id, revision, content_sha256, recipient
        ):
            return "blocked-missing-recipient-confirmation"
        # Shared core CAS inside this SAME BEGIN IMMEDIATE transaction, so a
        # concurrent opt-out or won/lost closure cannot interleave here.
        return _reserve_in_transaction(
            db, organization_id, proposal_id, recipient, idempotency_key,
            reviewed_revision=revision, reviewed_sha256=content_sha256)

    return _transaction(path, act)


def _review_gate_in_transaction(
    db: sqlite3.Connection, organization_id: str, proposal_id: str,
    revision: int, content_sha256: str, recipient: str,
) -> str | None:
    """Fictional review and consent checks, with an existing write transaction."""
    # A known contact stop or closed deal must win even when receipts are absent.
    if db.execute(
        "SELECT 1 FROM rehearsal_contact_signals "
        "WHERE organization_id=? AND recipient=?",
        (organization_id, recipient)).fetchone():
        return "blocked-contact-hold"
    if db.execute(
        "SELECT 1 FROM rehearsal_deal_closures "
        "WHERE organization_id=? AND proposal_id=?",
        (organization_id, proposal_id)).fetchone():
        return "blocked-closed-deal"
    # A newer *partial* review freezes older revisions, including a forged
    # single-signer revocation race; there is no reopen or downgrade path.
    newest = db.execute(
        "SELECT MAX(revision) FROM rehearsal_review_receipts "
        "WHERE organization_id=? AND proposal_id=?",
        (organization_id, proposal_id)).fetchone()[0]
    if newest is not None and newest > revision:
        return "blocked-stale-revision"
    reviewers = db.execute(
        "SELECT role,actor_id,content_sha256 FROM rehearsal_review_receipts "
        "WHERE organization_id=? AND proposal_id=? AND revision=?",
        (organization_id, proposal_id, revision)).fetchall()
    if (len(reviewers) != 2 or {role for role, _, _ in reviewers} != _ROLES
            or reviewers[0][1] == reviewers[1][1]):
        return "blocked-missing-independent-reviews"
    if any(review_hash != content_sha256 for _, _, review_hash in reviewers):
        return "blocked-review-content-mismatch"
    if not db.execute(
        "SELECT 1 FROM rehearsal_consent_confirmations "
        "WHERE organization_id=? AND recipient=?",
        (organization_id, recipient)).fetchone():
        return "blocked-unconfirmed-consent"
    return None


def mark_reviewed_fictional_handoff_unknown(
    path: Path, organization_id: str, proposal_id: str, revision: int,
    content_sha256: str, recipient: str, idempotency_key: str,
) -> str:
    """Re-check a made-up review before recording an UNKNOWN simulated handoff.

    Does not call a provider, send, clear uncertainty, or authorize contact.
    """
    _identity(organization_id, proposal_id, recipient)
    if (not _revision(revision) or not _digest(content_sha256)
            or type(idempotency_key) is not str
            or _DRY_KEY.fullmatch(idempotency_key) is None):
        raise ValueError("Invalid fictional reviewed handoff")

    def act(db: sqlite3.Connection) -> str:
        claim = db.execute(
            "SELECT proposal_id,recipient,reviewed_revision,reviewed_sha256,state "
            "FROM rehearsal_reservations WHERE organization_id=? AND idempotency_key=?",
            (organization_id, idempotency_key)).fetchone()
        if claim is None:
            return "blocked-no-matching-reservation"
        claimed_proposal, claimed_recipient, old_revision, old_hash, state = claim
        if (claimed_proposal, claimed_recipient) != (proposal_id, recipient):
            raise ValueError("Conflicting fictional handoff identity")
        if state == "outcome_unknown":
            return "blocked-unknown-outcome-existing"
        if state != "reserved":
            return "blocked-no-matching-reservation"
        if old_revision is None or old_hash is None:
            return "blocked-unreviewed-reservation"
        if (old_revision, old_hash) != (revision, content_sha256):
            raise ValueError("Conflicting fictional handoff revision or content")
        verdict = _review_gate_in_transaction(
            db, organization_id, proposal_id, revision, content_sha256, recipient)
        if verdict is not None:
            return verdict
        if not _recipient_confirmed_in_transaction(
            db, organization_id, proposal_id, revision, content_sha256, recipient
        ):
            return "blocked-missing-recipient-confirmation"
        if db.execute(
            "SELECT 1 FROM rehearsal_contact_signals "
            "WHERE organization_id=? AND recipient=?",
            (organization_id, recipient)).fetchone():
            return "blocked-contact-hold"
        if db.execute(
            "SELECT 1 FROM rehearsal_deal_closures "
            "WHERE organization_id=? AND proposal_id=?",
            (organization_id, proposal_id)).fetchone():
            return "blocked-closed-deal"
        changed = db.execute(
            "UPDATE rehearsal_reservations SET state='outcome_unknown' "
            "WHERE organization_id=? AND idempotency_key=? AND state='reserved'",
            (organization_id, idempotency_key))
        if changed.rowcount != 1:
            raise RuntimeError("Fictional handoff CAS unexpectedly changed")
        return "outcome-unknown-simulation-only"

    return _transaction(path, act)
