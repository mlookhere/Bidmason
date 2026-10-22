"""Fail-first checks: new fictional revisions must revoke old pending work.

No provider, delivery, live customer, or consent source is involved.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import tempfile
import unittest

from ci.item6_sqlite_rehearsal import (
    fictional_counts, fictional_unknown_count, initialize_fixture_db,
    mark_fictional_handoff_unknown, reserve_fictional,
)
from ci.item6_sqlite_review_gate import (
    record_fictional_consent, record_fictional_review, reserve_reviewed_fictional,
    record_fictional_recipient_confirmation,
)

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROPOSAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
OTHER_PROPOSAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
OPERATOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CONTRACTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff"
HASH_OLD = "a" * 64
HASH_NEW = "b" * 64
RECIPIENT = "buyer@fictional.example"
SECOND = "second@fictional.example"


def key(seed):
    return "dryrun_" + hashlib.sha256(seed.encode()).hexdigest()


class FictionalRevisionSupersessionTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "fictional.sqlite3"
        initialize_fixture_db(self.path)

    def review(self, revision, role, actor, proposal=PROPOSAL, tenant=ORG,
               content_hash=HASH_OLD):
        return record_fictional_review(self.path, tenant, proposal, revision,
                                       content_hash, role, actor)

    def consent(self, recipient=RECIPIENT, tenant=ORG):
        from uuid import uuid5, NAMESPACE_DNS
        event_id = str(uuid5(NAMESPACE_DNS, tenant + recipient))
        return record_fictional_consent(self.path, tenant, recipient, event_id)

    def confirm(self, revision, recipient=RECIPIENT, proposal=PROPOSAL,
                tenant=ORG, content_hash=HASH_OLD):
        from uuid import uuid5, NAMESPACE_DNS
        event = str(uuid5(NAMESPACE_DNS,
                          tenant + proposal + str(revision) + recipient))
        return record_fictional_recipient_confirmation(
            self.path, tenant, proposal, revision, content_hash, recipient,
            CONTRACTOR, event)

    def reserve(self, revision, recipient=RECIPIENT, seed="old", proposal=PROPOSAL,
                tenant=ORG, content_hash=HASH_OLD):
        return reserve_reviewed_fictional(self.path, tenant, proposal, revision,
                                          content_hash, recipient, key(seed))

    def ready_old(self, recipient=RECIPIENT):
        self.review(3, "operator", OPERATOR)
        self.review(3, "contractor", CONTRACTOR)
        self.consent(recipient)
        self.confirm(3, recipient)

    def test_new_partial_revision_invalidates_existing_pending_old_revision(self):
        self.ready_old()
        self.assertEqual(self.reserve(3), "reserved-simulation-only")
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))
        self.review(4, "operator", OPERATOR, content_hash=HASH_NEW)
        self.assertEqual(fictional_counts(self.path, ORG), (0, 1, 0))
        self.assertEqual(self.reserve(3, seed="late"), "blocked-stale-revision")
        self.assertEqual(mark_fictional_handoff_unknown(self.path, ORG, PROPOSAL,
                                                       RECIPIENT, key("old")),
                         "blocked-no-matching-reservation")

    def test_new_revision_invalidates_all_old_reviewed_recipients_not_unrelated(self):
        self.ready_old()
        self.consent(SECOND)
        self.confirm(3, SECOND)
        self.reserve(3)
        self.reserve(3, SECOND, "second")
        independent = reserve_fictional(self.path, ORG, OTHER_PROPOSAL,
                                        "independent@fictional.example", key("different"))
        self.assertEqual(independent, "reserved-simulation-only")
        self.review(4, "operator", OPERATOR, content_hash=HASH_NEW)
        self.assertEqual(fictional_counts(self.path, ORG), (1, 2, 0))

    def test_new_review_never_erases_unresolved_provider_handoff(self):
        self.ready_old()
        self.reserve(3)
        mark_fictional_handoff_unknown(self.path, ORG, PROPOSAL, RECIPIENT, key("old"))
        self.review(4, "operator", OPERATOR, content_hash=HASH_NEW)
        self.assertEqual(fictional_unknown_count(self.path, ORG), 1)
        self.assertEqual(fictional_counts(self.path, ORG), (0, 0, 0))
        self.review(4, "contractor", CONTRACTOR, content_hash=HASH_NEW)
        self.confirm(4, content_hash=HASH_NEW)
        self.assertEqual(self.reserve(4, seed="new", content_hash=HASH_NEW),
                         "blocked-existing-recipient-reservation")

    def test_ready_new_revision_can_reserve_with_new_identity_after_old_revoked(self):
        self.ready_old()
        self.reserve(3)
        self.review(4, "operator", OPERATOR, content_hash=HASH_NEW)
        self.review(4, "contractor", CONTRACTOR, content_hash=HASH_NEW)
        self.assertEqual(self.reserve(4, seed="new", content_hash=HASH_NEW),
                         "blocked-missing-recipient-confirmation")
        self.confirm(4, content_hash=HASH_NEW)
        self.assertEqual(self.reserve(4, seed="new", content_hash=HASH_NEW),
                         "reserved-simulation-only")
        self.assertEqual(fictional_counts(self.path, ORG), (1, 1, 0))
        with self.assertRaisesRegex(ValueError, "Conflicting fictional idempotency key"):
            self.reserve(4, seed="old", content_hash=HASH_NEW)

    def test_review_and_reservation_race_leaves_no_superseded_pending_lock(self):
        self.ready_old()
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(self.reserve, 3)
            b = pool.submit(self.review, 4, "operator", OPERATOR, PROPOSAL,
                            ORG, HASH_NEW)
            a.result()
            b.result()
        self.assertEqual(fictional_counts(self.path, ORG)[0], 0)
        self.assertEqual(self.reserve(3, seed="late"), "blocked-stale-revision")

    def test_other_tenant_or_proposal_review_never_invalidates_a_live_lock(self):
        self.ready_old()
        self.reserve(3)
        self.review(4, "operator", OPERATOR, proposal=OTHER_PROPOSAL,
                    content_hash=HASH_NEW)
        self.review(4, "operator", OPERATOR, tenant=OTHER_ORG,
                    content_hash=HASH_NEW)
        self.assertEqual(fictional_counts(self.path, ORG), (1, 0, 0))


if __name__ == "__main__":
    unittest.main()
