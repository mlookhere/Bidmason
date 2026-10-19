#!/usr/bin/env bash
# DISPOSABLE CI-ONLY Item 4 staged SQL integration against REAL pinned Item 3
# tenant tables. NOT a production migration or Supabase deployment script.
set -euo pipefail

if [[ "${BIDMASON_CI_DISPOSABLE_POSTGRES:-}" != "1" ||
      "${PGHOST:-}" != "127.0.0.1" ||
      "${PGPORT:-}" != "5432" ||
      "${PGUSER:-}" != "postgres" ||
      "${PGDATABASE:-}" != "postgres" ]]; then
  echo 'REFUSED: this migration integration is restricted to disposable local PostgreSQL CI' >&2
  exit 1
fi

# Item 4 foundation and Item 3 authentic tenant tables are already installed
# and both complete tenant test suites already succeeded on this instance.
# Keep the dependency order identical to the proven intake-db job.
readonly sql_files=(
  db/typed_note_lookup.sql
  db/typed_note_candidates_digest.sql
  db/typed_note_extraction_commit.sql
  db/typed_note_extraction_read.sql
  db/staged_policy_activation.sql
  db/staged_policy_review_history.sql
  db/typed_note_review_fingerprint.sql
  db/typed_note_scope_review_commit.sql
  db/typed_note_scope_inspect.sql
  db/typed_note_correction_quarantine.sql
  db/typed_note_correction_draft.sql
  db/typed_note_correction_evidence_review.sql
  db/typed_note_correction_activation.sql
  db/typed_note_corrected_scope_review.sql
  db/typed_note_corrected_commercial_decision.sql
  db/typed_note_corrected_internal_preview.sql
)
for file in "${sql_files[@]}"; do
  test -f "$file"
  psql -X -v ON_ERROR_STOP=1 -f "$file" >/dev/null
done

# Create a synthetic auth.sessions TABLE only in this isolated PostgreSQL
# service (not in the real Supabase Auth-owned schema), and install its
# service-private probe. The upstream test also proves revoked-session denial.
psql -X -v ON_ERROR_STOP=1 -f ci/db_auth_session_revocation_test.sql >/dev/null

# The synthetic session-denial fixture explicitly REVOKES schema auth usage
# from authenticated. Restore only the original Item 3 auth.uid() schema
# visibility for its RLS tests; NEVER grant session-table read or browser RPC.
# The dedicated negative check below proves this is not a privilege bypass.
psql -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
grant usage on schema auth to authenticated;
do $verify$
begin
 if not has_schema_privilege('authenticated','auth','USAGE')
   or not has_function_privilege('authenticated','auth.uid()','EXECUTE')
   or has_table_privilege('authenticated','auth.sessions','SELECT')
   or has_table_privilege('anon','auth.sessions','SELECT')
   or has_table_privilege('service_role','auth.sessions','SELECT') then
   raise exception 'Restored Auth UID would expose private Auth sessions';
 end if;
end;
$verify$;
SQL


psql -X -v ON_ERROR_STOP=1 -f db/staged_corrected_preview_session_lock.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f db/staged_seal_legacy_corrected_preview.sql >/dev/null
echo 'PASS: complete staged Item 4 private schema installed on real Item 3 tenant RLS'
