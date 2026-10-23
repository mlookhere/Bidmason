"""Adversarial, credential-free SQLite rehearsal of future dispatch transaction rules."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest

from ci.item6_sqlite_rehearsal import (
    close_fictional_deal, fictional_counts, initialize_fixture_db,
    record_fictional_contact_signal, reserve_fictional,
)
from ci.item6_release_evidence import evaluate, load

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROPOSAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
DIFFERENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
RECIPIENT = "buyer@fictional.example"
EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"


def key(seed: str) -> str:
    return "dryrun_" + hashlib.sha256(seed.encode()).hexdigest()


class OfflineSqliteRehearsalTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "fictional.sqlite3"
        initialize_fixture_db(self.path)

    def reserve(self, organization=ORG, proposal=PROPOSAL, recipient=RECIPIENT, seed="A"):
        return reserve_fictional(self.path, organization, proposal, recipient, key(seed))

    def test_fixture_database_must_be_in_temporary_directory(self):
        with self.assertRaises(ValueError):
            initialize_fixture_db(Path.cwd() / "must-not-create.sqlite3")
        with self.assertRaises(ValueError):
            initialize_fixture_db(Path("relative.sqlite3"))

    def test_new_fixture_rejects_accidental_reinitialization(self):
        with self.assertRaises(ValueError):
            initialize_fixture_db(self.path)
        self.assertEqual(fictional_counts(self.path, ORG), (0, 0, 0))

    def test_reservation_is_durable_across_new_connections_and_exact_replay(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(), "blocked-existing-key")
        self.assertEqual(self.reserve(seed="new"), "blocked-existing-recipient-reservation")
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))

    def test_simultaneous_independent_connections_admit_one_recipient_winner(self):
        with ThreadPoolExecutor(max_workers=16) as pool:
            verdicts = list(pool.map(lambda i: self.reserve(seed=str(i)), range(24)))
        self.assertEqual(verdicts.count("reserved-simulation-only"), 1)
        self.assertEqual(verdicts.count("blocked-existing-recipient-reservation"), 23)
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))

    def test_same_recipient_different_proposal_is_not_a_second_winner(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(proposal=DIFFERENT, seed="B"),
                         "blocked-existing-recipient-reservation")

    def test_tenant_and_recipient_are_independent(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(organization=OTHER), "reserved-simulation-only")
        self.assertEqual(self.reserve(recipient="other@fictional.example", seed="C"),
                         "reserved-simulation-only")
        self.assertEqual(fictional_counts(self.path, ORG), (2, 0, 0))
        self.assertEqual(fictional_counts(self.path, OTHER), (1, 0, 0))

    def test_reply_invalidates_lock_and_blocks_other_proposals(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(record_fictional_contact_signal(self.path, ORG, PROPOSAL,
                                                         RECIPIENT, "replied"), 1)
        self.assertEqual(self.reserve(proposal=DIFFERENT, seed="B"), "blocked-contact-hold")
        self.assertEqual(fictional_counts(self.path, ORG), (0, 1, 1))

    def test_all_sticky_signals_revoke_and_never_unsuppress(self):
        for kind in ("opted_out", "bounced", "complained", "replied"):
            with self.subTest(kind=kind):
                with tempfile.TemporaryDirectory() as directory:
                    db = Path(directory) / "test.sqlite3"
                    initialize_fixture_db(db)
                    self.assertEqual(reserve_fictional(db, ORG, PROPOSAL, RECIPIENT,
                                                        key(kind)), "reserved-simulation-only")
                    self.assertEqual(record_fictional_contact_signal(db, ORG, PROPOSAL,
                                                                     RECIPIENT, kind), 1)
                    self.assertEqual(record_fictional_contact_signal(db, ORG, PROPOSAL,
                                                                     RECIPIENT, kind), 0)
                    self.assertEqual(reserve_fictional(db, ORG, DIFFERENT, RECIPIENT,
                                                        key(kind + "-later")), "blocked-contact-hold")
                    self.assertEqual(fictional_counts(db, ORG), (0, 1, 1))

    def test_distinct_signals_are_append_only_and_tenant_scoped(self):
        record_fictional_contact_signal(self.path, ORG, PROPOSAL, RECIPIENT, "replied")
        record_fictional_contact_signal(self.path, ORG, PROPOSAL, RECIPIENT, "opted_out")
        self.assertEqual(fictional_counts(self.path, ORG), (0, 0, 2))
        self.assertEqual(self.reserve(organization=OTHER), "reserved-simulation-only")
        self.assertEqual(self.reserve(seed="second"), "blocked-contact-hold")

    def test_closed_deal_invalidates_all_recipients_but_not_other_proposals(self):
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(self.reserve(recipient="second@fictional.example", seed="B"),
                         "reserved-simulation-only")
        self.assertEqual(self.reserve(proposal=DIFFERENT, recipient="third@fictional.example", seed="C"),
                         "reserved-simulation-only")
        self.assertEqual(close_fictional_deal(self.path, ORG, PROPOSAL, RECIPIENT, EVENT, "won"),
                         ("closed-simulation-only", 2))
        self.assertEqual(fictional_counts(self.path, ORG), (1, 2, 0))
        self.assertEqual(self.reserve(recipient="new@fictional.example", seed="D"),
                         "blocked-closed-deal")
        self.assertEqual(self.reserve(proposal=DIFFERENT, recipient=RECIPIENT, seed="E"),
                         "reserved-simulation-only")

    def test_terminal_claim_replay_is_idempotent_conflict_rejected(self):
        self.assertEqual(close_fictional_deal(self.path, ORG, PROPOSAL, RECIPIENT, EVENT, "lost"),
                         ("closed-simulation-only", 0))
        self.assertEqual(close_fictional_deal(self.path, ORG, PROPOSAL, RECIPIENT, EVENT, "lost"),
                         ("blocked-duplicate-deal-closure", 0))
        with self.assertRaisesRegex(ValueError, "Conflicting fictional terminal"):
            close_fictional_deal(self.path, ORG, PROPOSAL, RECIPIENT, EVENT, "won")
        self.assertEqual(self.reserve(), "blocked-closed-deal")

    def test_racing_stop_and_reserve_final_state_is_always_blocked(self):
        for index in range(12):
            with tempfile.TemporaryDirectory() as directory:
                db = Path(directory) / "race.sqlite3"
                initialize_fixture_db(db)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    a = pool.submit(reserve_fictional, db, ORG, PROPOSAL, RECIPIENT, key(str(index)))
                    b = pool.submit(record_fictional_contact_signal, db, ORG, PROPOSAL,
                                    RECIPIENT, "opted_out")
                    a.result()
                    b.result()
                self.assertEqual(fictional_counts(db, ORG)[0], 0)
                self.assertEqual(reserve_fictional(db, ORG, DIFFERENT, RECIPIENT,
                                                    key(str(index) + "late")), "blocked-contact-hold")

    def test_racing_closure_and_reserve_cannot_leave_live_same_deal(self):
        for index in range(12):
            with tempfile.TemporaryDirectory() as directory:
                db = Path(directory) / "race.sqlite3"
                initialize_fixture_db(db)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    a = pool.submit(reserve_fictional, db, ORG, PROPOSAL, RECIPIENT, key(str(index)))
                    b = pool.submit(close_fictional_deal, db, ORG, PROPOSAL, RECIPIENT, EVENT, "lost")
                    a.result()
                    b.result()
                self.assertEqual(fictional_counts(db, ORG)[0], 0)
                self.assertEqual(reserve_fictional(db, ORG, PROPOSAL, "new@fictional.example",
                                                    key(str(index) + "late")), "blocked-closed-deal")

    def test_rollback_is_atomic_after_uncommitted_write(self):
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO rehearsal_contact_signals VALUES (?,?,?)",
                       (ORG, RECIPIENT, "bounced"))
            db.execute("ROLLBACK")
        self.assertEqual(self.reserve(), "reserved-simulation-only")
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))

    def test_invalid_real_recipient_and_unsafe_claims_do_not_mutate(self):
        for address in ("real@example.com", "buyer@gmail.com", "mixed@Example.COM", "\u200b@fictional.example"):
            with self.subTest(address=address), self.assertRaises(ValueError):
                self.reserve(recipient=address)
        with self.assertRaises(ValueError):
            reserve_fictional(self.path, ORG, PROPOSAL,
                              RECIPIENT, "not-a-dryrun-key")
        with self.assertRaises(ValueError):
            record_fictional_contact_signal(self.path, ORG, PROPOSAL, RECIPIENT, "clear")
        with self.assertRaises(ValueError):
            close_fictional_deal(self.path, ORG, PROPOSAL, RECIPIENT, EVENT, "reopen")
        self.assertEqual(fictional_counts(self.path, ORG), (0, 0, 0))

    def test_synthetic_database_cannot_satisfy_release_evidence(self):
        state = evaluate(load())
        self.assertEqual(state["state"], "blocked")
        self.assertIs(state["releaseAuthorized"], False)
        self.assertEqual(state["required"], 13)


if __name__ == "__main__":
    unittest.main()
