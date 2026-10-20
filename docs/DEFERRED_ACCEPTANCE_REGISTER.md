# BidMason — Deferred Acceptance and Human Review Register

**Updated:** 2026-10-19 (America/Los_Angeles)
**Source of truth:** [Master Plan](MASTER_PLAN.md), existing GitHub Issues [#4](https://github.com/mlookhere/Bidmason/issues/4), [#5](https://github.com/mlookhere/Bidmason/issues/5), [#6](https://github.com/mlookhere/Bidmason/issues/6), and [control #1](https://github.com/mlookhere/Bidmason/issues/1).

## Interpretation

`deferred` means **not verified, not waived**. CI on disposable PostgreSQL
or synthetic PDFs can pass while these items remain blocking for deployment.
Never use missing, skipped, queued, or red checks as success. No company quote,
customer upload, live contact form, publish, signature, delivery, or billing
is authorized by this record. Do not put tokens, user emails or any customer
data in an Issue, PR, screenshot, or test artifact.

## Deferred items — owner/operator provides evidence later

| ID | Dependency | Human decision or real-environment validation | Acceptance evidence | State |
| --- | --- | --- | --- | --- |
| H01 | Item 3 | Authorize target Supabase project, staging/production separation, staff roles, deployment scope | Approved project IDs, responsibility owner and least-privilege access review without secrets | deferred |
| H02 | Item 3 | Two distinct real Supabase Auth users from independent tenant memberships | Repeatable PostgREST positive and negative RLS tests with each real identity, cross-tenant denied, independent actors verified | deferred |
| H03 | Item 3 | Original source uploads to private Storage with restricted reads and revocation | Signed internal test report for owner-only retrieval, expired/revoked membership, foreign tenant, and object path tampering | deferred |
| H04 | Items 3–4 | Production/staging session revocation, SQL function permissions, tenant CAS locks and migration approval | Separate-user session signout/revocation, no service-role bypass, rollback/recovery test and reviewed migrations | deferred |
| H05 | Item 4 | Maintained malware scanning for documents/audio, file limits and quarantine | Actual scanner integration with vendor/support lifecycle, malicious fixtures denied and scanner outage fails closed | deferred |
| H06 | Item 4 | Source consent, transcription provider/retention and AI processing constraints | Approved provider/region, encryption/retention/deletion workflow, consent and data-flow review | deferred |
| H07 | Item 4 | Each company's owned pricing policy, optional addons, taxes and independent approving actor | Versioned authorized signed-off ratecard and distinct operator approval; no universal customer rates | deferred |
| H08 | Item 4 | Harbor Coast synthetic quarterly contradiction remains unresolved | Keep pending/unquotable; real owner decision only if an actual job requests that service | deferred |
| H09 | Item 5 | Approve real contractor brand/logo, templates, terms, date windows and factual claims | Licensed asset use, company review of all public text, evidence-backed credentials and terms | deferred |
| H10 | Item 5 | Human proposal and QA release review for an exact active revision | Independently authenticated operator + contractor signoffs bound to source, policy, content, QA report; a later edit invalidates both | deferred |
| H11 | Item 5 | Real PDF acceptance with approved fonts, attachments and multiple-page proposals | Accessible PDF/render/page-by-page glyph, overflow and layout checks on authorized sanitized data | deferred |
| H12 | Items 3–8 | Production quotas, abuse limits, monitoring, incident response, backup and restore | Operations runbook, restore rehearsal, alert ownership, quota/retention attestations | deferred |
| H13 | Items 6–8 | Email sender/domain/consent/opt-out, legal/privacy/security review and final commercial launch authorization | Approved providers/terms, authenticated webhook test, DNC/bounce suppression, recorded written go/no-go | deferred |

## Automated-only work, intentionally separated

- Item 3: existing draft PR #12. Its staged CI is not proof of live PostgREST/Auth/Storage.
- Item 4: existing draft PR #13, HEAD `7da070f04a75bba399618244401536cfde8263e2`. [Actions #39356145819](https://github.com/mlookhere/Bidmason/actions/runs/39356145819): 9/9 required jobs green at that exact HEAD; the last connected preflight was **5 of 24 passed, 19 missing**, not revalidated here.
- Item 5: `work/6-branded-proposal-preview` from `dev`. First commit `30a9d34099d17dc23fd3e1ce5b73b72a4626794c` passed [all 8 jobs](https://github.com/mlookhere/Bidmason/actions/runs/39383012143) with the new multi-company proposal PDF gate. Later revision-QA commits require **separate exact-head CI**. Source is a synthetic internal read-only contract, not a release-approval writer.
- PR #12, #13 remain draft and unmerged. Item 5 [draft PR #14](https://github.com/mlookhere/Bidmason/pull/14) targets `dev`, links existing Issue #6 and remains unmerged. Independent PR-triggered CI must also pass at its latest exact head before integration; branch workflow_dispatch alone is insufficient.

## Restart instructions after human prerequisites arrive

Validate each evidence item with live least-privilege reads, production-safe
negative tests, separately authenticated independent users, and exact-revision
rollback/revocation evidence. Record who approved, scope, test date, and evidence
location in the control Issue (without sensitive data). Then update states from
`deferred` to `verified` only where supported, rerun current exact-head Actions,
and review the inter-branch dependency/merge sequence; never treat a green
upstream synthetic test as automatic commercial release authorization.
