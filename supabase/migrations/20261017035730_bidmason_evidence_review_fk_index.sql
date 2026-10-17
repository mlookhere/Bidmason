-- BidMason applied managed Supabase migration: 20261017035730 bidmason_evidence_review_fk_index
-- Reproduced from db/review_indexes.sql.
-- BidMason evidence-review FK index on a fresh empty table.
create index if not exists bm_fact_reviews_evidence_fk_idx
 on public.bm_fact_reviews (organization_id, evidence_reference);
