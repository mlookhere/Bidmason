# Local ClamAV evidence scanner — not active in production

**Status:** `lib/local-clamav-evidence-scanner.ts` provides an internal fail-closed adapter for the mandatory `scan` dependency in `processEvidenceUpload()`. **No public POST route or production daemon is enabled. A real clamd engine has been exercised only in an isolated CI job with a purpose-built EICAR test signature, not with production virus definitions.**

The adapter uses ClamAV's documented [`clamd` INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html): NUL-terminated `zINSTREAM`, 4-byte big-endian length prefixes for chunks up to 64 KiB, and a zero-length final chunk. It connects **only to 127.0.0.1**, to the trusted server-configured integer port. `clamd` TCP connections are **neither encrypted nor authenticated**; never bind the daemon to a public address or allow routing across untrusted networks. A colocated scanner sidecar or secured isolated host runtime is required.

Only the daemon's exact `stream: OK\0` response, after the full file has been streamed, yields `clean`. A valid `stream: ... FOUND\0` yields `unsafe`. Timeouts, empty or truncated replies, oversized replies, malformed framing, scanner outages and other errors reject; **a missing scanner is never treated as approval**.

`tests-web/local-clamav-evidence-scanner.test.mjs` exercises loopback TCP with a *protocol simulator* for multi-frame content, valid/invalid replies, detections, invalid inputs and connection failures. This tests transport/parser logic, **not malware-detection effectiveness**. ClamAV signatures, configuration, availability, false negatives, nested/archived content and definition freshness require dedicated operational validation. In particular, the ClamAV `StreamMaxLength` must be at least 15 MiB and clamd must actively monitor all accepted formats.

**Before deployment:** provision and harden a maintained daemon on the same application host/network namespace, set the local-only port, verify up-to-date signed virus definitions, health checks and restart policy, exercise a known test signature end-to-end in isolated nonproduction, establish on-call fail-closed alerting, bind this adapter with the atomic quota in the private server composition, run two genuine tenant/Auth/Storage negative tests and obtain approval for upload retention/privacy. This module does not automatically grant cleanup or customer upload permissions.

## Single server-only upload composition

`lib/trusted-upload-dependencies.ts` now composes the atomic quota callback and loopback ClamAV scan callback into `EvidenceUploadDependencies`. It rejects missing or wrong-format private/publishable keys and invalid scanner port, freezes the result, and does **not** expose a POST route. The scanner cannot be silently replaced by a no-op using this composition function; the existing request boundary retains a test injection seam for unit tests only. No service, daemon, key or user request has been configured by this commit. The mandatory two-user Storage/API validation and deployment review remain unfulfilled.


## Real engine CI gate (not a production scanner)

The additional, non-optional GitHub Actions **av-real** job installs the real OS-provided `clamd` engine and launches it bound only to 127.0.0.1. `ci/clamav_real_integration.test.mjs` constructs an isolated, temporary ClamAV body signature for the standard 68-byte EICAR **antivirus test string** (not actual malware), confirms a clean synthetic PDF returns `clean`, confirms the test string in synthetic PDF returns `unsafe`, and confirms daemon shutdown makes scans reject. Missing `clamd`, failed signature loading, a simulated/fake response, a clean result on the test fixture, or an unavailable socket must fail this required job. No signatures, scan files, or scanner port persist outside the ephemeral CI runner.

This gate uses a **local test signature database rather than current official Cisco Talos definitions**. Therefore, even a green real-daemon test verifies only real engine/protocol integration, *not* production definitions, their freshness, malware-detection efficacy, deployment health or real user Storage access. No public upload route is enabled.

## Client-disconnect scan cancellation

The trusted upload boundary now forwards its request `AbortSignal` to the ClamAV TCP adapter. A disconnect during the scanner's 45-second response deadline **immediately closes the local socket and fails the scan**, without storing evidence even if the daemon would otherwise return clean. Signal listeners are removed after any success or error. A deliberately non-responsive mock daemon and a pre-aborted request are regression-tested. This reduces abandoned work but does not constitute a deployed scanner or an ingress-level rate limit.
