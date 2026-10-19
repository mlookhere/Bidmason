-- Stage-only privilege sealing. The legacy four-argument reader is an
-- INTERNAL implementation detail of the session-locked SECURITY DEFINER
-- wrapper, not a service_role API. Install only AFTER the wrapper exists.
-- No records, signatures, policy decisions or customer state are changed.
revoke all on function
 bm_intake_private.read_corrected_internal_preview_inputs(
   uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;

-- The five-argument session-locked function retains its narrow service
-- role grant and executes the inner function as its trusted owner.
