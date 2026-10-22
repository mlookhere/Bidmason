"""Cross-ledger, tenant-scoped event identity for invented Item 6 evidence.

Every operation below is a disposable local SQLite rehearsal. The UUID is
not a verified external provider identity or proof of customer consent.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from uuid import NAMESPACE_DNS, uuid5

from ci.item6_sqlite_rehearsal import (
    close_fictional_deal, initialize_fixture_db, fictional_counts,
)
from ci.item6_sqlite_review_gate import (
    record_fictional_consent, revoke_fictional_consent,
    record_fictional_review, record_fictional_recipient_confirmation,
    revoke_fictional_recipient_confirmation,
)

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROPOSAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
RECIPIENT = "buyer@fictional.example"
SECOND = "another@fictional.example"
OP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
CON = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
DIGEST = "a" * 64


def event(name: str) -> str:
    return str(uuid5(NAMESPACE_DNS, "bidmason-item6-event-identity/" + name))


class FictionalEventIdentityNamespaceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "event-identity.sqlite3"
        initialize_fixture_db(self.path)

    def consent(self, recipient=RECIPIENT, identity="consent", org=ORG):
        return record_fictional_consent(
            self.path, org, recipient, event(identity))

    def reviewed(self, recipient=RECIPIENT, approval="approval", org=ORG):
        record_fictional_review(self.path, org, PROPOSAL, 3, DIGEST, "operator", OP)
        record_fictional_review(self.path, org, PROPOSAL, 3, DIGEST, "contractor", CON)
        self.consent(recipient, "consent-" + recipient, org)
        return record_fictional_recipient_confirmation(
            self.path, org, PROPOSAL, 3, DIGEST, recipient, CON, event(approval))

    def test_consent_event_cannot_impersonate_a_deal_closure(self):
        self.assertEqual(self.consent(), "fictional-consent-recorded")
        with self.assertRaisesRegex(ValueError, "across ledgers"):
            close_fictional_deal(
                self.path, ORG, PROPOSAL, RECIPIENT, event("consent"), "won")
        self.assertEqual(fictional_counts(self.path, ORG), (0, 0, 0))
        self.assertEqual(close_fictional_deal(
            self.path, ORG, PROPOSAL, RECIPIENT, event("closure"), "won"),
            ("closed-simulation-only", 0))

    def test_recipient_approval_cannot_reuse_fictional_consent_event(self):
        record_fictional_review(self.path, ORG, PROPOSAL, 3, DIGEST, "operator", OP)
        record_fictional_review(self.path, ORG, PROPOSAL, 3, DIGEST, "contractor", CON)
        self.consent()
        with self.assertRaisesRegex(ValueError, "across ledgers"):
            record_fictional_recipient_confirmation(
                self.path, ORG, PROPOSAL, 3, DIGEST, RECIPIENT, CON, event("consent"))
        self.assertEqual(record_fictional_recipient_confirmation(
            self.path, ORG, PROPOSAL, 3, DIGEST, RECIPIENT, CON, event("approval")),
            "fictional-recipient-confirmed")

    def test_revocation_event_cannot_reuse_other_kind(self):
        self.assertEqual(self.reviewed(), "fictional-recipient-confirmed")
        self.assertEqual(revoke_fictional_recipient_confirmation(
            self.path, ORG, PROPOSAL, 3, RECIPIENT, event("revoke")),
            "fictional-confirmation-revoked")
        with self.assertRaisesRegex(ValueError, "across ledgers"):
            close_fictional_deal(
                self.path, ORG, PROPOSAL, RECIPIENT, event("revoke"), "lost")
        self.assertEqual(close_fictional_deal(
            self.path, ORG, PROPOSAL, RECIPIENT, event("closure"), "lost"),
            ("closed-simulation-only", 0))

    def test_consent_withdrawal_event_cannot_impersonate_revocation(self):
        self.reviewed(RECIPIENT, "first-approval")
        self.assertEqual(revoke_fictional_consent(
            self.path, ORG, RECIPIENT, event("withdraw")),
            "fictional-consent-withdrawn")
        self.assertEqual(self.reviewed(SECOND, "second-approval"),
                         "fictional-recipient-confirmed")
        with self.assertRaisesRegex(ValueError, "across ledgers"):
            revoke_fictional_recipient_confirmation(
                self.path, ORG, PROPOSAL, 3, SECOND, event("withdraw"))
        self.assertEqual(revoke_fictional_recipient_confirmation(
            self.path, ORG, PROPOSAL, 3, SECOND, event("second-revoke")),
            "fictional-confirmation-revoked")

    def test_closure_event_cannot_reuse_other_recipient_consent(self):
        self.assertEqual(close_fictional_deal(
            self.path, ORG, PROPOSAL, RECIPIENT, event("closure"), "won"),
            ("closed-simulation-only", 0))
        with self.assertRaisesRegex(ValueError, "across ledgers"):
            self.consent(SECOND, "closure")
        self.assertEqual(self.consent(SECOND, "fresh-consent"),
                         "fictional-consent-recorded")

    def test_same_uuid_is_independent_across_tenants_and_replays_idempotently(self):
        self.assertEqual(self.consent(), "fictional-consent-recorded")
        self.assertEqual(self.consent(), "blocked-duplicate-consent")
        self.assertEqual(close_fictional_deal(
            self.path, OTHER, PROPOSAL, RECIPIENT, event("consent"), "won"),
            ("closed-simulation-only", 0))
        self.assertEqual(self.consent(RECIPIENT, "consent", OTHER),
                         "fictional-consent-recorded")
        self.assertEqual(self.consent(), "blocked-duplicate-consent")
        self.assertEqual(self.consent(SECOND, "second-consent"), "fictional-consent-recorded")

    def test_competing_different_event_kinds_commit_at_most_one_winner(self):
        # Each independent connection acquires the same BEGIN IMMEDIATE lock;
        # replay into the other event family can never claim the same UUID.
        for _ in range(8):
            with tempfile.TemporaryDirectory() as folder:
                db = Path(folder) / "race.sqlite3"
                initialize_fixture_db(db)
                same = event("competing")
                with ThreadPoolExecutor(max_workers=2) as pool:
                    future1 = pool.submit(record_fictional_consent, db, ORG, RECIPIENT, same)
                    future2 = pool.submit(
                        close_fictional_deal, db, ORG, PROPOSAL, RECIPIENT, same, "lost")
                    outcomes = []
                    for future in (future1, future2):
                        try:
                            outcomes.append(future.result())
                        except ValueError as exc:
                            self.assertIn("across ledgers", str(exc))
                            outcomes.append("conflict")
                self.assertEqual(outcomes.count("conflict"), 1)
                self.assertEqual(len(outcomes), 2)
                self.assertEqual(fictional_counts(db, ORG), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()
