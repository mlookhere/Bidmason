"""Aggregate-only fictional Item 6 delivery hold visibility.

Disposable SQLite rehearsal, not authenticated tenant reporting, permission to
send, reconciliation, or a source of real customer evidence. Never exposes
recipient/proposal identifiers, keys, review actors or event payloads.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from ci.item6_sqlite_rehearsal import _UUID, _transaction


def fictional_hold_summary(path: Path, organization_id: str) -> dict[str, object]:
    """Return one transactionally consistent, identity-free tenant snapshot.

    Categories overlap by design: an uncertain handoff can coexist with an
    opt-out, a revoked approval, and withdrawn consent. Never add these counts
    together to claim unique recipients or delivery success.
    """
    if type(organization_id) is not str or _UUID.fullmatch(organization_id) is None:
        raise ValueError("Invalid fictional tenant summary scope")

    def act(db: sqlite3.Connection) -> dict[str, object]:
        def count(table: str, where: str = "", args: tuple[object, ...] = ()) -> int:
            # Internal literal SQL only; no caller-provided table or predicate.
            return db.execute(
                f"SELECT COUNT(*) FROM {table} WHERE organization_id=? {where}",
                (organization_id, *args),
            ).fetchone()[0]

        # A stale or manually corrupted pending row must not look like a
        # coherent dry run merely because its state says "reserved".
        # Low-level unreviewed CAS fixtures intentionally require no reviews.
        # Already-uncertain handoffs may legitimately coexist with later stops.
        unsafe_pending = db.execute(
            """
            SELECT COUNT(*) FROM rehearsal_reservations AS r
            WHERE r.organization_id=? AND r.state='reserved'
              AND (
                EXISTS (SELECT 1 FROM rehearsal_contact_signals AS s
                        WHERE s.organization_id=r.organization_id
                          AND s.recipient=r.recipient)
                OR EXISTS (SELECT 1 FROM rehearsal_consent_revocations AS w
                           WHERE w.organization_id=r.organization_id
                             AND w.recipient=r.recipient)
                OR EXISTS (SELECT 1 FROM rehearsal_deal_closures AS d
                           WHERE d.organization_id=r.organization_id
                             AND d.proposal_id=r.proposal_id)
                OR (
                  r.reviewed_revision IS NOT NULL AND (
                    NOT EXISTS (
                      SELECT 1 FROM rehearsal_review_receipts AS o
                      WHERE o.organization_id=r.organization_id
                        AND o.proposal_id=r.proposal_id
                        AND o.revision=r.reviewed_revision
                        AND o.role='operator'
                        AND o.content_sha256=r.reviewed_sha256)
                    OR NOT EXISTS (
                      SELECT 1 FROM rehearsal_review_receipts AS contractor
                      WHERE contractor.organization_id=r.organization_id
                        AND contractor.proposal_id=r.proposal_id
                        AND contractor.revision=r.reviewed_revision
                        AND contractor.role='contractor'
                        AND contractor.content_sha256=r.reviewed_sha256)
                    OR EXISTS (
                      SELECT 1 FROM rehearsal_review_receipts AS newer
                      WHERE newer.organization_id=r.organization_id
                        AND newer.proposal_id=r.proposal_id
                        AND newer.revision>r.reviewed_revision)
                    OR NOT EXISTS (
                      SELECT 1 FROM rehearsal_consent_confirmations AS consent
                      WHERE consent.organization_id=r.organization_id
                        AND consent.recipient=r.recipient)
                    OR NOT EXISTS (
                      SELECT 1 FROM rehearsal_recipient_confirmations AS rc
                      JOIN rehearsal_review_receipts AS reviewer
                        ON reviewer.organization_id=rc.organization_id
                       AND reviewer.proposal_id=rc.proposal_id
                       AND reviewer.revision=rc.revision
                       AND reviewer.role='contractor'
                       AND reviewer.actor_id=rc.contractor_actor_id
                       AND reviewer.content_sha256=rc.content_sha256
                      WHERE rc.organization_id=r.organization_id
                        AND rc.proposal_id=r.proposal_id
                        AND rc.revision=r.reviewed_revision
                        AND rc.recipient=r.recipient
                        AND rc.content_sha256=r.reviewed_sha256)
                    OR EXISTS (
                      SELECT 1 FROM rehearsal_recipient_confirmation_revocations AS cr
                      WHERE cr.organization_id=r.organization_id
                        AND cr.proposal_id=r.proposal_id
                        AND cr.revision=r.reviewed_revision
                        AND cr.recipient=r.recipient)
                  )
                )
              )
            """, (organization_id,)
        ).fetchone()[0]

        # The sole caller supplies no free-form SQL; every count uses the same
        # organization filter while BEGIN IMMEDIATE protects snapshot coherence.
        return {
            "pendingEvidenceState": (
                "inconsistent-needs-review" if unsafe_pending
                else "consistent-simulation-only"),
            "inconsistentPendingReservations": unsafe_pending,
            "state": "review-simulation-only",
            "contactAuthorized": False,
            "pendingReservations": count(
                "rehearsal_reservations", "AND state=?", ("reserved",)),
            "invalidatedReservations": count(
                "rehearsal_reservations", "AND state=?", ("invalidated",)),
            "unknownOutcomeHolds": count(
                "rehearsal_reservations", "AND state=?", ("outcome_unknown",)),
            "consentWithdrawals": count("rehearsal_consent_revocations"),
            "recipientConfirmationRevocations": count(
                "rehearsal_recipient_confirmation_revocations"),
            "suppressedRecipients": db.execute(
                "SELECT COUNT(DISTINCT recipient) FROM rehearsal_contact_signals "
                "WHERE organization_id=?", (organization_id,)
            ).fetchone()[0],
            "closedProposals": count("rehearsal_deal_closures"),
        }

    return _transaction(path, act)
