-- BidMason managed Supabase migration: 20261018100829 bidmason_scan_gate_storage_lockdown
-- Additive client-write deny; preserve all previously applied migration history.
-- Defense-in-depth: ONLY server-managed Storage writes may store evidence.
-- A signed-in tenant user cannot skip application malware scanning or the
-- atomic upload quota by calling the Storage API directly.
-- This additive restrictive policy ANDs with ALL permissive INSERT policies.
-- A privileged server operation must reauthenticate, scan and quota-gate
-- BEFORE any service-role Storage write. Public upload remains DISABLED.
-- The service role bypasses RLS; NEVER expose its key or allow client inputs
-- to choose a bucket, tenant or storage path.
create policy bm_evidence_server_only_insert
on storage.objects
as restrictive
for insert to public
with check (bucket_id <> 'bm-evidence');
