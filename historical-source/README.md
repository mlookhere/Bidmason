# Quarantined historical assets

The **four remaining** files of the supplied 2026 `bidmason.zip` are copied only here by `scripts/import_legacy_assets.py`. The importer validates exact SHA-256 digests and byte lengths, refuses tampering or silent overwrite, ignores all other ZIP entries, and never executes any code. The two historical forms falsely report success, while the original proposal/PDF have unverified claims and pricing/PDF layout defects.

This directory is **not public**, is not a Next.js route, and must not be referenced in production `public/`, deployment outputs, or user-facing HTML. Source completeness does not imply QA approval.

```bash
python scripts/import_legacy_assets.py /path/to/bidmason.zip
python ci/source_integrity.py
```

Do not mark original source import complete until the actual four binary/text files are committed and validated by GitHub Actions. The script is preparation, not a substitute for committing those bytes.
