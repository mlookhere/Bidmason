-- BidMason evidence-review FK index on a fresh empty table.
create index if not exists bm_fact_reviews_evidence_fk_idx
 on public.bm_fact_reviews (organization_id, evidence_reference);
