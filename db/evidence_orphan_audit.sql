-- READ-ONLY operational evidence reconciliation (NEVER DELETE).
-- Run only from a privileged, audited operator context. This query is not
-- exposed as a client RPC and does not create permissions or state.
-- A receipt-less object can be an upload currently in flight, so only objects
-- older than 24 hours *since the latest metadata update* are review candidates.
-- Candidates still require independent manual verification before disposal.
select
  o.bucket_id,
  o.name as object_path,
  o.created_at,
  o.updated_at,
  r.id is not null as has_receipt,
  case when r.id is null and o.updated_at <= now() - interval '24 hours'
    then 'review_candidate'
    else 'retain'
  end as disposition
from storage.objects o
left join public.bm_evidence_receipts r
  on r.object_path = o.name
 and r.organization_id::text = split_part(o.name, '/', 1)
where o.bucket_id = 'bm-evidence'
order by o.created_at, o.name;
