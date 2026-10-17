## Supabase user-scoped Storage adapter (not yet exposed to users)

`lib/supabase-evidence-port.ts` implements the real **HTTP contract** for the approved BidMason project's Auth, Data and private Storage APIs, with all requests scoped to the same user JWT and the project's **publishable** key. It makes no browser-accessible endpoint and is not deployed. The fixed origin and bucket cannot be overwritten by caller input.

- Authorizes by asking Supabase Auth for the actual user and performing an RLS-filtered membership query. It repeats this check after upload and readback, before permitting a trusted receipt.
- Uploads through the Storage standard object upload endpoint with `x-upsert: false`, preserving the immutable-object policy; reads the file back through authenticated private-object download and compares byte hashes and lengths.
- Uses an injected `issueTrustedReceipt()` function to isolate the *only* privileged step. **The trusted receipt issuer has not been implemented**; never pass it through browser code or from a client-controlled request body.
- Fails closed on missing/invalid public-key configuration, incorrect user, revoked membership, rejected upload, invalid or unexpected object paths, downloaded content mismatch and unavailable provider.

`tests-web/supabase-evidence-port.test.mjs` exercises this flow using intercepted HTTP responses. This is not proof of success against live Supabase Storage or real signed-in accounts. Production needs verified session transport, private credential custody, a trusted insert implementation, orphan cleanup and malware/document validation. Never enable a customer-facing upload form based on mocked tests alone.
