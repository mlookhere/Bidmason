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

## Canonical persisted evidence before recovery classification

A read-only reconciliation runs after a write outcome is uncertain; it
must never turn malformed server read-back into a verified scope. The
recovery adapter now verifies all returned root fields are own
enumerable data, checks the complete original/extraction candidate
source digests, and requires exactly one plain-data extraction audit
row **before** computing the original CAS fingerprint. When a scope
receipt exists, it must have exact plain fields, a dense non-decorated
selection and add-on array, and primitive revision/actor/digest values.

Malformed source or scope evidence is classified **conflict**, not
`confirmed-current-at-read` or `unchanged-at-read`, and cannot trigger
a pricing-policy lookup. The same checks run on the second authorized
primary read, so a malicious or stale later response cannot confirm an
earlier decision. Accessor-backed fields, custom serializers, holes,
symbols and hidden directives are rejected without executing getters.
The index-zero candidate validation probe is only evidence checking,
not approval. Additional regression cases cover malicious original,
audit, candidate and stored-scope records, including the second read.

A clean reconciliation is still *read-only*. Even an exact record and
policy fingerprint do not independently prove historic actor
authorization or permit quote publication. Live authenticated tenant
membership, source-owned PostgreSQL CAS and RLS/Storage, maintained
antivirus and separate human proposal approvals remain mandatory.
