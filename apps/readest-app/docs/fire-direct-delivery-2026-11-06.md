# Direct Fire delivery — November 6, 2026

## Implementation

The shared Kindle action resolves a hybrid MOBI before loading EPUB bytes on Fire. Current claims request `format=mobi`; saved BookArc deliveries use a protected receipt tied to the exact personalized source SHA-256. Claims save and verify the receipt with the durable original before confirmation. Metadata edits and sync preserve it; content replacement drops it.

The delivery backend retains immutable personalized copies and queues conversions through one private Calibre 9.8.0 worker. Receipt downloads check current app-only restrictions and explicit gift/enrollment revocation independently of claim expiry or use count. Source and converter version identify cached variants. Pending work returns 202 with retry guidance. Ordinary imports and legacy records use the explained upload fallback; receipt denials never trigger that fallback automatically. Temporary uploaded conversions expire after two days in storage.

The reader verifies and caches MOBI bytes locally. Native Android code requests and retains a grant to internal storage's public Books folder, writes and verifies a temporary file, renames it, records the durable export, and launches Kindle's main activity. Repeat exports verify and reuse existing files; removed files are recreated. Cancellation, interrupted writes, revoked access, and retries leave the original library book intact. Saving is reported separately from Kindle delivery. The explicit Amazon website fallback remains, including for PDF and TXT. iOS and ordinary Android continue native file sharing; desktop/web retain the existing save/upload steps.

## Verification so far

- Reader: 5,451 tests passed, eight existing skips; type checking and Biome passed. A timing-sensitive existing keyboard-focus test failed under heavy concurrent load, passed alone, and passed in the full suite with two workers.
- Native: Kotlin export tests, Rust formatting and Clippy passed. Tests cover intact reuse, missing/stale records, partial writes, verification, and retry.
- Backend: new receipt/conversion tests and 33 related delivery/signup/route regressions passed; Reader API's 206 tests and infrastructure tests passed. The full website suite encountered unrelated test-host/timing failures under concurrent workloads; isolated reruns passed. This is not recorded as a clean full-suite pass.
- The production private worker successfully converted the personalized Pride and Prejudice review EPUB. Source SHA-256: `e393ccdb2c263060f4fddb155d0b67ff6f8ee58ee7bf4d426cde307b251ef77a`; MOBI SHA-256: `419ef728134b590be5f9edc5a053af8f2e1249ce1506ed874cf578ba20c32d26`. A round-trip inspection retained the claim watermark. This source has no declared EPUB cover, so it does not establish cover preservation for a source with one.

## Rollout gate

The private worker is running. Author/API endpoint promotion and the replacement Amazon build are in progress. Physical verification of the integrated app remains required before submitting the replacement Amazon release. The Fire was disconnected when this record was written. The earlier isolated prototype evidence is in `fire-release-validation-2026-11-05.md`; it does not establish that this replacement app build has passed.

Private logs, payloads, screenshots, and release manifests are kept outside Git under `output/releases/fire-direct-delivery-20261106` in the parent workspace. Do not commit protected receipts or review codes.
