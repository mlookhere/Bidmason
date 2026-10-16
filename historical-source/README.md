# Quarantined historical ZIP source assets

The original `bidmason.zip` supplied 32 files. The 28 text files are committed directly to their source paths (the historical top-level README is under `docs/`). Four unsafe-to-publish legacy assets are stored **byte-for-byte recoverably** in `legacy-assets.lzma.b64`: two standalone HTML websites, one ReportLab PDF generator, and the original proposal PDF.

The GitHub bundle uses only standard library LZMA and Base64; `scripts/source_bundle.py` authenticates the compressed SHA-256, full decompressed digest and exact SHA-256/length of every constituent entry before restoration. The payload is a lossless encoding of the user-supplied original bytes, not a patched or publishable version.

```bash
python -m scripts.source_bundle
python ci/source_integrity.py
```

Restored files are placed only under `historical-source/`, excluded from publication; they are ignored by Git to avoid inadvertently adding unreviewed originals as live content. An alternative importer accepts the original ZIP: `python scripts/import_legacy_assets.py /path/to/bidmason.zip`. Neither importer executes the original Python, JavaScript or HTML.

**Do not deploy historical assets.** The old HTML shows fake form-success states; the old PDF contains pricing and visual defects and unverified credential claims. See Issue #3 for required fixes. The currently visible Next.js site is a development preview with no working lead intake. `noindex` does not imply access control.
