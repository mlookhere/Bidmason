"""Offline-only Item 6 SQLite transaction rehearsal.

Uses fabricated *.example / *.test / *.invalid recipients and explicit caller-
provided file paths. Not an app service, RLS system, provider adapter, send
permission, or a substitute for the production PostgreSQL integration gates.
"""
from __future__ import annotations

import re
import tempfile
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Callable, TypeVar

_UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")
_DRY_KEY = re.compile(r"dryrun_[a-f0-9]{64}\Z")
_FAKE_RECIPIENT = re.compile(r"[a-z0-9][a-z0-9.+_-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:example|test|invalid)\Z")
_SIGNAL_KINDS = frozenset({"replied", "opted_out", "bounced", "complained"})
_CLOSURE_KINDS = frozenset({"won", "lost"})
_T = TypeVar("_T")

# Real/sensitive/customer addresses are deliberately excluded from this test model.
def _identity(organization_id: str, proposal_id: str, recipient: str) -> None:
    if (type(organization_id) is not str or not _UUID.fullmatch(organization_id)
            or type(proposal_id) is not str or not _UUID.fullmatch(proposal_id)
            or type(recipient) is not str or not _FAKE_RECIPIENT.fullmatch(recipient)):
        raise ValueError("Only fully scoped fictional rehearsal identities are allowed")


def _safe_fixture_path(path: Path) -> bool:
    # No production or user-controlled DB paths: this rehearsal is temp-only.
    return (isinstance(path, Path) and path.is_absolute()
            and path.suffix == ".sqlite3" and not path.is_symlink()
            and path.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))


def initialize_fixture_db(path: Path) -> None:
    """Create an isolated test database; never run this against a live project."""
    if not _safe_fixture_path(path) or path.exists():
        raise ValueError("Fixture database must be a new regular path")
    with closing(sqlite3.connect(path)) as db:
        db.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE rehearsal_reservations (
          organization_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          recipient TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('reserved', 'invalidated')),
          PRIMARY KEY (organization_id, idempotency_key)
        );
        CREATE UNIQUE INDEX rehearsal_one_live_recipient
          ON rehearsal_reservations (organization_id, recipient)
          WHERE state = 'reserved';
        CREATE TABLE rehearsal_contact_signals (
          organization_id TEXT NOT NULL,
          recipient TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('replied','opted_out','bounced','complained')),
          PRIMARY KEY (organization_id, recipient, kind)
        );
        CREATE TABLE rehearsal_deal_closures (
          organization_id TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('won','lost')),
          PRIMARY KEY (organization_id, proposal_id)
        );
        """)


def _transaction(path: Path, work: Callable[[sqlite3.Connection], _T]) -> _T:
    if not _safe_fixture_path(path) or not path.is_file():
        raise ValueError("Missing or invalid fictional transaction fixture")
    # Independent connections + BEGIN IMMEDIATE serialize reads and mutations.
    # Explicit COMMIT/ROLLBACK avoids half-written fictional contact decisions.
    with closing(sqlite3.connect(path, timeout=15, isolation_level=None)) as db:
        db.execute("PRAGMA busy_timeout=15000")
        db.execute("BEGIN IMMEDIATE")
        try:
            result = work(db)
            db.execute("COMMIT")
            return result
        except BaseException:
            db.execute("ROLLBACK")
            raise


def reserve_fictional(
    path: Path, organization_id: str, proposal_id: str, recipient: str,
    idempotency_key: str,
) -> str:
    """Return a simulation-only verdict, never contact authorization."""
    _identity(organization_id, proposal_id, recipient)
    if type(idempotency_key) is not str or not _DRY_KEY.fullmatch(idempotency_key):
        raise ValueError("Expected a fabricated, scoped dry-run key")

    def act(db: sqlite3.Connection) -> str:
        if db.execute("SELECT 1 FROM rehearsal_reservations WHERE organization_id=? AND idempotency_key=?",
                      (organization_id, idempotency_key)).fetchone():
            return "blocked-existing-key"
        if db.execute("SELECT 1 FROM rehearsal_contact_signals WHERE organization_id=? AND recipient=?",
                      (organization_id, recipient)).fetchone():
            return "blocked-contact-hold"
        if db.execute("SELECT 1 FROM rehearsal_deal_closures WHERE organization_id=? AND proposal_id=?",
                      (organization_id, proposal_id)).fetchone():
            return "blocked-closed-deal"
        if db.execute("SELECT 1 FROM rehearsal_reservations WHERE organization_id=? AND recipient=? AND state='reserved'",
                      (organization_id, recipient)).fetchone():
            return "blocked-existing-recipient-reservation"
        db.execute("INSERT INTO rehearsal_reservations VALUES (?,?,?,?, 'reserved')",
                   (organization_id, idempotency_key, proposal_id, recipient))
        return "reserved-simulation-only"

    return _transaction(path, act)


def record_fictional_contact_signal(
    path: Path, organization_id: str, proposal_id: str,
    recipient: str, kind: str,
) -> int:
    """Sticky fictional signal; revoke all current recipient locks in one commit."""
    _identity(organization_id, proposal_id, recipient)
    if type(kind) is not str or kind not in _SIGNAL_KINDS:
        raise ValueError("Invalid fictional contact signal")

    def act(db: sqlite3.Connection) -> int:
        db.execute("INSERT OR IGNORE INTO rehearsal_contact_signals VALUES (?,?,?)",
                   (organization_id, recipient, kind))
        changed = db.execute(
            "UPDATE rehearsal_reservations SET state='invalidated' "
            "WHERE organization_id=? AND recipient=? AND state='reserved'",
            (organization_id, recipient))
        return changed.rowcount

    return _transaction(path, act)


def close_fictional_deal(
    path: Path, organization_id: str, proposal_id: str,
    recipient: str, event_id: str, kind: str,
) -> tuple[str, int]:
    """Immutable terminal claim cancels every live reservation of that deal."""
    _identity(organization_id, proposal_id, recipient)
    if (type(event_id) is not str or not _UUID.fullmatch(event_id)
            or type(kind) is not str or kind not in _CLOSURE_KINDS):
        raise ValueError("Invalid fictional closure claim")

    def act(db: sqlite3.Connection) -> tuple[str, int]:
        previous = db.execute(
            "SELECT event_id,kind FROM rehearsal_deal_closures WHERE organization_id=? AND proposal_id=?",
            (organization_id, proposal_id)).fetchone()
        if previous is not None:
            if previous != (event_id, kind):
                raise ValueError("Conflicting fictional terminal deal claim")
            return "blocked-duplicate-deal-closure", 0
        db.execute("INSERT INTO rehearsal_deal_closures VALUES (?,?,?,?)",
                   (organization_id, proposal_id, event_id, kind))
        changed = db.execute(
            "UPDATE rehearsal_reservations SET state='invalidated' "
            "WHERE organization_id=? AND proposal_id=? AND state='reserved'",
            (organization_id, proposal_id))
        return "closed-simulation-only", changed.rowcount

    return _transaction(path, act)


def fictional_counts(path: Path, organization_id: str) -> tuple[int, int, int]:
    """Aggregate-only test witness; no recipients, keys or raw event data."""
    if type(organization_id) is not str or not _UUID.fullmatch(organization_id):
        raise ValueError("Invalid fictional tenant")
    def act(db: sqlite3.Connection) -> tuple[int, int, int]:
        return (
            db.execute("SELECT COUNT(*) FROM rehearsal_reservations WHERE organization_id=? AND state='reserved'",
                       (organization_id,)).fetchone()[0],
            db.execute("SELECT COUNT(*) FROM rehearsal_reservations WHERE organization_id=? AND state='invalidated'",
                       (organization_id,)).fetchone()[0],
            db.execute("SELECT COUNT(*) FROM rehearsal_contact_signals WHERE organization_id=?",
                       (organization_id,)).fetchone()[0],
        )
    return _transaction(path, act)
