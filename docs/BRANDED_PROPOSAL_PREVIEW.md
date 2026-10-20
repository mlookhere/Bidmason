# Item 5 — Reusable branded proposal preview (synthetic only)

This first isolated Item 5 slice implements **one** ReportLab-based presentation renderer and mandatory negative/positive QA for two distinct fictional company brands. It uses already-priced integer cents; it does not price commercial work, verify tenant membership, prove credentials, secure approvals, or send customer documents.

`scripts/render_branded_proposal_pdf.py` accepts only `synthetic-branded-proposal-preview` and a `SYN-` reference. Strict exact-field validation prohibits hidden approval, signature, notes, remote logos or otherwise unsupported directives. Company brand text and palette, title, scope, completion standards, price lines, assumptions, exclusions and timeline are input-configured. It verifies line extensions and subtotal/tax/total reconciliation **without claiming policy approval**. The output displays `SYNTHETIC INTERNAL DRAFT - NOT FOR DELIVERY` on every page, and acceptance is disabled.

Run `python3 -m pip install -r requirements-pdf.txt && python3 ci/branded_pdf_qa.py`. The required `proposal-pdf-qa` Actions job renders painting and cleaning examples, checks extracted sections, page geometry, rasterization and banners, and executes 28 negative cases. The earlier historical Harbor Coast renderer is unchanged.

**Remaining:** This renderer must not be wired to live customer input until Items 3 and 4 authorization/revision approval are accepted. Then implement an independently reviewed exact-source/ratecard-bound adapter, real logo asset scanning, evidence-backed credential claims, full `passed/failed/not_run` QA, operator/contractor hash-bound approvals and revision invalidation, high-volume pagination tests, and security/legal/operations signoff. The synthetic snapshot is neither a quotation nor a commercial signature.

## Revision-bound internal QA and reviewer receipt consistency

`lib/proposal-revision-qa.ts` records five required QA checks:
`pricing`, `scope`, `claims`, `recipient`, `pdf-layout`.
Any omitted check is explicitly `not_run` and blocks internal consistency;
a `failed` check also blocks. Only checks with a nonempty verified evidence
SHA can be `passed`. The canonical report SHA binds organization, proposal,
revision, source SHA, approved policy SHA, content SHA, and all five check
results. Duplicate or accessor-backed checks and mutated reports are rejected.

The *pure* receipt checker requires distinct operator and contractor actor
IDs and matching report/content/policy/source/revision SHA fingerprints.
Changes invalidate earlier receipts. Its positive state is **only**
`consistent-internal-only`, never a proposal approval or delivery right.
These typed structs are not independently authenticated or transactionally
persisted. A real tenant-authorized server writer, independent actor evidence,
immutable event history and exact-revision CAS must precede any commercial
approval or send. No live route is enabled.

## Atomic PDF publication and full-length regression

The fixture renderer writes into a random, private, same-directory temporary PDF;
only a **fully built** artifact can be published through an exclusive hard link.
Preexisting outputs (including symlink destinations) are refused instead of
silently replaced; build errors remove the temporary file and leave no partial
output. Unique per-revision filenames are still required upstream, and this
file operation alone is not authorized document storage or approval.

Required `proposal-pdf-qa` additionally tests interrupted ReportLab builds,
existing-output/symlink denial, temporary-file cleanup, and a synthetic
five-page worst-schema-size document (20 scope rows, 30 prices, 12 assumptions,
12 exclusions), checking **all** page bounds/footer markings, split-table
headers, and every expected item. The original small-fixture 4-page bound and
all 28 rejection tests remain unchanged. A separate real-customer accessible
PDF review is still deferred under H11.

## Synthetic artifact integrity (no approval authority)

`scripts/proposal_artifact_integrity.py` calculates a deterministic SHA-256 of
validated canonical synthetic snapshot JSON and a separate SHA-256 of the exact
rendered PDF bytes, together with the reference, explicit revision, byte count,
and page count. Verification re-opens the PDF, checks visible reference, company,
recipient, grand total and every-page synthetic warning, then checks all manifest
fields. A stale revision, substituted company, altered input/price, modified PDF,
or extra approval flag fails closed. The required `proposal-pdf-qa` executes
positive and adversarial tests for this manifest on both fictional companies.

**Security boundary:** SHA-256 hashes detect mismatches only when their expected
manifest is already trusted. They are **not signatures**, independently verified
source/provenance, authorization, or proof that pricing was owner approved. An
attacker able to replace the snapshot, PDF and manifest together can forge a
consistent set. No live tenant records, customer routes, signoff, or outbound
permission are introduced. Future real approval must bind authenticated actors
and an immutable server-owned artifact revision via the Item 3/4 authority
model and real-environment H01-H13 evidence.

## Internal QA to synthetic artifact fingerprint consistency

`evaluateSyntheticArtifactQaConsistency` in `lib/proposal-revision-qa.ts`
connects the **separately verified** Python integrity manifest to the internal
five-check QA report and two synthetic review receipts. It requires the exact
revision, the PDF's SHA-256 as the `pdf-layout` check evidence, and the
canonical synthetic snapshot SHA-256 as the report's `contentSha256`.
The report independently continues binding the source and policy hashes,
organization/proposal identifiers, and separate role/actor receipts.
Missing/failed/not-run checks, old receipts, wrong content/revision, malformed
manifests, added publication flags, hidden properties and getter-backed digests
all fail closed. The positive result is **`consistent-internal-only`**.

The Python manifest verifier **must independently check the actual PDF bytes**
against a trusted manifest before this consistency assessment. TypeScript's
pure assessment never opens a PDF, validates a tenant, checks an external
signature, authenticates a reviewer, or proves a company approved pricing.
The Python canonical JSON SHA uses sorted keys and compact separators; any
future authenticated adapter must explicitly maintain this digest contract
rather than assuming a different proposal serialization is equivalent.
The product still has **no release, publication, signature, or send path**.
Real approvals/storage remain blocked by H01–H13.

## Reject hidden PDF interactions before manifest creation

The synthetic integrity verifier now **fails closed even when a new manifest
could be computed** for a modified PDF containing external links, annotations,
embedded files, forms, PDF catalog or page actions, or outlines. Such hidden
content is unnecessary in the internal proposal previews and could otherwise
conceal instructions, personal information, attachments or scripts without
changing the visible proposal totals or warnings. This is defense in depth,
not a replacement for malware scanning or authorized source handling.

The existing mandatory `proposal-pdf-qa` explicitly injects six distinct
interactive payload classes into a valid fictional proposal and proves each
is refused during new-manifest creation. All previous math, pagination,
atomic publication, and fingerprint regression checks remain intact.
Real branded interactive PDFs would require a separately reviewed policy;
no live document or delivery path is enabled here.

## Required cross-runtime PDF to QA conformance

The mandatory `proposal-pdf-qa` job generates three real, private, synthetic
ReportLab PDFs and Python-verified manifests (fictional painting, cleaning,
and a painting fixture with accented characters). It passes the raw PDF files
and manifests to Node 24. Node independently hashes the PDF bytes and
reconstructs Python's sorted, compact, ASCII-escaped JSON SHA-256; then it
tests `buildProposalQaReport` and
`evaluateSyntheticArtifactQaConsistency` with two distinct fictional
reviewer receipts. Tampered PDFs, cross-company manifests, changed recipients,
stale revisions, and incomplete reviewer evidence are rejected.

This is an actual Python-to-TypeScript **data contract test**, not a set of
hand-authored mock digests. Files exist only in a disposable job directory
and are removed even on failure. It does not authenticate people or grant
the synthetic artifact permission to be sent or published. The existing
PDF assertions and H01–H13 release constraints remain mandatory.

The cross-runtime contract test is deliberately located at
`ci/proposal_artifact_contract.test.mjs`, **outside** the standalone
`tests-web/*.test.mjs` glob. It is executed in the mandatory
`proposal-pdf-qa` job only after Python creates and verifies its real PDF
artifacts. No tests are skipped or ignored; the general web and Windows jobs
retain all their original assertions without a Python/PDF dependency.


## Offline, read-only proposal QA workbench

A new **usable offline HTML review report** is generated from the verified
fictional painting, cleaning and accented-name PDF fixtures. It is deliberately
not served by Next.js, does not accept customer data, and provides no routes,
forms, approval buttons or outbound actions. To regenerate in a private
disposable directory, run Python `ci/proposal_contract_export.py <directory>`
followed by Node `ci/export_synthetic_review.mjs <directory> <directory>`.

Reports display the company/recipient, scope, itemized fictional pricing,
assumptions and exclusions, file and snapshot digests, and a five-check QA
table. **Four checks explicitly remain NOT RUN** until independently authorized
company policy, source, claims and recipient review exist. Only synthetic
PDF-byte fingerprint consistency is marked PASSED. The report prominently
states BLOCKED and NOT FOR DELIVERY; it never fabricates source, reviewer
receipts or approval status.

The mandatory `proposal-pdf-qa` Actions job now generates and inspects these
three HTML reports in its auto-cleaned temporary directory. Standalone web
unit tests verify HTML escaping for untrusted text, stale/swapped artifact
rejection, non-indexability and absence of active controls. A Python HTML
parser separately validates each real generated report. Production access,
independent reviewer authentication, real accessible PDF acceptance and
release readiness remain deferred under H01-H13.
