# Private receipt metadata RLS hardening

The deployed Storage SELECT policy already restricted contractor file access to the verified uploader. The original `bm_receipt_member_read` policy, however, allowed any active tenant contractor to enumerate *every* same-tenant receipt's path, hash, MIME and byte length, even when that contractor could not read the file. This constituted a metadata confidentiality gap.

The eighth additive migration makes both `bm_receipt_member_read` (permissive) and new `bm_receipt_member_boundary` (**restrictive**) require current tenant membership **and** either owner/operator role or `uploaded_by = auth.uid()`. Legacy NULL-uploader receipts remain reviewable by owner/operators only; they do not grant all contractors access. The restrictive second guard prevents an unrelated future permissive read policy from bypassing this requirement. User insert/update/delete grants remain revoked. There is no broad contractor grant, signed URL, metadata update or Storage owner override.

`ci/db_receipt_metadata_privacy_test.sql` must execute **after** all historical receipts/Storage/revocation tests, both on the full isolated source schema and the complete managed migration replay, to confirm verified uploader B sees just their own receipt, second contractor D sees none, owner A sees both A receipts, owner C sees only B tenant, missing identity sees none, shadow permissive policy is ineffective and revocation immediately removes B's visibility.

The policy change is intended for the dedicated BidMason test Supabase project only. The tests exercise PostgreSQL RLS and **do not substitute for genuine signed-in Supabase PostgREST/Storage API validation**. Do not expose customer uploads, merge PR #12 or grant security approval based solely on these DB tests.
