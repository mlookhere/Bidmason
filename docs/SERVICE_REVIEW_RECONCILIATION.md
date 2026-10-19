# Item 4 — Read-only service review reconciliation (nonpublic)

\`reconcileServiceReview()\` addresses **indeterminate** reviewed scope commits:
a database write may have succeeded before a lost response, revoked visibility,
or a later approved company policy update. The function never retries a write,
sends, bills, publishes or approves a proposal.

The caller submits the **original** revision-bound review request, not browser
modified candidate text or amounts. A trusted adapter performs fresh
authenticated, tenant-owned, primary/linearizable source and company-policy
reads. The reconciler checks the exact pre-commit source snapshot, stored
extraction audit, reviewer-identified decision, selected source indices and
explicit optional-add-on acknowledgements. It reconstructs the decision under
the original, verified **approved historical policy revision**, then checks
whether that exact policy/workbench binding is still current.

Outcomes:
- \`confirmed-current-at-read\`: the exact persisted review exists and the
  binding matches the active company policy at the end of the checks.
  This is **not** permission to publish/send; any downstream action must
  independently reauthorize and recheck the exact policy and evidence.
- \`recorded-stale-policy\`: the decision matches a former approved policy
  revision, but the active version changed. The record is not suitable for
  downstream publication; begin a new review under the current policy.
- \`unchanged-at-read\`: the source still has the original revision and no
  reviewed scope. This does **not** prove rollback or permit retry; a pending
  write can finish after the read.
- \`conflict\`: source, revision, original, decisions or persisted audit differ.
  Never accept the stored decision for the submitted request.

Loss of membership, missing source or absence of an approved policy throws.
The implementation does two source reads and two policy reads and detects
observable mid-read races, but separate stores cannot guarantee that no
policy change occurs immediately afterwards. A real proposal transition
must provide a **single protected database transaction** and explicit
approval/revision/signature gates across source, policy and proposal.

Pure SHA-256 and a stored reviewer UUID are consistency metadata, not an
authentication signature or proof that the reviewer originally had authority.
All underlying store adapters are hypothetical until Item 3's genuine
multi-user Supabase Auth/PostgREST/RLS/private Storage bytes and security
verification succeed. No live customer route or Storage/network operation
was added.
