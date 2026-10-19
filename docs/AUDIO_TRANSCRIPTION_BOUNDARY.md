# Item 4 — Bounded transcription adapter (not connected to customer uploads)

`lib/audio-transcription.ts` provides one small, provider-neutral server-side
transcription boundary. The caller must retrieve bytes from approved tenant-
owned private Storage after authenticating the session and validating the
source metadata and virus scan; this module does **not** perform those tasks.

The boundary checks audio size (12 bytes to 8 MiB) and basic WAV/MP3/MP4
container signatures before calling a **server-configured** provider. The
provider must report exact transcript text, bounded duration, segments with
precise source spans and timestamps, and an explicit uncertainties array.
The adapter rejects extra top-level fields (including model-origin pricing,
approvals and instructions), mismatched spans, oversized transcripts and
impossible timestamps. It hashes original audio without returning raw bytes
and records provider name/version on successful output.

A recognized transcript with zero provider-declared uncertainties enters
`needs-human-review` as an unapproved source. Unclear words or ambiguous
numbers produce `needs-information`; `transcriptionSucceeded=false`
prevents these drafts from reaching extraction until an independently
implemented human correction. Unintelligible audio, provider exceptions,
timeouts or invalid provider responses return a failure code and audio hash,
not invented scope or a price. A server provider must respect its AbortSignal
and cancel its upstream request. No remote provider is wired here.

**Limitations:** A provider's declaration of uncertainty and clip duration
must be validated against actual media by the eventual trusted adapter.
No model can guarantee that it detected every ambiguous utterance; human
review remains mandatory even for apparently successful transcripts.
Signature checks are only preliminary format checks, not malware scanning
or comprehensive decoding. Failed audio must remain in authorized private
Storage under a separately approved retention policy, and should prompt
manual typed notes. Never log original audio or transcripts in CI.

`tests-web/audio-transcription.test.mjs` covers successful review,
uncertain-number blocking, unreadable audio, bad headers and byte bounds,
malformed/oversized replies, timestamps, provider exceptions, timeout and
no implicit approval. Item 3 live Auth, private Storage, maintained AV,
retention and rate-limits remain release gates. No public form, quote
sending, provider credentials or deployment has been enabled.
## Transcription evidence consistency

A successful provider response must now contain at least one source-exact audio/text segment. Segments must be ordered, non-overlapping in both UTF-16 text offsets and audio milliseconds, and within the declared clip duration; gaps for spaces/punctuation/silence remain allowed. Uncertainty excerpts may arrive in any order but must never overlap. Transcript text is passed through the shared immutable-source Unicode/NUL validation before any state can claim `needs-human-review`. Accepted segment and uncertainty records are returned as detached, whitelisted snapshots, not references to mutable provider-owned arrays. Malformed evidence produces `failed: invalid-response` rather than a misleading ready-for-review transcript. These checks improve internal input integrity only: no real media decoder, storage approval, or human verification is implied.
