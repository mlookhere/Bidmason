# Read-only live evidence proof: bounded provider responses

The opt-in `verifyLiveEvidenceIsolation()` harness now caps the raw foreign-receipt PostgREST body at **8 KiB**, with a **10-second full-body deadline**, strict JSON parsing and Content-Length validation. It rejects unbounded, malformed and duplicate/nonempty foreign receipt responses rather than misclassifying them as a proven denial.

Storage 401/403/404 denial responses are still required, but their response-body cancellation is not awaited indefinitely: a hostile or malfunctioning Storage provider cannot block the entire verification after denying access. Provider 5xx, unexpected status, malformed payload and incomplete proof continue to fail.

Additional offline tests exercise enormous or malformed PostgREST replies, suspicious Content-Length and non-completing Storage cancellation. This is **not** an executed genuine Auth/Storage provider proof. The real two-user script still requires explicit operator approval, two existing signed-in tenant sessions, and two existing trusted receipt-backed objects. It never creates fixtures, changes memberships or authorizes customer uploads.

Release requirement remains open until genuine live signed-in HTTP sessions are approved and exercised.
