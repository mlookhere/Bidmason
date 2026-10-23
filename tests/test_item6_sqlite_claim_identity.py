"""Fail-closed fictional key and CRM event identity, with no real provider."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import tempfile
import unittest

from ci.item6_sqlite_rehearsal import (
    close_fictional_deal, fictional_counts, fictional_unknown_count,
    initialize_fixture_db, mark_fictional_handoff_unknown,
    record_fictional_contact_signal, reserve_fictional,
)

ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
FIRST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
SECOND = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
BUYER = 'buyer@fictional.example'
ANOTHER = 'other@fictional.example'
EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
EVENT2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

def key(seed):
    return 'dryrun_' + hashlib.sha256(seed.encode()).hexdigest()

class ImmutableClaimIdentityTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = Path(tmp.name) / 'identity.sqlite3'
        initialize_fixture_db(self.db)

    def reserve(self, proposal=FIRST, recipient=BUYER, claim=None, org=ORG):
        return reserve_fictional(self.db, org, proposal, recipient, claim or key('one'))

    def test_idempotency_key_same_claim_replay_remains_blocked_duplicate(self):
        self.assertEqual(self.reserve(), 'reserved-simulation-only')
        self.assertEqual(self.reserve(), 'blocked-existing-key')
        self.assertEqual(fictional_counts(self.db, ORG), (1, 0, 0))

    def test_one_key_cannot_be_reused_for_different_proposal_or_recipient(self):
        self.reserve()
        for proposal, recipient in [(SECOND, BUYER), (FIRST, ANOTHER), (SECOND, ANOTHER)]:
            with self.subTest(proposal=proposal, recipient=recipient):
                with self.assertRaisesRegex(ValueError, 'Conflicting fictional idempotency key'):
                    self.reserve(proposal=proposal, recipient=recipient)
        self.assertEqual(fictional_counts(self.db, ORG), (1, 0, 0))

    def test_conflicting_key_stays_conflicting_after_suppression_or_unknown_handoff(self):
        self.reserve()
        self.assertEqual(mark_fictional_handoff_unknown(self.db, ORG, FIRST, BUYER, key('one')),
                         'outcome-unknown-simulation-only')
        with self.assertRaisesRegex(ValueError, 'Conflicting fictional idempotency key'):
            self.reserve(proposal=SECOND)
        self.assertEqual(fictional_unknown_count(self.db, ORG), 1)
        record_fictional_contact_signal(self.db, ORG, FIRST, BUYER, 'opted_out')
        with self.assertRaisesRegex(ValueError, 'Conflicting fictional idempotency key'):
            self.reserve(recipient=ANOTHER)
        self.assertEqual(fictional_unknown_count(self.db, ORG), 1)

    def test_claim_id_collision_across_tenants_is_validly_isolated(self):
        self.assertEqual(self.reserve(), 'reserved-simulation-only')
        self.assertEqual(self.reserve(proposal=SECOND, recipient=ANOTHER, org=OTHER),
                         'reserved-simulation-only')
        self.assertEqual(fictional_counts(self.db, ORG), (1, 0, 0))
        self.assertEqual(fictional_counts(self.db, OTHER), (1, 0, 0))

    def test_terminal_event_id_cannot_be_reused_to_close_another_proposal(self):
        self.assertEqual(close_fictional_deal(self.db, ORG, FIRST, BUYER, EVENT, 'won'),
                         ('closed-simulation-only', 0))
        with self.assertRaisesRegex(ValueError, 'Conflicting fictional terminal event ID'):
            close_fictional_deal(self.db, ORG, SECOND, ANOTHER, EVENT, 'won')
        # Rejected second claim must not have committed a closure.
        self.assertEqual(self.reserve(proposal=SECOND, recipient=ANOTHER, claim=key('second')),
                         'reserved-simulation-only')
        self.assertEqual(close_fictional_deal(self.db, ORG, SECOND, ANOTHER, EVENT2, 'lost'),
                         ('closed-simulation-only', 1))

    def test_concurrent_event_id_collision_has_one_winner(self):
        def close(proposal):
            try:
                close_fictional_deal(self.db, ORG, proposal, BUYER, EVENT, 'won')
                return 'won'
            except ValueError as exc:
                self.assertIn('Conflicting fictional terminal event ID', str(exc))
                return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(close, [FIRST, SECOND]))
        self.assertCountEqual(results, ['won', 'conflict'])

    def test_terminal_event_id_same_across_tenants_is_scoped(self):
        for tenant in (ORG, OTHER):
            self.assertEqual(close_fictional_deal(self.db, tenant, FIRST, BUYER, EVENT, 'won'),
                             ('closed-simulation-only', 0))
        self.assertEqual(self.reserve(proposal=SECOND, recipient=ANOTHER, claim=key('other')),
                         'reserved-simulation-only')

if __name__ == '__main__':
    unittest.main()
