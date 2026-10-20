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
