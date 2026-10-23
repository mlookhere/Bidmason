"""Offline lost-acknowledgment recovery tests; NEVER sends any message."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from ci.item6_sqlite_rehearsal import (
    close_fictional_deal, fictional_counts, fictional_unknown_count,
    initialize_fixture_db, mark_fictional_handoff_unknown,
    record_fictional_contact_signal, reserve_fictional,
)

from ci.item6_sqlite_review_gate import (
    record_fictional_consent, revoke_fictional_consent,
)
from ci.item6_sqlite_hold_summary import fictional_hold_summary

ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PROPOSAL="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
DIFFERENT="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
RECIPIENT="buyer@fictional.example"
EVENT="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

def key(seed):
    return "dryrun_" + hashlib.sha256(seed.encode()).hexdigest()

class OfflineUncertainHandoffTests(unittest.TestCase):
    def setUp(self):
        directory=tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path=Path(directory.name)/"fictional.sqlite3"
        initialize_fixture_db(self.path)

    def reserve(self, seed="main", org=ORG, proposal=PROPOSAL, recipient=RECIPIENT):
        return reserve_fictional(self.path,org,proposal,recipient,key(seed))

    def unknown(self, seed="main", org=ORG, proposal=PROPOSAL, recipient=RECIPIENT):
        return mark_fictional_handoff_unknown(self.path,org,proposal,recipient,key(seed))

    def test_unknown_requires_existing_exact_reserved_fictional_claim(self):
        self.assertEqual(self.unknown(),"blocked-no-matching-reservation")
        self.assertEqual(self.reserve(),"reserved-simulation-only")
        for change in [dict(seed="wrong"),dict(recipient="another@fictional.example"),
                       dict(proposal=DIFFERENT),dict(org=OTHER)]:
            self.assertEqual(self.unknown(**change),"blocked-no-matching-reservation")
        self.assertEqual(fictional_counts(self.path,ORG),(1,0,0))
        self.assertEqual(fictional_unknown_count(self.path,ORG),0)
        self.assertEqual(self.unknown(),"outcome-unknown-simulation-only")
        self.assertEqual(self.unknown(),"blocked-unknown-outcome-existing")
        self.assertEqual(fictional_counts(self.path,ORG),(0,0,0))
        self.assertEqual(fictional_unknown_count(self.path,ORG),1)

    def test_restart_and_replay_do_not_allow_another_same_recipient_reservation(self):
        self.assertEqual(self.reserve(),"reserved-simulation-only")
        self.assertEqual(self.unknown(),"outcome-unknown-simulation-only")
        self.assertEqual(self.reserve(seed="new"),"blocked-existing-recipient-reservation")
        self.assertEqual(self.reserve(seed="new",proposal=DIFFERENT),"blocked-existing-recipient-reservation")
        self.assertEqual(self.reserve(),"blocked-existing-key")
        script=("from pathlib import Path; from ci.item6_sqlite_rehearsal import "
                "fictional_unknown_count, reserve_fictional; "
                "db=Path(__import__('sys').argv[1]); "
                "assert fictional_unknown_count(db,__import__('sys').argv[2]) == 1; "
                "assert reserve_fictional(db,*__import__('sys').argv[2:6]) == "
                "'blocked-existing-key'")
        environment=dict(os.environ)
        environment["PYTHONPATH"]=str(Path(__file__).resolve().parents[1])
        result=subprocess.run([sys.executable,"-c",script,str(self.path),ORG,PROPOSAL,RECIPIENT,key("main")],
                              cwd=Path(__file__).resolve().parents[1],env=environment,
                              capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(fictional_unknown_count(self.path,ORG),1)

    def test_late_reply_and_optout_cannot_claim_uncertain_external_side_effect_was_not_sent(self):
        self.reserve()
        self.unknown()
        self.assertEqual(record_fictional_contact_signal(self.path,ORG,PROPOSAL,RECIPIENT,"replied"),0)
        self.assertEqual(record_fictional_contact_signal(self.path,ORG,DIFFERENT,RECIPIENT,"opted_out"),0)
        self.assertEqual(fictional_unknown_count(self.path,ORG),1)
        self.assertEqual(self.reserve(seed="new"),"blocked-contact-hold")
        self.assertEqual(fictional_counts(self.path,ORG),(0,0,2))

    def test_closed_deal_keeps_uncertain_handoff_for_human_reconciliation(self):
        self.reserve()
        self.unknown()
        self.assertEqual(close_fictional_deal(self.path,ORG,PROPOSAL,RECIPIENT,EVENT,"won"),
                         ("closed-simulation-only",0))
        self.assertEqual(fictional_unknown_count(self.path,ORG),1)
        self.assertEqual(self.reserve(seed="new",recipient="other@fictional.example"),"blocked-closed-deal")
        self.assertEqual(self.reserve(seed="otherdeal",proposal=DIFFERENT),"blocked-existing-recipient-reservation")
        self.assertEqual(self.reserve(seed="separate",proposal=DIFFERENT,recipient="different@fictional.example"),
                         "reserved-simulation-only")

    def test_concurrent_handoffs_mark_once_without_writing_provider_result(self):
        self.reserve()
        with ThreadPoolExecutor(max_workers=12) as pool:
            verdicts=list(pool.map(lambda _:self.unknown(),range(22)))
        self.assertEqual(verdicts.count("outcome-unknown-simulation-only"),1)
        self.assertEqual(verdicts.count("blocked-unknown-outcome-existing"),21)
        self.assertEqual(fictional_unknown_count(self.path,ORG),1)
        self.assertEqual(fictional_counts(self.path,ORG),(0,0,0))

    def test_concurrent_closure_or_suppression_with_uncertain_handoff_cannot_reopen(self):
        for signal in ("close","stop"):
            for order in range(10):
                with tempfile.TemporaryDirectory() as directory:
                    path=Path(directory)/"race.sqlite3"
                    initialize_fixture_db(path)
                    reserve_fictional(path,ORG,PROPOSAL,RECIPIENT,key("race"))
                    def a():
                        return mark_fictional_handoff_unknown(path,ORG,PROPOSAL,RECIPIENT,key("race"))
                    def b():
                        return (close_fictional_deal(path,ORG,PROPOSAL,RECIPIENT,EVENT,"lost")
                                if signal=="close" else
                                record_fictional_contact_signal(path,ORG,PROPOSAL,RECIPIENT,"complained"))
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        first=pool.submit(a if order%2 else b)
                        second=pool.submit(b if order%2 else a)
                        first.result()
                        second.result()
                    self.assertEqual(fictional_counts(path,ORG)[0],0)
                    self.assertEqual(reserve_fictional(path,ORG,PROPOSAL,RECIPIENT,key("retry")),
                                     "blocked-closed-deal" if signal=="close" else "blocked-contact-hold")
                    self.assertLessEqual(fictional_unknown_count(path,ORG),1)

    def test_crash_before_commit_keeps_prior_reservation_and_allows_only_one_later_hold(self):
        self.reserve()
        # A distinct process writes the new state but exits with no COMMIT:
        # SQLite must roll back when that process dies; it must not invent an outcome.
        script="import sqlite3,sys,os; c=sqlite3.connect(sys.argv[1],isolation_level=None); " \
               "c.execute('BEGIN IMMEDIATE'); " \
               "c.execute(\"UPDATE rehearsal_reservations SET state='outcome_unknown'\"); os._exit(0)"
        result=subprocess.run([sys.executable,"-c",script,str(self.path)],
                              capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0)
        self.assertEqual(fictional_counts(self.path,ORG),(1,0,0))
        self.assertEqual(fictional_unknown_count(self.path,ORG),0)
        self.assertEqual(self.unknown(),"outcome-unknown-simulation-only")
        self.assertEqual(fictional_unknown_count(self.path,ORG),1)

    def test_withdrawn_consent_cancels_raw_reserved_handoff_without_ambiguity(self):
        self.assertEqual(record_fictional_consent(self.path,ORG,RECIPIENT,EVENT),
                         "fictional-consent-recorded")
        self.assertEqual(self.reserve(),"reserved-simulation-only")
        self.assertEqual(revoke_fictional_consent(
            self.path,ORG,RECIPIENT,"11111111-1111-4111-8111-111111111111"),
            "fictional-consent-withdrawn")
        self.assertEqual(self.unknown(),"blocked-no-matching-reservation")
        self.assertEqual(fictional_counts(self.path,ORG),(0,1,0))
        self.assertEqual(fictional_unknown_count(self.path,ORG),0)

    def test_restored_corrupt_raw_claim_still_cannot_handoff_after_withdrawal(self):
        record_fictional_consent(self.path,ORG,RECIPIENT,EVENT)
        self.reserve()
        revoke_fictional_consent(
            self.path,ORG,RECIPIENT,"11111111-1111-4111-8111-111111111111")
        # Deliberately bypass application transitions in the CI-only SQLite
        # fixture: the handoff must independently enforce the sticky hold.
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("UPDATE rehearsal_reservations SET state='reserved' "
                       "WHERE organization_id=? AND recipient=?",
                       (ORG,RECIPIENT))
            db.commit()
        self.assertEqual(self.unknown(),"blocked-consent-withdrawn")
        self.assertEqual(fictional_unknown_count(self.path,ORG),0)
        self.assertEqual(fictional_counts(self.path,ORG),(1,0,0))
        audit=fictional_hold_summary(self.path,ORG)
        self.assertEqual(audit["inconsistentPendingReservations"],1)
        self.assertEqual(audit["pendingEvidenceState"],"inconsistent-needs-review")
        self.assertIs(audit["contactAuthorized"],False)

    def test_withdrawal_is_tenant_scoped_at_legacy_handoff_boundary(self):
        record_fictional_consent(self.path,ORG,RECIPIENT,EVENT)
        self.reserve()
        self.assertEqual(self.reserve(seed="other",org=OTHER),"reserved-simulation-only")
        revoke_fictional_consent(
            self.path,ORG,RECIPIENT,"11111111-1111-4111-8111-111111111111")
        self.assertEqual(self.unknown(),"blocked-no-matching-reservation")
        self.assertEqual(self.unknown(seed="other",org=OTHER),
                         "outcome-unknown-simulation-only")
        self.assertEqual(fictional_unknown_count(self.path,ORG),0)
        self.assertEqual(fictional_unknown_count(self.path,OTHER),1)

    def test_withdrawal_races_raw_handoff_without_reopening_reserved_work(self):
        for _ in range(8):
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/"race-withdrawal.sqlite3"
                initialize_fixture_db(path)
                record_fictional_consent(path,ORG,RECIPIENT,EVENT)
                reserve_fictional(path,ORG,PROPOSAL,RECIPIENT,key("race"))
                with ThreadPoolExecutor(max_workers=2) as pool:
                    a=pool.submit(mark_fictional_handoff_unknown,path,
                                  ORG,PROPOSAL,RECIPIENT,key("race"))
                    b=pool.submit(revoke_fictional_consent,path,ORG,RECIPIENT,
                                  "11111111-1111-4111-8111-111111111111")
                    result=a.result()
                    self.assertEqual(b.result(),"fictional-consent-withdrawn")
                self.assertIn(result,("outcome-unknown-simulation-only",
                                      "blocked-no-matching-reservation"))
                self.assertEqual(fictional_counts(path,ORG)[0],0)
                self.assertLessEqual(fictional_unknown_count(path,ORG),1)
                self.assertEqual(reserve_fictional(
                    path,ORG,PROPOSAL,RECIPIENT,key("retry")),
                    "blocked-consent-withdrawn")

    def test_tenant_scope_ambiguous_holds_never_block_other_tenants(self):
        self.reserve()
        self.unknown()
        self.assertEqual(self.reserve(seed="other",org=OTHER),"reserved-simulation-only")
        self.assertEqual(fictional_unknown_count(self.path,ORG),1)
        self.assertEqual(fictional_unknown_count(self.path,OTHER),0)

if __name__=="__main__":
    unittest.main()
