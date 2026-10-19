# Item 4 — Internal source-backed correction editor (unrouted)

The internal React client component `components/ExtractionCorrectionPanel.tsx`
and pure, browser-compatible `lib/extraction-correction-editor.ts` provide
a missing-data correction entry surface for the existing immutable human
extraction correction flow (BM-023).

An internal reviewer can propose **replace**, **remove**, and **add** actions.
Replacing preserves the candidate's original exact source span while changing
only its code or integer quantity; removal requires a bounded explanation.
Adding missed work requires selecting the precise passage of the original
source in a read-only text field, as well as entering a unique service code,
positive integer quantity, and written explanation. The editor rejects
zero-length/whitespace evidence, split surrogate pairs, duplicate services,
unchanged replacements, empty/all-removed scope, stale review keys, and
unbounded explanations. It canonicalizes action order and preserves the
original provider suggestions without mutation.

The browser emits **only** original source/candidate consistency hashes and
structured, explained changes. It never creates a trusted actor ID, quote,
approved review, price, or send request. Any `onRequestCorrection` callback
must authenticate the reviewer and use the existing
`prepareExtractionCorrectionDraft` / trusted correction CAS service against
the persisted original on the server. Browser validation is a usability
feature, **not** proof of identity, input security, source ownership or
permission. The server recomputes the correction SHA-256. No endpoint,
public route, uploads, network fetch, persistent storage, billing or send
operation is added. The UI shows an explicit no-integration state when no
trusted callback is supplied.

The component is intentionally *unrouted*. It is a foundation for the
missing-data review workflow, not a finished deployed feature. Tests in
`tests-web/extraction-correction-editor.test.mjs` exercise the pure editor
against the real strict server-side correction draft validator, including
source spans, replacements, omissions, canonical operations, duplicated
codes, input size limits, stale evidence and isolation of returned requests.
The existing Next TypeScript build checks the client component.

Before production, Item3 live multiuser Auth/RLS/private Storage, maintained
signed AV, independently approved company policies, retention/consent,
accessibility/browser acceptance and operational/security signoff remain
mandatory.
