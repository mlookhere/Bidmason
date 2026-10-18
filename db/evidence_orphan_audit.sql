-- BIDIRECTIONAL READ-ONLY operational evidence reconciliation (NEVER DELETE).
-- Run only as privileged/audited operator on complete Storage/receipt snapshots.
-- Client-scoped RLS may hide evidence and must NEVER be used for this audit.
-- 24h is for classifying receipt-less objects for manual review, NOT cleanup.
-- An existing trusted receipt with no Storage object is a distinct, urgent
-- integrity discrepancy requiring investigation; never silently recreate it.
select
  coalesce(o.bucket_id, 'bm-evidence') as bucket_id,
  coalesce(o.name, r.object_path) as object_path,
  coalesce(r.organization_id::text, split_part(o.name, '/', 1)) as organization_id,
  o.created_at,
  o.updated_at,
  o.id is not null as has_storage_object,
  r.id is not null as has_receipt,
  case
    when o.id is null then 'missing_object_review'
    when r.id is null and o.updated_at <= now() - interval '24 hours'
      then 'orphan_review_candidate'
    else 'retain'
  end as disposition
from storage.objects o
full outer join public.bm_evidence_receipts r
  on o.bucket_id = 'bm-evidence'
 and r.object_path = o.name
 and r.organization_id::text = split_part(o.name, '/', 1)
where o.bucket_id = 'bm-evidence' or (o.id is null and r.id is not null)
order by coalesce(o.created_at, r.received_at), coalesce(o.name, r.object_path);
