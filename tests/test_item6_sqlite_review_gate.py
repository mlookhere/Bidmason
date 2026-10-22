"""Independent fictional dual-review and consent simulation; no sending."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import tempfile
import unittest
from uuid import uuid5, NAMESPACE_DNS

from ci.item6_sqlite_rehearsal import (
    initialize_fixture_db, fictional_counts, record_fictional_contact_signal,
    close_fictional_deal, fictional_unknown_count,
)
from ci.item6_sqlite_review_gate import (
    record_fictional_review, record_fictional_consent, reserve_reviewed_fictional,
    record_fictional_recipient_confirmation,
    revoke_fictional_recipient_confirmation, revoke_fictional_consent,
)

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROPOSAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_PROPOSAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
OPERATOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CONTRACTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff"
RECIPIENT = "buyer@fictional.example"
HASH = "a" * 64
OTHER_HASH = "b" * 64
CONSENT_EVENT = "11111111-1111-4111-8111-111111111111"
DEAL_EVENT = "22222222-2222-4222-8222-222222222222"

def key(seed):
    return "dryrun_" + hashlib.sha256(seed.encode()).hexdigest()

class FictionalReviewedReservationTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = Path(tmp.name) / "review.sqlite3"
        initialize_fixture_db(self.db)

    def review(self, role, actor, revision=3, digest=HASH, org=ORG, proposal=PROPOSAL):
        return record_fictional_review(self.db, org, proposal, revision,
                                       digest, role, actor)

    def consent(self, recipient=RECIPIENT, event=CONSENT_EVENT, org=ORG):
        return record_fictional_consent(self.db, org, recipient, event)

    def confirm(self, recipient=RECIPIENT, revision=3, digest=HASH,
                actor=CONTRACTOR, org=ORG, proposal=PROPOSAL, seed="confirm",
                event=None):
        event = event or str(uuid5(NAMESPACE_DNS,
                                   f"{org}/{proposal}/{revision}/{recipient}/{seed}"))
        return record_fictional_recipient_confirmation(
            self.db, org, proposal, revision, digest, recipient, actor, event)

    def reserve(self, revision=3, digest=HASH, recipient=RECIPIENT, seed="one",
                org=ORG, proposal=PROPOSAL):
        return reserve_reviewed_fictional(self.db, org, proposal, revision,
                                           digest, recipient, key(seed))

    def both(self):
        self.review("operator", OPERATOR)
        self.review("contractor", CONTRACTOR)

    def test_no_reservation_without_independent_reviews_or_consent(self):
        self.assertEqual(self.reserve(), "blocked-missing-independent-reviews")
        self.review("operator", OPERATOR)
        self.assertEqual(self.reserve(), "blocked-missing-independent-reviews")
        self.review("contractor", CONTRACTOR)
        self.assertEqual(self.reserve(), "blocked-unconfirmed-consent")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 0, 0))

    def test_exact_two_reviewers_and_fictional_consent_permit_only_local_reservation(self):
        self.both()
        self.assertEqual(self.consent(), "fictional-consent-recorded")
        self.assertEqual(self.reserve(), "blocked-missing-recipient-confirmation")
        self.assertEqual(self.confirm(), "fictional-recipient-confirmed")
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(), "blocked-existing-key")
        self.assertEqual(self.reserve(seed="two"), "blocked-existing-recipient-reservation")
        self.assertEqual(fictional_counts(self.db, ORG), (1, 0, 0))

    def test_one_actor_cannot_approve_both_roles_and_conflicting_replay_rejected(self):
        self.review("operator", OPERATOR)
        with self.assertRaisesRegex(ValueError, "both roles"):
            self.review("contractor", OPERATOR)
        self.assertEqual(self.review("operator", OPERATOR), "blocked-duplicate-review")
        with self.assertRaisesRegex(ValueError, "Conflicting fictional review"):
            self.review("operator", CONTRACTOR)
        self.assertEqual(self.reserve(), "blocked-missing-independent-reviews")

    def test_exact_content_digest_binds_both_receipts(self):
        self.review("operator", OPERATOR, digest=HASH)
        with self.assertRaisesRegex(ValueError, "Conflicting fictional revision content"):
            self.review("contractor", CONTRACTOR, digest=OTHER_HASH)
        self.consent()
        self.assertEqual(self.reserve(), "blocked-missing-independent-reviews")
        self.review("contractor", CONTRACTOR, digest=HASH)
        self.assertEqual(self.reserve(digest=OTHER_HASH), "blocked-review-content-mismatch")
        self.confirm()
        self.assertEqual(self.reserve(), "reserved-simulation-only")

    def test_newer_partial_review_rejects_late_old_revision_receipts(self):
        self.review("operator", OPERATOR, revision=4)
        self.assertEqual(self.review("operator", OPERATOR, revision=3), "blocked-stale-review")
        self.assertEqual(self.review("contractor", CONTRACTOR, revision=3), "blocked-stale-review")
        self.assertEqual(self.reserve(revision=3), "blocked-stale-revision")
        self.review("contractor", CONTRACTOR, revision=4)
        self.consent()
        self.confirm(revision=4)
        self.assertEqual(self.reserve(revision=4), "reserved-simulation-only")

    def test_competing_distinct_hash_receipts_cannot_both_commit(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.review, "operator", OPERATOR, 3, HASH)
            second = pool.submit(self.review, "contractor", CONTRACTOR, 3, OTHER_HASH)
            outcomes = []
            for future in (first, second):
                try:
                    outcomes.append(future.result())
                except ValueError as exc:
                    outcomes.append(str(exc))
        self.assertCountEqual(
            outcomes,
            ["fictional-review-recorded", "Conflicting fictional revision content"],
        )
        self.consent()
        self.assertEqual(self.reserve(), "blocked-missing-independent-reviews")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 0, 0))

    def test_newer_partially_reviewed_revision_freezes_prior_version(self):
        self.both()
        self.consent()
        self.confirm()
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.review("operator", OPERATOR, revision=4)
        self.assertEqual(self.reserve(seed="new"), "blocked-stale-revision")
        self.assertEqual(self.reserve(revision=4, seed="new"), "blocked-missing-independent-reviews")
        self.review("contractor", CONTRACTOR, revision=4)
        # The first newer review atomically invalidated the older unsent lock.
        # The complete new review can reserve, but never send.
        self.assertEqual(fictional_counts(self.db, ORG), (0, 1, 0))
        self.assertEqual(self.reserve(revision=4, seed="new"), "blocked-missing-recipient-confirmation")
        self.confirm(revision=4)
        self.assertEqual(self.reserve(revision=4, seed="new"), "reserved-simulation-only")

    def test_fake_consent_event_identity_and_stop_contact(self):
        self.both()
        self.assertEqual(self.consent(), "fictional-consent-recorded")
        self.confirm()
        self.assertEqual(self.consent(), "blocked-duplicate-consent")
        with self.assertRaisesRegex(ValueError, "Conflicting fictional consent"):
            self.consent(event=DEAL_EVENT)
        with self.assertRaisesRegex(ValueError, "Conflicting fictional consent event ID"):
            self.consent(recipient="second@fictional.example")
        self.assertEqual(record_fictional_contact_signal(self.db, ORG, PROPOSAL,
                                                         RECIPIENT, "opted_out"), 0)
        self.assertEqual(self.consent(), "blocked-contact-hold")
        self.assertEqual(self.reserve(), "blocked-contact-hold")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 0, 1))

    def test_closed_deal_always_blocks_and_cannot_create_review_after_close(self):
        self.both()
        self.consent()
        self.confirm()
        self.assertEqual(close_fictional_deal(self.db, ORG, PROPOSAL, RECIPIENT,
                                               DEAL_EVENT, "won"), ("closed-simulation-only", 0))
        self.assertEqual(self.reserve(), "blocked-closed-deal")
        self.assertEqual(self.review("operator", OPERATOR, revision=4), "blocked-closed-deal")

    def test_tenant_and_proposal_scopes_are_distinct(self):
        self.both()
        self.consent()
        self.confirm()
        self.assertEqual(self.reserve(org=OTHER), "blocked-missing-independent-reviews")
        self.assertEqual(self.reserve(proposal=OTHER_PROPOSAL), "blocked-missing-independent-reviews")
        self.assertEqual(self.reserve(recipient="other@fictional.example"), "blocked-unconfirmed-consent")
        self.assertEqual(self.reserve(), "reserved-simulation-only")

    def test_stop_signal_racing_reviewed_reservation_cannot_leave_live_work(self):
        self.both()
        self.consent()
        self.confirm()
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(self.reserve)
            b = pool.submit(record_fictional_contact_signal, self.db, ORG, PROPOSAL,
                            RECIPIENT, "complained")
            a.result()
            b.result()
        self.assertEqual(fictional_counts(self.db, ORG)[0], 0)
        self.assertEqual(self.reserve(seed="another"), "blocked-contact-hold")

    def test_terminal_deal_racing_reviewed_reservation_cannot_leave_live_work(self):
        self.both()
        self.consent()
        self.confirm()
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(self.reserve)
            b = pool.submit(close_fictional_deal, self.db, ORG, PROPOSAL,
                            RECIPIENT, DEAL_EVENT, "lost")
            a.result()
            b.result()
        self.assertEqual(fictional_counts(self.db, ORG)[0], 0)
        self.assertEqual(self.reserve(seed="retry"), "blocked-closed-deal")

    def test_recipient_confirmation_requires_matching_contractor_and_consent(self):
        self.both()
        self.assertEqual(self.confirm(), "blocked-unconfirmed-consent")
        self.consent()
        self.assertEqual(
            self.confirm(actor=OPERATOR), "blocked-contractor-review-required")
        self.assertEqual(
            self.confirm(digest=OTHER_HASH), "blocked-contractor-review-required")
        self.assertEqual(self.confirm(), "fictional-recipient-confirmed")
        self.assertEqual(self.confirm(), "blocked-duplicate-recipient-confirmation")
        with self.assertRaisesRegex(ValueError, "Conflicting fictional recipient confirmation"):
            self.confirm(seed="replayed-different")
        self.assertEqual(self.reserve(), "reserved-simulation-only")

    def test_recipient_confirmation_is_not_shared_across_proposals_or_revisions(self):
        self.both()
        self.consent()
        self.confirm()
        self.review("operator", OPERATOR, proposal=OTHER_PROPOSAL)
        self.review("contractor", CONTRACTOR, proposal=OTHER_PROPOSAL)
        self.assertEqual(
            self.reserve(proposal=OTHER_PROPOSAL, seed="second-proposal"),
            "blocked-missing-recipient-confirmation")
        self.review("operator", OPERATOR, revision=4)
        self.review("contractor", CONTRACTOR, revision=4)
        self.assertEqual(
            self.reserve(revision=4, seed="new-revision"),
            "blocked-missing-recipient-confirmation")
        self.assertEqual(
            self.confirm(revision=3), "blocked-stale-revision")
        self.confirm(revision=4)
        self.assertEqual(
            self.reserve(revision=4, seed="new-revision"),
            "reserved-simulation-only")

    def test_recipient_confirmation_event_cannot_cross_recipient_or_tenant(self):
        self.both()
        self.consent()
        self.confirm()
        self.consent(recipient="other@fictional.example", event=DEAL_EVENT)
        original_event = str(uuid5(
            NAMESPACE_DNS, f"{ORG}/{PROPOSAL}/3/{RECIPIENT}/confirm"))
        with self.assertRaisesRegex(ValueError, "Conflicting fictional recipient event ID"):
            self.confirm(recipient="other@fictional.example", event=original_event)
        self.assertEqual(
            self.reserve(recipient="other@fictional.example", seed="other"),
            "blocked-missing-recipient-confirmation")
        self.assertEqual(
            self.reserve(org=OTHER), "blocked-missing-independent-reviews")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 0, 0))

    def test_stop_contact_refuses_new_recipient_confirmation(self):
        self.both()
        self.consent()
        record_fictional_contact_signal(
            self.db, ORG, PROPOSAL, RECIPIENT, "opted_out")
        self.assertEqual(self.confirm(), "blocked-contact-hold")
        self.assertEqual(self.reserve(), "blocked-contact-hold")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 0, 1))

    def revoke(self, recipient=RECIPIENT, revision=3, proposal=PROPOSAL,
               org=ORG, event=DEAL_EVENT):
        return revoke_fictional_recipient_confirmation(
            self.db, org, proposal, revision, recipient, event)

    def test_revocation_invalidates_pending_reviewed_claim_and_is_sticky(self):
        self.both()
        self.consent()
        self.confirm()
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.revoke(), "fictional-confirmation-revoked")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 1, 0))
        self.assertEqual(self.reserve(seed="after-revoke"),
                         "blocked-recipient-confirmation-revoked")
        self.assertEqual(self.confirm(), "blocked-recipient-confirmation-revoked")
        self.assertEqual(self.revoke(), "blocked-duplicate-confirmation-revocation")
        with self.assertRaisesRegex(ValueError, "Conflicting fictional confirmation revocation"):
            self.revoke(event=CONSENT_EVENT)

    def test_revocation_does_not_affect_another_fictional_recipient(self):
        second = "second@fictional.example"
        self.both()
        self.consent()
        self.consent(recipient=second, event=DEAL_EVENT)
        self.confirm()
        self.confirm(recipient=second)
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(recipient=second, seed="second"),
                         "reserved-simulation-only")
        self.assertEqual(self.revoke(event=CONSENT_EVENT), "fictional-confirmation-revoked")
        self.assertEqual(fictional_counts(self.db, ORG), (1, 1, 0))
        self.assertEqual(self.reserve(recipient=second, seed="other-key"),
                         "blocked-existing-recipient-reservation")

    def test_revocation_requires_exact_existing_confirmation_and_unique_event(self):
        self.assertEqual(self.revoke(), "blocked-no-matching-recipient-confirmation")
        self.both()
        self.consent()
        self.confirm()
        self.assertEqual(self.revoke(), "fictional-confirmation-revoked")
        self.consent(recipient="second@fictional.example", event=DEAL_EVENT)
        self.confirm(recipient="second@fictional.example")
        with self.assertRaisesRegex(ValueError, "Conflicting fictional revocation event ID"):
            self.revoke(recipient="second@fictional.example")
        self.assertEqual(self.revoke(recipient="second@fictional.example",
                                     event=CONSENT_EVENT),
                         "fictional-confirmation-revoked")

    def test_revocation_racing_reservation_never_leaves_pending_work(self):
        self.both()
        self.consent()
        self.confirm()
        with ThreadPoolExecutor(max_workers=2) as pool:
            reservation = pool.submit(self.reserve)
            revocation = pool.submit(self.revoke)
            reservation.result()
            self.assertEqual(revocation.result(), "fictional-confirmation-revoked")
        self.assertEqual(fictional_counts(self.db, ORG)[0], 0)
        self.assertEqual(self.reserve(seed="retry"),
                         "blocked-recipient-confirmation-revoked")

    def withdraw_consent(self, recipient=RECIPIENT, event=DEAL_EVENT, org=ORG):
        return revoke_fictional_consent(self.db, org, recipient, event)

    def test_withdrawal_of_consent_invalidates_pending_reviewed_work(self):
        self.both()
        self.consent()
        self.confirm()
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.withdraw_consent(), "fictional-consent-withdrawn")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 1, 0))
        self.assertEqual(self.reserve(seed="later"), "blocked-consent-withdrawn")
        self.assertEqual(self.confirm(seed="new-confirm"), "blocked-consent-withdrawn")
        self.assertEqual(self.consent(), "blocked-consent-withdrawn")
        self.assertEqual(self.withdraw_consent(), "blocked-duplicate-consent-withdrawal")

    def test_consent_withdrawal_does_not_equal_permanent_opt_out(self):
        self.both()
        self.consent()
        self.confirm()
        self.assertEqual(self.withdraw_consent(), "fictional-consent-withdrawn")
        self.assertEqual(self.reserve(), "blocked-consent-withdrawn")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 0, 0))
        # A distinct explicit contact opt-out still has higher precedence.
        self.assertEqual(record_fictional_contact_signal(
            self.db, ORG, PROPOSAL, RECIPIENT, "opted_out"), 0)
        self.assertEqual(self.reserve(seed="after-stop"), "blocked-contact-hold")

    def test_withdrawn_consent_blocks_a_separately_reviewed_proposal(self):
        self.both()
        self.consent()
        self.confirm()
        self.review("operator", OPERATOR, proposal=OTHER_PROPOSAL)
        self.review("contractor", CONTRACTOR, proposal=OTHER_PROPOSAL)
        self.confirm(proposal=OTHER_PROPOSAL)
        self.assertEqual(self.withdraw_consent(), "fictional-consent-withdrawn")
        self.assertEqual(
            self.reserve(proposal=OTHER_PROPOSAL, seed="new-proposal"),
            "blocked-consent-withdrawn")

    def test_consent_withdrawal_replay_event_identity_and_scope(self):
        second = "second@fictional.example"
        self.assertEqual(self.withdraw_consent(), "blocked-no-existing-consent")
        self.consent()
        self.consent(recipient=second, event=DEAL_EVENT)
        self.assertEqual(self.withdraw_consent(), "fictional-consent-withdrawn")
        self.assertEqual(self.withdraw_consent(), "blocked-duplicate-consent-withdrawal")
        with self.assertRaisesRegex(ValueError, "Conflicting fictional consent withdrawal"):
            self.withdraw_consent(event=CONSENT_EVENT)
        with self.assertRaisesRegex(ValueError, "Conflicting fictional consent withdrawal event ID"):
            self.withdraw_consent(recipient=second, event=DEAL_EVENT)
        self.assertEqual(
            self.withdraw_consent(recipient=second, event=CONSENT_EVENT),
            "fictional-consent-withdrawn")
        self.assertEqual(
            self.withdraw_consent(recipient=second, org=OTHER),
            "blocked-no-existing-consent")

    def test_consent_withdrawal_racing_reviewed_reservation_blocks_work(self):
        self.both()
        self.consent()
        self.confirm()
        with ThreadPoolExecutor(max_workers=2) as pool:
            reserve = pool.submit(self.reserve)
            withdrawal = pool.submit(self.withdraw_consent)
            reserve.result()
            self.assertEqual(withdrawal.result(), "fictional-consent-withdrawn")
        self.assertEqual(fictional_counts(self.db, ORG)[0], 0)
        self.assertEqual(self.reserve(seed="retry"), "blocked-consent-withdrawn")

    def test_invalid_revision_digest_actor_or_real_recipient_rejected(self):
        for revision in (0, -1, True, 1.25, 1000001):
            with self.subTest(revision=revision), self.assertRaises(ValueError):
                self.reserve(revision=revision)
        for digest in ("A"*64, "bad", "\u200b" + HASH):
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                self.reserve(digest=digest)
        with self.assertRaises(ValueError):
            self.review("operator", "bad")
        with self.assertRaises(ValueError):
            self.review("unknown", OPERATOR)
        with self.assertRaises(ValueError):
            self.consent(recipient="real@gmail.com")
        self.assertEqual(fictional_counts(self.db, ORG), (0, 0, 0))

if __name__ == "__main__":
    unittest.main()
