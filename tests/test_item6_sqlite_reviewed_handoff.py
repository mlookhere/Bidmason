"""Non-sending handoff preflight: a reservation does not itself approve handoff."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest

from ci.item6_sqlite_rehearsal import (
    close_fictional_deal, fictional_counts, fictional_unknown_count,
    initialize_fixture_db, mark_fictional_handoff_unknown,
    record_fictional_contact_signal, reserve_fictional,
)
from ci.item6_sqlite_review_gate import (
    mark_reviewed_fictional_handoff_unknown, record_fictional_review,
    record_fictional_consent, reserve_reviewed_fictional,
    record_fictional_recipient_confirmation,
    revoke_fictional_recipient_confirmation,
)

ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
PROP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
OP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
CON = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
CONSENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
CLOSE = '11111111-1111-4111-8111-111111111111'
RECIPIENT = 'buyer@fictional.example'
DIGEST = 'a' * 64
REV = 3
KEY = 'dryrun_' + hashlib.sha256(b'item6-handoff').hexdigest()


class ReviewedHandoffTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'handoff.sqlite3'
        initialize_fixture_db(self.path)

    def review(self, revision=REV, role='operator', digest=DIGEST):
        return record_fictional_review(self.path, ORG, PROP, revision, digest,
                                       role, OP if role == 'operator' else CON)

    def approved(self):
        self.review()
        self.review(role='contractor')
        record_fictional_consent(self.path, ORG, RECIPIENT, CONSENT)
        record_fictional_recipient_confirmation(
            self.path, ORG, PROP, REV, DIGEST, RECIPIENT, CON, CLOSE)

    def reserve(self):
        return reserve_reviewed_fictional(self.path, ORG, PROP, REV,
                                          DIGEST, RECIPIENT, KEY)

    def handoff(self, **changes):
        kw = dict(organization_id=ORG, proposal_id=PROP, revision=REV,
                  content_sha256=DIGEST, recipient=RECIPIENT, idempotency_key=KEY)
        kw.update(changes)
        return mark_reviewed_fictional_handoff_unknown(self.path, **kw)

    def test_no_prior_claim_cannot_enter_unknown(self):
        self.approved()
        self.assertEqual(self.handoff(), 'blocked-no-matching-reservation')
        self.assertEqual(fictional_unknown_count(self.path, ORG), 0)

    def test_raw_unreviewed_reservation_is_not_a_reviewed_handoff(self):
        self.approved()
        self.assertEqual(reserve_fictional(self.path, ORG, PROP, RECIPIENT, KEY),
                         'reserved-simulation-only')
        self.assertEqual(self.handoff(), 'blocked-unreviewed-reservation')
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))

    def test_valid_fabricated_evidence_is_one_way_uncertain_without_send(self):
        self.approved()
        self.assertEqual(self.reserve(), 'reserved-simulation-only')
        self.assertEqual(self.handoff(), 'outcome-unknown-simulation-only')
        self.assertEqual(self.handoff(), 'blocked-unknown-outcome-existing')
        self.assertEqual(fictional_unknown_count(self.path, ORG), 1)
        self.assertEqual(self.reserve(), 'blocked-existing-key')

    def test_legacy_unknown_handoff_cannot_bypass_strict_reviewed_reservation(self):
        self.approved()
        self.assertEqual(self.reserve(), 'reserved-simulation-only')
        self.assertEqual(
            mark_fictional_handoff_unknown(self.path, ORG, PROP, RECIPIENT, KEY),
            'blocked-reviewed-reservation-use-strict-handoff')
        self.assertEqual(fictional_unknown_count(self.path, ORG), 0)
        self.assertEqual(self.handoff(), 'outcome-unknown-simulation-only')

    def test_legacy_unknown_handoff_cannot_bypass_revoked_recipient_confirmation(self):
        self.approved()
        self.assertEqual(self.reserve(), 'reserved-simulation-only')
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('DELETE FROM rehearsal_recipient_confirmations')
            db.commit()
        self.assertEqual(
            mark_fictional_handoff_unknown(self.path, ORG, PROP, RECIPIENT, KEY),
            'blocked-reviewed-reservation-use-strict-handoff')
        self.assertEqual(self.handoff(), 'blocked-missing-recipient-confirmation')
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))
        self.assertEqual(fictional_unknown_count(self.path, ORG), 0)

    def test_revocation_after_unknown_handoff_preserves_reconciliation_hold(self):
        self.approved()
        self.assertEqual(self.reserve(), 'reserved-simulation-only')
        self.assertEqual(self.handoff(), 'outcome-unknown-simulation-only')
        self.assertEqual(
            revoke_fictional_recipient_confirmation(
                self.path, ORG, PROP, REV, RECIPIENT, CLOSE),
            'fictional-confirmation-revoked')
        self.assertEqual(fictional_unknown_count(self.path, ORG), 1)
        self.assertEqual(self.handoff(), 'blocked-unknown-outcome-existing')
        self.assertEqual(self.reserve(), 'blocked-recipient-confirmation-revoked')

    def test_revision_hash_tenant_proposal_recipient_and_key_are_immutable(self):
        self.approved()
        self.reserve()
        for field, bad in [('revision', 4), ('content_sha256', 'b'*64),
                           ('organization_id', OTHER), ('proposal_id', OTHER),
                           ('recipient', 'second@fictional.example'),
                           ('idempotency_key', 'dryrun_' + 'c'*64)]:
            with self.subTest(field=field):
                try:
                    verdict = self.handoff(**{field: bad})
                except ValueError:
                    continue  # Conflicting claim identity is a hard failure.
                self.assertNotEqual(verdict, 'outcome-unknown-simulation-only')
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))
        self.assertEqual(fictional_unknown_count(self.path, ORG), 0)

    def test_removed_review_or_consent_fails_closed_before_handoff(self):
        for mutation, expected in [
            ("DELETE FROM rehearsal_review_receipts WHERE role='contractor'",
             'blocked-missing-independent-reviews'),
            ('DELETE FROM rehearsal_consent_confirmations',
             'blocked-unconfirmed-consent'),
            ('DELETE FROM rehearsal_recipient_confirmations',
             'blocked-missing-recipient-confirmation'),
            ("UPDATE rehearsal_review_receipts SET content_sha256='" + 'b'*64 +
             "' WHERE role='contractor'", 'blocked-review-content-mismatch'),
        ]:
            with self.subTest(mutation=mutation):
                with tempfile.TemporaryDirectory() as temp:
                    self.path = Path(temp) / 'mutation.sqlite3'
                    initialize_fixture_db(self.path)
                    self.approved()
                    self.reserve()
                    with closing(sqlite3.connect(self.path)) as db:
                        db.execute(mutation)
                        db.commit()
                    self.assertEqual(self.handoff(), expected)
                    self.assertEqual(fictional_unknown_count(self.path, ORG), 0)

    def test_newer_review_invalidates_prior_pending_claim_and_blocks_handoff(self):
        self.approved()
        self.reserve()
        self.review(revision=REV+1)
        self.assertEqual(self.handoff(), 'blocked-no-matching-reservation')
        self.assertEqual(fictional_counts(self.path, ORG), (0, 1, 0))

    def test_stop_contact_and_closure_win_at_handoff_boundary(self):
        for event in ('stop', 'close'):
            with self.subTest(event=event):
                with tempfile.TemporaryDirectory() as temp:
                    self.path = Path(temp) / 'stop.sqlite3'
                    initialize_fixture_db(self.path)
                    self.approved()
                    self.reserve()
                    if event == 'stop':
                        record_fictional_contact_signal(self.path, ORG, PROP, RECIPIENT,
                                                        'opted_out')
                    else:
                        close_fictional_deal(self.path, ORG, PROP, RECIPIENT,
                                             CLOSE, 'won')
                    self.assertNotEqual(self.handoff(), 'outcome-unknown-simulation-only')
                    self.assertEqual(fictional_unknown_count(self.path, ORG), 0)

    def test_race_with_new_revision_keeps_no_pending_stale_reservation(self):
        for iteration in range(12):
            with tempfile.TemporaryDirectory() as temp:
                self.path = Path(temp) / 'race.sqlite3'
                initialize_fixture_db(self.path)
                self.approved()
                self.reserve()
                with ThreadPoolExecutor(max_workers=2) as pool:
                    a = pool.submit(self.handoff)
                    b = pool.submit(self.review, REV+1)
                    a.result()
                    b.result()
                self.assertEqual(fictional_counts(self.path, ORG)[0], 0)
                self.assertLessEqual(fictional_unknown_count(self.path, ORG), 1)
                self.assertNotEqual(self.reserve(), 'reserved-simulation-only')


if __name__ == '__main__':
    unittest.main()
