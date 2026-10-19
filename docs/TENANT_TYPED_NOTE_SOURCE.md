# Item 4 — Authenticated typed-note source creation (server-only)

`lib/tenant-typed-note-source.ts` fills the input gap before the existing
tenant-owned extraction/review pipeline. It takes an explicit tenant UUID,
a request UUID for idempotency and up to **64 KiB UTF-8** of original note text.
It preserves the exact original bytes represented by that UTF-8 text, rejects
empty/NUL/ill-formed Unicode, and never accepts a browser-supplied source UUID,
reviewer identity, extraction result, price, approval, policy or send directive.

A future **trusted server** `TrustedTypedNoteSourceStore` must atomically
authorize current tenant membership and `create-intake` permission, create a
unique source ID on the server, and hold a UNIQUE
`(organization_id, actor_id, request_id)` idempotency ledger in the SAME
database transaction as source creation. For duplicate requests, return the
same committed source only to an authenticated, still-authorized actor for
the exact same payload; different text under that request ID is a conflict.
The untrusted browser cannot choose or overwrite the identity/ID ledger.

The record starts at revision 1 with its immutable
`original: {kind:"typed-note",text}`, no extraction review, no scope review
and no extracted prices. A server-derived creation audit includes actor UUID,
request UUID and SHA-256 of the exact text. The helper validates the backend's
result, then performs a fresh authorized primary read-back. An error after
create may mean the source is already stored; **do not blindly retry with a
new request UUID**. Reconcile through the protected request-ID ledger.

The created record is shape-compatible with the existing
`readExtractionPreparation()` contract for a subsequent explicit, bounded
human-review extraction. Merely creating a note never approves its content,
services, prices, delivery or proposal publication.

**Not live:** No HTTP endpoint, browser upload, database migration or
customer-visible path is enabled. Mock-store tests do not prove real Supabase
Auth/RLS/Storage byte integrity, unique constraints, AV, rate limits or
retention/security acceptance. Item 3 production gates remain mandatory.
