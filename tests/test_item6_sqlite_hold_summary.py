"""Tenant-isolated redacted fictional Item 6 hold-summary regressions."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
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
    revoke_fictional_recipient_confirmation,
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

    def test_invalid_scope_and_path_rejected_before_any_report(self):
        for bad in (None, 42, True, "", "invalid", ORG.upper()):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                self.summary(bad)
        with self.assertRaises(ValueError):
            fictional_hold_summary(Path("/tmp/bidmason-uncreated.sqlite3"), ORG)
        self.assertEqual(self.summary()["pendingReservations"], 0)


if __name__ == "__main__":
    unittest.main()
