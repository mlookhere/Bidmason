"""Reject accidental/non-rehearsal SQLite targets and creation races."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from ci.item6_sqlite_rehearsal import (
    initialize_fixture_db, reserve_fictional, fictional_counts,
    mark_fictional_handoff_unknown,
)

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PROPOSAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ADDRESS = "recipient@fictional.example"
KEY = "dryrun_" + "d" * 64


class FixtureIdentityTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def test_unrelated_sqlite_file_is_rejected_without_mutation(self):
        outside = self.root / "unrelated.sqlite3"
        with closing(sqlite3.connect(outside)) as db:
            db.execute("CREATE TABLE unrelated (value TEXT NOT NULL)")
            db.execute("INSERT INTO unrelated VALUES ('keep')")
            db.commit()
        with self.assertRaisesRegex(ValueError, "rehearsal fixture"):
            reserve_fictional(outside, ORG, PROPOSAL, ADDRESS, KEY)
        with self.assertRaisesRegex(ValueError, "rehearsal fixture"):
            fictional_counts(outside, ORG)
        with closing(sqlite3.connect(outside)) as db:
            self.assertEqual(db.execute("SELECT value FROM unrelated").fetchall(), [("keep",)])
            self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("unrelated",)])

    def test_similar_schema_without_rehearsal_marker_is_not_trusted(self):
        foreign = self.root / "foreign.sqlite3"
        with closing(sqlite3.connect(foreign)) as db:
            db.execute("CREATE TABLE rehearsal_reservations (organization_id TEXT, idempotency_key TEXT, proposal_id TEXT, recipient TEXT, state TEXT)")
            db.commit()
        with self.assertRaisesRegex(ValueError, "rehearsal fixture"):
            reserve_fictional(foreign, ORG, PROPOSAL, ADDRESS, KEY)
        with closing(sqlite3.connect(foreign)) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM rehearsal_reservations").fetchone()[0], 0)

    def test_exclusive_initialization_is_safe_against_parallel_owners(self):
        path = self.root / "contended.sqlite3"
        def initialize(_):
            try:
                initialize_fixture_db(path)
                return "created"
            except ValueError:
                return "blocked"
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(initialize, range(12)))
        self.assertEqual(results.count("created"), 1)
        self.assertEqual(results.count("blocked"), 11)
        self.assertEqual(reserve_fictional(path, ORG, PROPOSAL, ADDRESS, KEY), "reserved-simulation-only")

    def test_authenticated_fixture_marker_survives_new_connections_and_uncertain_state(self):
        path = self.root / "good.sqlite3"
        initialize_fixture_db(path)
        with closing(sqlite3.connect(path)) as db:
            row = db.execute("SELECT schema_tag FROM rehearsal_fixture_identity").fetchone()
            self.assertEqual(row, ("bidmason:fictional-item6-sqlite:v1",))
        self.assertEqual(reserve_fictional(path, ORG, PROPOSAL, ADDRESS, KEY), "reserved-simulation-only")
        self.assertEqual(mark_fictional_handoff_unknown(path, ORG, PROPOSAL, ADDRESS, KEY), "outcome-unknown-simulation-only")
        self.assertEqual(fictional_counts(path, ORG), (0, 0, 0))

    def test_clearing_fixture_marker_fails_closed_even_for_existing_reservation(self):
        path = self.root / "altered.sqlite3"
        initialize_fixture_db(path)
        with closing(sqlite3.connect(path)) as db:
            db.execute("DELETE FROM rehearsal_fixture_identity")
            db.commit()
        with self.assertRaisesRegex(ValueError, "rehearsal fixture"):
            reserve_fictional(path, ORG, PROPOSAL, ADDRESS, KEY)


if __name__ == "__main__":
    unittest.main()
