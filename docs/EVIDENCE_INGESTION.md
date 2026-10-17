# Candidate evidence receipt preparation

The server-side candidate function in lib/evidence.ts computes SHA-256 and byte length from received bytes, validates canonical tenant/object UUIDs and file signatures, and derives the tenant-scoped Storage key. It cannot accept a caller-supplied digest or path. Node tests run in Linux and Windows CI.

**Not a deployed ingestion service:** It does not authenticate requests, check private object existence, virus-scan files, verify full PDF/image format, issue SQL receipts, or attest real credentials. An authorized trusted backend must compare uploaded bytes to the actual private Storage object and only then issue a receipt. No service-role key belongs in browser code. The work is currently an isolated prototype with no dedicated BidMason Supabase project.
