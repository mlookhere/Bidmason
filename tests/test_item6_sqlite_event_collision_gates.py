"""A corrupted fictional event ledger cannot authorize forward delivery steps.

All data are disposable SQLite fixtures and fabricated reserved-domain buyers.
Neither reservations nor handoffs contact a provider or authorize real sends.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest

from ci.item6_sqlite_hold_summary import fictional_hold_summary
from ci.item6_sqlite_rehearsal import (
    close_fictional_deal, fictional_counts, fictional_unknown_count,
    initialize_fixture_db, mark_fictional_handoff_unknown,
    record_fictional_contact_signal, reserve_fictional,
)
from ci.item6_sqlite_review_gate import (
    mark_reviewed_fictional_handoff_unknown, record_fictional_consent,
    record_fictional_recipient_confirmation, record_fictional_review,
    reserve_reviewed_fictional,
)

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
UNRELATED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
OPERATOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CONTRACTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff"
BUYER = "buyer@fictional.example"
EVENT = "11111111-1111-4111-8111-111111111111"
APPROVAL_EVENT = "22222222-2222-4222-8222-222222222222"
DIGEST = "a" * 64
REV = 3


def key(seed):
    return "dryrun_" + hashlib.sha256(seed.encode()).hexdigest()


class ForwardEventConsistencyGateTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "collision-gates.sqlite3"
        initialize_fixture_db(self.path)

    def consent(self):
        self.assertEqual(
            record_fictional_consent(self.path, ORG, BUYER, EVENT),
            "fictional-consent-recorded",
        )

    def corrupt(self, path=None):
        # Bypass production-like write guards ONLY to simulate already
        # corrupted fixture evidence under the same fictional tenant.
        with closing(sqlite3.connect(path or self.path)) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO rehearsal_deal_closures VALUES (?,?,?,?)",
                (ORG, UNRELATED, EVENT, "lost"),
            )
            db.commit()

    def raw_reserve(self, org=ORG, seed="raw", path=None):
        return reserve_fictional(path or self.path, org, PROP, BUYER, key(seed))

    def raw_handoff(self, org=ORG, seed="raw", path=None):
        return mark_fictional_handoff_unknown(
            path or self.path, org, PROP, BUYER, key(seed),
        )

    def reviewed_ready(self):
        for role, actor in (("operator", OPERATOR), ("contractor", CONTRACTOR)):
            self.assertEqual(record_fictional_review(
                self.path, ORG, PROP, REV, DIGEST, role, actor),
                "fictional-review-recorded",
            )
        self.consent()
        self.assertEqual(record_fictional_recipient_confirmation(
            self.path, ORG, PROP, REV, DIGEST, BUYER,
            CONTRACTOR, APPROVAL_EVENT,
        ), "fictional-recipient-confirmed")

    def reviewed_reserve(self):
        return reserve_reviewed_fictional(
            self.path, ORG, PROP, REV, DIGEST, BUYER, key("reviewed"),
        )

    def reviewed_handoff(self):
        return mark_reviewed_fictional_handoff_unknown(
            self.path, ORG, PROP, REV, DIGEST, BUYER, key("reviewed"),
        )

    def test_clean_raw_reservation_and_handoff_behave_as_before(self):
        self.consent()
        self.assertEqual(self.raw_reserve(), "reserved-simulation-only")
        self.assertEqual(self.raw_handoff(), "outcome-unknown-simulation-only")
        self.assertEqual(self.raw_handoff(), "blocked-unknown-outcome-existing")
        self.assertEqual(fictional_unknown_count(self.path, ORG), 1)
        self.assertFalse(fictional_hold_summary(self.path, ORG)["contactAuthorized"])

    def test_existing_collision_blocks_new_raw_reservation_for_same_tenant(self):
        self.consent()
        self.corrupt()
        self.assertEqual(
            fictional_hold_summary(self.path, ORG)["crossLedgerEventIdConflicts"], 1)
        self.assertEqual(self.raw_reserve(), "blocked-event-evidence-inconsistent")
        self.assertEqual(fictional_counts(self.path, ORG), (0, 0, 0))
        # Same invented UUID in another tenant is NOT a cross-tenant collision.
        self.assertEqual(self.raw_reserve(org=OTHER), "reserved-simulation-only")
        self.assertEqual(
            fictional_hold_summary(self.path, OTHER)["crossLedgerEventIdConflicts"], 0)

    def test_collision_after_raw_reservation_blocks_handoff_without_repair(self):
        self.consent()
        self.assertEqual(self.raw_reserve(), "reserved-simulation-only")
        self.corrupt()
        self.assertEqual(self.raw_handoff(), "blocked-event-evidence-inconsistent")
        self.assertEqual(fictional_unknown_count(self.path, ORG), 0)
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))
        # Suppression remains available even when evidence is inconsistent.
        self.assertEqual(record_fictional_contact_signal(
            self.path, ORG, PROP, BUYER, "opted_out"), 1)
        self.assertEqual(fictional_counts(self.path, ORG), (0, 1, 1))
        self.assertEqual(self.raw_handoff(), "blocked-no-matching-reservation")

    def test_corrupted_unrelated_event_blocks_reviewed_reservation(self):
        self.reviewed_ready()
        self.corrupt()
        self.assertEqual(self.reviewed_reserve(),
                         "blocked-event-evidence-inconsistent")
        self.assertEqual(fictional_counts(self.path, ORG)[0], 0)
        audit = fictional_hold_summary(self.path, ORG)
        self.assertEqual(audit["eventEvidenceState"],
                         "conflicting-event-ids-needs-review")
        self.assertFalse(audit["contactAuthorized"])

    def test_corrupted_event_after_reviewed_reservation_blocks_strict_handoff(self):
        self.reviewed_ready()
        self.assertEqual(self.reviewed_reserve(), "reserved-simulation-only")
        self.corrupt()
        self.assertEqual(self.reviewed_handoff(),
                         "blocked-event-evidence-inconsistent")
        self.assertEqual(fictional_unknown_count(self.path, ORG), 0)
        self.assertEqual(fictional_counts(self.path, ORG)[0], 1)
        # Future tenant suppression still invalidates this pending row.
        self.assertEqual(record_fictional_contact_signal(
            self.path, ORG, PROP, BUYER, "complained"), 1)
        self.assertEqual(self.reviewed_handoff(), "blocked-no-matching-reservation")

    def test_already_unknown_handoff_stays_sticky_after_later_corruption(self):
        self.reviewed_ready()
        self.assertEqual(self.reviewed_reserve(), "reserved-simulation-only")
        self.assertEqual(self.reviewed_handoff(), "outcome-unknown-simulation-only")
        self.corrupt()
        self.assertEqual(self.reviewed_handoff(), "blocked-unknown-outcome-existing")
        self.assertEqual(fictional_unknown_count(self.path, ORG), 1)
        self.assertEqual(self.reviewed_reserve(), "blocked-event-evidence-inconsistent")
        self.assertEqual(close_fictional_deal(
            self.path, ORG, PROP, BUYER,
            "33333333-3333-4333-8333-333333333333", "won"),
            ("closed-simulation-only", 0))
        self.assertEqual(fictional_unknown_count(self.path, ORG), 1)

    def test_collision_race_cannot_advance_hand_off_after_conflict_commits(self):
        for _ in range(6):
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / "race.sqlite3"
                initialize_fixture_db(path)
                record_fictional_consent(path, ORG, BUYER, EVENT)
                self.assertEqual(self.raw_reserve(path=path),
                                 "reserved-simulation-only")
                with ThreadPoolExecutor(max_workers=2) as pool:
                    a = pool.submit(self.corrupt, path)
                    b = pool.submit(self.raw_handoff, ORG, "raw", path)
                    a.result()
                    handoff = b.result()
                self.assertIn(handoff, (
                    "blocked-event-evidence-inconsistent",
                    "outcome-unknown-simulation-only",
                ))
                if handoff == "blocked-event-evidence-inconsistent":
                    self.assertEqual(fictional_unknown_count(path, ORG), 0)
                    self.assertEqual(self.raw_handoff(path=path), handoff)
                else:
                    self.assertEqual(fictional_unknown_count(path, ORG), 1)
                    self.assertEqual(self.raw_handoff(path=path),
                                     "blocked-unknown-outcome-existing")
                self.assertEqual(
                    fictional_hold_summary(path, ORG)["crossLedgerEventIdConflicts"], 1)


if __name__ == "__main__":
    unittest.main()
