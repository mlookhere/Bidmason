# Item 6 — Production evidence inventory (all external gates unresolved)

**Status: BLOCKED — synthetic CI success is not production approval.**

This source-backed register identifies evidence that must be produced and
independently reviewed before any actual customer records, web access,
transactional email, provider callbacks or buyer responses can be enabled.
It complements [the execution tracker](BIDMASON_EXECUTION_TRACKER.md)
(Phase 3 / BM-015b and BM-029 through BM-034; decision DEC-06)
and [the master plan](MASTER_PLAN.md) (Items 3–6 and 8).
It is not a rewrite or completion of those requirements. Upstream
draft PRs #12–#14 and current draft PR #15 remain unmerged.

`ITEM6_RELEASE_EVIDENCE.json` initially marks **every one of thirteen
source-derived categories as `unverified`**. They include tenant Auth/RLS,
private storage, company-owned pricing and revision approval, recipient
consent, a real email provider and controlled sender/domain, verified
provider-native raw-body signatures and dedupe, transactional idempotency,
stop-contact controls, protected buyer view/response, CRM durability
and recovery, real adverse-case integration tests, and independent
security/privacy/legal/operations review plus a written go/no-go.

## Evidence handling

- `unverified`: no evidence reference, no authorization.
- `submitted-for-independent-review`: one or more HTTPS references to
  externally collected evidence. The URL is **untrusted**; listing it
  does not prove its contents, approver authority or approval.
- There is deliberately **no** `approved`, `verified` or `ready`
  status in this local manifest. Real approval and go/no-go must be
  authenticated and separately verified in the intended system by
  responsible humans and operational tests.
- `ci/item6_release_evidence.py` refuses incomplete manifests, missing
  or duplicated criteria, extra privilege fields, false release states,
  forged "passed" statuses, and malformed submissions. Its only possible
  successfully validated result is `blocked` with
  `releaseAuthorized: false`. It reads local JSON and makes **no**
  network, provider or database requests.
- `tests/test_item6_release_evidence.py` runs under existing required
  Python `fast`, `pr` and `security` suites. An ordinary **green CI
  result means that the release block is recorded correctly**, never that
  Item 6 is approved to send.

Run `python3 ci/item6_release_evidence.py` to see the current gap count.
A future authorized release needs a separate server-enforced,
source-authenticated and transactionally validated production gate; do
not repurpose this source inventory as an approval or send controller.
