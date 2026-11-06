# Direct Fire delivery — November 6, 2026

## Implementation

The shared Kindle action resolves a hybrid MOBI before loading EPUB bytes on Fire. Current claims request `format=mobi`; saved BookArc deliveries use a protected receipt tied to the exact personalized source SHA-256. Both the claim dialog and direct browser reading route save and verify the receipt with the durable original before confirmation. Metadata edits and sync preserve it; content replacement drops it.

The delivery backend retains immutable personalized copies and queues conversions through one private Calibre 9.8.0 worker. Receipt downloads check current app-only restrictions and explicit gift/enrollment revocation independently of claim expiry or use count. Source and converter version identify cached variants. Pending work returns 202 with retry guidance. Ordinary imports and legacy records use the explained upload fallback; receipt denials never trigger that fallback automatically. Temporary uploaded conversions expire after two days in storage.

The reader verifies and caches MOBI bytes locally. Native Android code requests and retains a grant to internal storage's public Books folder, writes and verifies a temporary file, renames it, records the durable export, and launches Kindle's main activity. Repeat exports verify and reuse existing files; removed files are recreated. Cancellation, interrupted writes, revoked access, and retries leave the original library book intact. Saving is reported separately from Kindle delivery. The explicit Amazon website fallback remains, including for PDF and TXT. iOS and ordinary Android continue native file sharing; desktop/web retain the existing save/upload steps.

## Verification

- Reader: 5,453 tests passed, eight existing skips; type checking and Biome passed. A timing-sensitive existing keyboard-focus test failed under heavy concurrent load, passed alone, and passed in the full suite with two workers.
- Native: Kotlin export tests, Rust formatting and Clippy passed. Tests cover intact reuse, missing/stale records, partial writes, verification, and retry.
- Backend: the full website suite passed with 3,455 tests and eight SQL-dependent skips using bounded parallelism. Reader API: 206 passed. Infrastructure: 290 passed and two skipped. Delivery/signup/route regressions also passed. The first GitLab quality job timed out during an existing Ask BookArc test and its test host crashed; the retry also exceeded the job timeout during the website suite. All browser/graphics, SQL Server, infrastructure, shell, and web-assets CI jobs passed. The local full-suite pass does not represent a green GitLab pipeline.
- The production private worker successfully converted the personalized Pride and Prejudice review EPUB. Source SHA-256: `e393ccdb2c263060f4fddb155d0b67ff6f8ee58ee7bf4d426cde307b251ef77a`; MOBI SHA-256: `419ef728134b590be5f9edc5a053af8f2e1249ce1506ed874cf578ba20c32d26`. A round-trip inspection retained the claim watermark. This source has no declared EPUB cover. A separate production conversion of the Standard Ebooks edition preserved its declared cover byte-for-byte and all 64 original headings in order, with Calibre adding a navigation contents page. Its source and MOBI digests were distinct from the personalized edition.

## Deployed backend

The backend release is `1505f01fa60f120e78090ddb0cdd16db19c43c9e`, based on the retailer-controls release. Its tree matches implementation commit `9934561163c9ea9be92e2af92cc0a4252da93fab`.

- Author backend: `bookarcweb-prod-web--fire-1505f01f-20261106102603`, image SHA-256 `371f6b78dd4553b2e39d5a94b5ffc247624d1a1e04bc25860478ace3df750196`, serving 100% of traffic.
- Reader API: `bookarcreader-prod-api--fire-1505f01f-20261106105531`, image SHA-256 `df3498de07f1eed6b3d85324d2b234f9ae00e902bb17fa0f246832a4f75e0062`.
- Private converter: `bookarcweb-prod-ebook-converter`, one replica with no ingress, using the pinned backend image. Its Service Bus subscription accepts only ebook-conversion jobs; delivery blobs are private.

Live Reader API verification requested MOBI directly, received 202, polled the receipt, and downloaded the personalized result without first downloading or uploading EPUB. A repeated request returned identical cached bytes; an invalid receipt returned 404. The default EPUB response matched the receipt's source digest. CORS exposed the receipt and digest headers. The separate anonymous ordinary-import conversion route also passed. Public hostname bindings and existing application configuration were preserved during rollout.

## Web reader

Reader code `8766543196bdf26414790b8d7a5af76003182caf` is also deployed at `web.bookarc.app`, so browser claims retain receipts for later sync to Fire. Revision `bookarcreader-prod-web--receipt-8766543-11061122` uses image SHA-256 `2e9c276c943e05f03cf5f1c972b493dbf72690e359fa701b990a5d6a434e0448`. The candidate preserved the previous revision's configuration, passed Library and Read checks, and served the receipt code in its browser scripts. Both public hosts passed three rounds of checks before the 5% canary, during the canary, and after promotion to 100%. Final verification passed and the superseded revision was retired. Release tags are `bookarc-kindle-backend-20261106` in the parent repository and `bookarc-web-20261106` in the reader repository.

## Fire release gate

The replacement Amazon APK is version 0.12.8, build 12026, built from reader commit `8766543196bdf26414790b8d7a5af76003182caf`. Its SHA-256 is `77f4dcfb4940885669c36ccc4c24e524da71f41a39376d8f97ea01b926b85ec7`. Signing matches the published app; ARM64/ARMv7, minimum SDK 26, 16 KB alignment, permissions, and deep links passed artifact checks.

Build 12026 was uploaded to the existing Amazon draft and Amazon validation passed. A separate readback confirmed the draft version and release notes. It has **not been submitted**. On the reconnected Fire, saving returned to the library, the receipt survived an app restart, and preparation cancellation left the library and Books folder unchanged. The production worker converted that receipt's personalized source, but the native handoff rejected its cache path before opening the folder picker.

Tauri resolves Android AppData to `applicationInfo.dataDir`, while the exporter's allowed roots included only `filesDir`, `cacheDir`, and external files. The fix permits the dedicated `Bookarc/kindle-conversions` directory beneath AppData while retaining canonical-path checks. A native regression test failed against build 12026's logic and passed after the fix; sibling paths and symlink escapes remain rejected. A second failing-then-passing regression ensures native string errors retain recovery guidance and permit retry. Replacement build 12027 is being prepared. The complete integrated Kindle library, watermark, restart, offline reuse, and duplicate checks remain required before submission. Earlier prototype evidence in `fire-release-validation-2026-11-05.md` is separate from this integrated-build verification.

Private logs, payloads, screenshots, and release manifests are kept outside Git under `output/releases/fire-direct-delivery-20261106` in the parent workspace. Do not commit protected receipts or review codes.
