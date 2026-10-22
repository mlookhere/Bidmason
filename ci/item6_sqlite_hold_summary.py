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

        # The sole caller supplies no free-form SQL; every count uses the same
        # organization filter while BEGIN IMMEDIATE protects snapshot coherence.
        return {
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
