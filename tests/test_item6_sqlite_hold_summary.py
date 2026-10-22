"""Tenant-isolated redacted fictional Item 6 hold-summary regressions."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
import tempfile
import unittest

from ci.item6_sqlite_hold_summary import fictional_hold_summary
from ci.item6_sqlite_rehearsal import (
    close_fictional_deal, initialize_fixture_db, mark_fictional_handoff_unknown,
    record_fictional_contact_signal, reserve_fictional,
)
from ci.item6_sqlite_review_gate import (
    record_fictional_consent, record_fictional_recipient_confirmation,
    record_fictional_review, revoke_fictional_consent,
    revoke_fictional_recipient_confirmation, reserve_reviewed_fictional,
)

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROPOSAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
SECOND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
OP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CON = "ffffffff-ffff-4fff-8fff-ffffffffffff"
BUYER = "buyer@fictional.example"
NEXT = "other@fictional.example"
DIGEST = "a" * 64
EVENT = "11111111-1111-4111-8111-111111111111"
CONSENT = "22222222-2222-4222-8222-222222222222"
WITHDRAW = "33333333-3333-4333-8333-333333333333"
APPROVAL = "44444444-4444-4444-8444-444444444444"


def key(seed):
    return "dryrun_" + hashlib.sha256(seed.encode()).hexdigest()


class FictionalHoldSummaryTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "holds.sqlite3"
        initialize_fixture_db(self.path)

    def summary(self, tenant=ORG):
        return fictional_hold_summary(self.path, tenant)

    def reserve(self, tenant=ORG, proposal=PROPOSAL, recipient=BUYER, seed="one"):
        return reserve_fictional(self.path, tenant, proposal, recipient, key(seed))

    def test_empty_tenant_is_fully_redacted_and_never_authorizes(self):
        result = self.summary()
        self.assertEqual(result, {
            "state": "review-simulation-only",
            "pendingEvidenceState": "consistent-simulation-only",
            "inconsistentPendingReservations": 0,
            "contactAuthorized": False,
            "pendingReservations": 0,
            "invalidatedReservations": 0,
            "unknownOutcomeHolds": 0,
            "consentWithdrawals": 0,
            "recipientConfirmationRevocations": 0,
            "suppressedRecipients": 0,
            "closedProposals": 0,
        })
        self.assertNotIn(ORG, json.dumps(result))
        self.assertNotIn(BUYER, json.dumps(result))
        self.assertNotIn("idempotencyKey", result)

    def test_tenants_are_isolated_and_same_recipient_can_exist_in_each(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(tenant=OTHER), "reserved-simulation-only")
        self.assertEqual(self.summary()["pendingReservations"], 1)
        self.assertEqual(self.summary(OTHER)["pendingReservations"], 1)
        record_fictional_contact_signal(self.path, ORG, PROPOSAL, BUYER, "opted_out")
        self.assertEqual(self.summary()["pendingReservations"], 0)
        self.assertEqual(self.summary()["invalidatedReservations"], 1)
        self.assertEqual(self.summary(OTHER)["pendingReservations"], 1)
        self.assertEqual(self.summary(OTHER)["suppressedRecipients"], 0)

    def test_suppression_counts_distinct_recipients_not_signal_rows(self):
        record_fictional_contact_signal(self.path, ORG, PROPOSAL, BUYER, "replied")
        record_fictional_contact_signal(self.path, ORG, SECOND, BUYER, "opted_out")
        record_fictional_contact_signal(self.path, ORG, PROPOSAL, NEXT, "complained")
        self.assertEqual(self.summary()["suppressedRecipients"], 2)
        self.assertEqual(self.summary()["unknownOutcomeHolds"], 0)
        self.assertEqual(self.summary(OTHER)["suppressedRecipients"], 0)

    def test_unknown_handoff_and_withdrawn_consent_are_separate_counts(self):
        record_fictional_consent(self.path, ORG, BUYER, CONSENT)
        self.reserve()
        self.assertEqual(mark_fictional_handoff_unknown(
            self.path, ORG, PROPOSAL, BUYER, key("one")),
            "outcome-unknown-simulation-only")
        self.assertEqual(revoke_fictional_consent(
            self.path, ORG, BUYER, WITHDRAW), "fictional-consent-withdrawn")
        result = self.summary()
        self.assertEqual(result["unknownOutcomeHolds"], 1)
        self.assertEqual(result["consentWithdrawals"], 1)
        self.assertEqual(result["pendingReservations"], 0)
        self.assertEqual(result["invalidatedReservations"], 0)
        self.assertFalse(result["contactAuthorized"])

    def test_recipient_confirmation_revocation_and_deal_closure(self):
        record_fictional_review(self.path, ORG, PROPOSAL, 3, DIGEST, "operator", OP)
        record_fictional_review(self.path, ORG, PROPOSAL, 3, DIGEST, "contractor", CON)
        record_fictional_consent(self.path, ORG, BUYER, CONSENT)
        self.assertEqual(record_fictional_recipient_confirmation(
            self.path, ORG, PROPOSAL, 3, DIGEST, BUYER, CON, APPROVAL),
            "fictional-recipient-confirmed")
        self.assertEqual(revoke_fictional_recipient_confirmation(
            self.path, ORG, PROPOSAL, 3, BUYER, WITHDRAW),
            "fictional-confirmation-revoked")
        self.assertEqual(close_fictional_deal(
            self.path, ORG, PROPOSAL, BUYER, EVENT, "lost"),
            ("closed-simulation-only", 0))
        result = self.summary()
        self.assertEqual(result["recipientConfirmationRevocations"], 1)
        self.assertEqual(result["closedProposals"], 1)
        self.assertEqual(result["consentWithdrawals"], 0)
        self.assertFalse(result["contactAuthorized"])

    def test_concurrent_snapshot_never_exposes_partial_withdrawal(self):
        record_fictional_consent(self.path, ORG, BUYER, CONSENT)
        self.reserve()
        before = self.summary()
        with ThreadPoolExecutor(max_workers=9) as pool:
            fut = pool.submit(revoke_fictional_consent,
                              self.path, ORG, BUYER, WITHDRAW)
            snapshots = list(pool.map(lambda _: self.summary(), range(24)))
            self.assertEqual(fut.result(), "fictional-consent-withdrawn")
        after = self.summary()
        self.assertEqual((before["pendingReservations"],
                          before["invalidatedReservations"],
                          before["consentWithdrawals"]), (1, 0, 0))
        self.assertEqual((after["pendingReservations"],
                          after["invalidatedReservations"],
                          after["consentWithdrawals"]), (0, 1, 1))
        self.assertTrue(all(s in (before, after) for s in snapshots))

    def reviewed_ready(self):
        self.assertEqual(record_fictional_review(
            self.path, ORG, PROPOSAL, 3, DIGEST, "operator", OP),
            "fictional-review-recorded")
        self.assertEqual(record_fictional_review(
            self.path, ORG, PROPOSAL, 3, DIGEST, "contractor", CON),
            "fictional-review-recorded")
        self.assertEqual(record_fictional_consent(
            self.path, ORG, BUYER, CONSENT), "fictional-consent-recorded")
        self.assertEqual(record_fictional_recipient_confirmation(
            self.path, ORG, PROPOSAL, 3, DIGEST, BUYER, CON, APPROVAL),
            "fictional-recipient-confirmed")
        self.assertEqual(reserve_reviewed_fictional(
            self.path, ORG, PROPOSAL, 3, DIGEST, BUYER, key("reviewed")),
            "reserved-simulation-only")
        self.assertEqual(self.summary()["inconsistentPendingReservations"], 0)

    def mutate(self, sql, parameters=()):
        # Deliberately corrupt only this disposable CI fixture to test detection;
        # the report itself never writes or repairs underlying reservations.
        with closing(sqlite3.connect(self.path)) as db:
            db.execute(sql, parameters)
            db.commit()

    def test_missing_review_or_confirmation_surfaces_inconsistent_pending(self):
        for mutation in (
            "DELETE FROM rehearsal_review_receipts WHERE role='contractor'",
            "DELETE FROM rehearsal_recipient_confirmations",
            "DELETE FROM rehearsal_consent_confirmations",
            "UPDATE rehearsal_review_receipts SET content_sha256='" + "b" * 64 +
            "' WHERE role='contractor'",
        ):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as folder:
                path = self.path
                self.path = Path(folder) / "mutated.sqlite3"
                try:
                    initialize_fixture_db(self.path)
                    self.reviewed_ready()
                    self.mutate(mutation)
                    result = self.summary()
                    self.assertEqual(result["pendingReservations"], 1)
                    self.assertEqual(result["inconsistentPendingReservations"], 1)
                    self.assertEqual(result["pendingEvidenceState"],
                                     "inconsistent-needs-review")
                    self.assertFalse(result["contactAuthorized"])
                    self.assertNotIn(BUYER, json.dumps(result))
                finally:
                    self.path = path

    def test_newer_review_or_revocation_corruption_never_looks_consistent(self):
        for sql, params in (
            ("INSERT INTO rehearsal_review_receipts VALUES (?,?,?,?,?,?)",
             (ORG, PROPOSAL, 4, DIGEST, "operator", OP)),
            ("INSERT INTO rehearsal_recipient_confirmation_revocations "
             "VALUES (?,?,?,?,?)", (ORG, PROPOSAL, 3, BUYER, WITHDRAW)),
        ):
            with self.subTest(sql=sql), tempfile.TemporaryDirectory() as folder:
                original = self.path
                self.path = Path(folder) / "mutated.sqlite3"
                try:
                    initialize_fixture_db(self.path)
                    self.reviewed_ready()
                    self.mutate(sql, params)
                    result = self.summary()
                    self.assertEqual(result["inconsistentPendingReservations"], 1)
                    self.assertEqual(result["pendingEvidenceState"],
                                     "inconsistent-needs-review")
                finally:
                    self.path = original

    def test_stop_contact_withdrawal_and_closure_detected_without_mutation(self):
        for sql, params in (
            ("INSERT INTO rehearsal_contact_signals VALUES (?,?,?)",
             (ORG, BUYER, "complained")),
            ("INSERT INTO rehearsal_consent_revocations VALUES (?,?,?)",
             (ORG, BUYER, WITHDRAW)),
            ("INSERT INTO rehearsal_deal_closures VALUES (?,?,?,?)",
             (ORG, PROPOSAL, EVENT, "won")),
        ):
            with self.subTest(sql=sql), tempfile.TemporaryDirectory() as folder:
                original = self.path
                self.path = Path(folder) / "mutated.sqlite3"
                try:
                    initialize_fixture_db(self.path)
                    self.assertEqual(self.reserve(), "reserved-simulation-only")
                    self.mutate(sql, params)
                    result = self.summary()
                    self.assertEqual(result["inconsistentPendingReservations"], 1)
                    self.assertEqual(result["pendingEvidenceState"],
                                     "inconsistent-needs-review")
                    self.assertEqual(result["pendingReservations"], 1)
                    self.assertEqual(self.summary(), result)  # never auto-repair
                finally:
                    self.path = original

    def test_uncertain_handoff_with_later_stop_is_not_corrupt_pending(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(mark_fictional_handoff_unknown(
            self.path, ORG, PROPOSAL, BUYER, key("one")),
            "outcome-unknown-simulation-only")
        record_fictional_contact_signal(self.path, ORG, PROPOSAL,
                                        BUYER, "opted_out")
        result = self.summary()
        self.assertEqual(result["unknownOutcomeHolds"], 1)
        self.assertEqual(result["inconsistentPendingReservations"], 0)
        self.assertEqual(result["pendingEvidenceState"],
                         "consistent-simulation-only")

    def test_inconsistent_pending_is_tenant_isolated(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(tenant=OTHER), "reserved-simulation-only")
        self.mutate("INSERT INTO rehearsal_contact_signals VALUES (?,?,?)",
                    (ORG, BUYER, "opted_out"))
        self.assertEqual(self.summary()["inconsistentPendingReservations"], 1)
        self.assertEqual(self.summary(OTHER)["inconsistentPendingReservations"], 0)
        self.assertNotIn(OTHER, json.dumps(self.summary()))

    def test_invalid_scope_and_path_rejected_before_any_report(self):
        for bad in (None, 42, True, "", "invalid", ORG.upper()):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                self.summary(bad)
        with self.assertRaises(ValueError):
            fictional_hold_summary(Path("/tmp/bidmason-uncreated.sqlite3"), ORG)
        self.assertEqual(self.summary()["pendingReservations"], 0)


if __name__ == "__main__":
    unittest.main()
