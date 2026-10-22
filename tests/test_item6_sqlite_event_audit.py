"""Redacted forensic integrity checks for the Item 6 fictional event ledgers.

Tests intentionally inject contradictory records only into disposable SQLite
fixtures; no legitimate code path permits this and no real recipient exists.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import json
import sqlite3
import tempfile
import unittest

from ci.item6_sqlite_hold_summary import fictional_hold_summary
from ci.item6_sqlite_rehearsal import initialize_fixture_db, close_fictional_deal
from ci.item6_sqlite_review_gate import record_fictional_consent

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
BUYER = "buyer@fictional.example"
EVENT = "11111111-1111-4111-8111-111111111111"
SECOND_EVENT = "22222222-2222-4222-8222-222222222222"


class FictionalEvidenceCollisionAuditTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "corruption.sqlite3"
        initialize_fixture_db(self.path)

    def report(self, tenant=ORG):
        return fictional_hold_summary(self.path, tenant)

    def corrupt(self, statements):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("BEGIN IMMEDIATE")
            for sql, values in statements:
                db.execute(sql, values)
            db.commit()

    def consent(self, org=ORG, event_id=EVENT, buyer=BUYER):
        return record_fictional_consent(self.path, org, buyer, event_id)

    def test_clean_ledger_and_idempotent_replay_have_no_collision(self):
        self.assertEqual(self.report()["crossLedgerEventIdConflicts"], 0)
        self.assertEqual(self.consent(), "fictional-consent-recorded")
        self.assertEqual(self.consent(), "blocked-duplicate-consent")
        report = self.report()
        self.assertEqual(report["eventEvidenceState"],
                         "no-observed-collisions-simulation-only")
        self.assertEqual(report["crossLedgerEventIdConflicts"], 0)
        self.assertFalse(report["contactAuthorized"])
        self.assertEqual(report["pendingEvidenceState"],
                         "consistent-simulation-only")

    def test_corrupted_consent_and_closure_reuse_detected_without_repair(self):
        self.assertEqual(self.consent(), "fictional-consent-recorded")
        self.corrupt([(
            "INSERT INTO rehearsal_deal_closures VALUES (?,?,?,?)",
            (ORG, PROP, EVENT, "won"),
        )])
        report = self.report()
        self.assertEqual(report["crossLedgerEventIdConflicts"], 1)
        self.assertEqual(report["eventEvidenceState"],
                         "conflicting-event-ids-needs-review")
        self.assertEqual(report["closedProposals"], 1)
        self.assertEqual(report["pendingEvidenceState"],
                         "consistent-simulation-only")
        self.assertEqual(self.report(), report)  # no auto-repair
        for secret in (ORG, PROP, BUYER, EVENT, "event_id", '"recipient":'):
            self.assertNotIn(secret, json.dumps(report))
        self.assertIs(report["contactAuthorized"], False)

    def test_one_colliding_id_in_three_ledgers_counts_once(self):
        self.consent()
        self.corrupt([
            ("INSERT INTO rehearsal_deal_closures VALUES (?,?,?,?)",
             (ORG, PROP, EVENT, "lost")),
            ("INSERT INTO rehearsal_consent_revocations VALUES (?,?,?)",
             (ORG, BUYER, EVENT)),
        ])
        report = self.report()
        self.assertEqual(report["crossLedgerEventIdConflicts"], 1)
        self.assertEqual(report["consentWithdrawals"], 1)
        self.assertEqual(report["closedProposals"], 1)
        self.assertEqual(report["eventEvidenceState"],
                         "conflicting-event-ids-needs-review")
        self.corrupt([
            ("INSERT INTO rehearsal_recipient_confirmation_revocations "
             "VALUES (?,?,?,?,?)",
             (ORG, PROP, 3, BUYER, SECOND_EVENT)),
            ("INSERT INTO rehearsal_recipient_confirmations "
             "VALUES (?,?,?,?,?,?,?)",
             (ORG, PROP, 3, "a"*64, BUYER, OTHER, SECOND_EVENT)),
        ])
        self.assertEqual(self.report()["crossLedgerEventIdConflicts"], 2)

    def test_scoped_audit_does_not_confuse_same_uuid_across_tenants(self):
        self.assertEqual(self.consent(), "fictional-consent-recorded")
        self.assertEqual(close_fictional_deal(
            self.path, OTHER, PROP, BUYER, EVENT, "lost"),
            ("closed-simulation-only", 0))
        self.assertEqual(self.report()["crossLedgerEventIdConflicts"], 0)
        self.assertEqual(self.report(OTHER)["crossLedgerEventIdConflicts"], 0)
        self.corrupt([(
            "INSERT INTO rehearsal_deal_closures VALUES (?,?,?,?)",
            (ORG, PROP, EVENT, "lost"),
        )])
        self.assertEqual(self.report()["crossLedgerEventIdConflicts"], 1)
        other = self.report(OTHER)
        self.assertEqual(other["crossLedgerEventIdConflicts"], 0)
        self.assertEqual(other["eventEvidenceState"],
                         "no-observed-collisions-simulation-only")

    def test_concurrent_reads_never_report_half_a_corrupt_transaction(self):
        self.consent()
        before = self.report()
        statements = [
            ("INSERT INTO rehearsal_deal_closures VALUES (?,?,?,?)",
             (ORG, PROP, EVENT, "won")),
            ("INSERT INTO rehearsal_consent_revocations VALUES (?,?,?)",
             (ORG, BUYER, EVENT)),
        ]
        with ThreadPoolExecutor(max_workers=9) as pool:
            change = pool.submit(self.corrupt, statements)
            snapshots = list(pool.map(lambda _: self.report(), range(24)))
            change.result()
        after = self.report()
        self.assertEqual(before["crossLedgerEventIdConflicts"], 0)
        self.assertEqual(after["crossLedgerEventIdConflicts"], 1)
        self.assertEqual(after["consentWithdrawals"], 1)
        self.assertEqual(after["closedProposals"], 1)
        self.assertTrue(all(snapshot in (before, after) for snapshot in snapshots))


if __name__ == "__main__":
    unittest.main()
