-- An owner or operator must not validate a business fact they submitted.
-- Separate person and active tenant membership are independently required.
drop policy bm_review_operator_submit on public.bm_fact_reviews;
create policy bm_review_operator_submit on public.bm_fact_reviews
  for insert to authenticated with check (
    reviewed_by = (select auth.uid())
    and exists (
      select 1 from public.bm_memberships m
      where m.organization_id = bm_fact_reviews.organization_id
        and m.user_id = (select auth.uid())
        and m.member_role in ('owner', 'operator')
    )
    and exists (
      select 1 from public.bm_business_facts fact
      where fact.organization_id = bm_fact_reviews.organization_id
        and fact.id = bm_fact_reviews.fact_id
        and fact.created_by <> (select auth.uid())
    )
  );
