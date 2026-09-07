# Amazon Appstore releases

The Amazon edition is a free Fire-tablet reader. Registration, sign-in, account deletion,
library sync and imports stay available. It uses the native bridge's `foss` variant and the
existing Android package/signing identity. Amazon handles app updates; the Google WebView
upgrade initializer is removed from the merged release manifest.

## Build

From `apps/readest-app`, copy `.env.amazon-appstore.example` to `.env.amazon-appstore.local`.
Fill in the SDK path and the existing Android upload keystore credentials. Do not generate
a new keystore for each release. Use the same key password and store password, as required
by the existing signing helper. Set `JAVA_HOME` to your Android-compatible JDK if needed.

```sh
pnpm release-amazon-appstore
# Optional, if Amazon already has this version code:
pnpm release-amazon-appstore --version-code 12007
```

The script runs from the app directory, including when invoked by absolute path. It initializes
the generated Android project if absent, wires signing, temporarily selects `foss` and applies
Amazon manifest exclusions, then restores the generated Gradle/manifest files on success,
failure or interruption. Do not run another Android release in this checkout at the same time.

The frontend channel is forced to `amazon`, even if another dotenv file contains Play values.
The APK contains both ARMv7 and ARM64. Build verification checks its signature, package, minimum
SDK, version, Google dependencies and merged permission/WebView/TV entries. Do not lower the
Android SDK levels for Amazon. Add notes for the package version in `release-notes.json`.

Outputs: `dist/amazon/<version>-<versionCode>/bookarc.apk`, `release.json`, `release-notes.txt`,
and `signature.txt`. Keep these together as the release artifact. Default version codes use
Tauri's normal version derivation; the uploader rejects codes that do not exceed Amazon's.
The first Amazon version can use a different version code from Play, but preserve increasing
codes and signing identity within Amazon. Cross-store replacement is not promised: Google
Play App Signing and Amazon signing choices can produce different installed certificates.

## First submission

Create/reuse the organisation's Amazon developer account, complete identity verification, and
create the first app in the Developer Console. Use `store/amazon/submission.md` and the prepared
English listing. Upload the verified APK; choose Free, no IAP, and tested Fire tablets only.
Complete privacy/rating fields, reviewer credentials and screenshots before submitting.
Amazon requires physical-device testing. A Samsung device or browser screenshot is not Fire
certification. The first app cannot be created with the submission API.

## Subsequent uploads

Create an App Submission API security profile and store `AMAZON_CLIENT_ID`,
`AMAZON_CLIENT_SECRET` and `AMAZON_APP_ID` in the ignored local env file or CI secrets.
The API uses the `appstore::apps:readwrite` scope; Play service-account credentials do not work.

```sh
pnpm upload-amazon-appstore --artifact dist/amazon/0.12.5-12005 --dry-run
pnpm upload-amazon-appstore --artifact dist/amazon/0.12.5-12005
# Explicitly submit after upload and validation:
pnpm upload-amazon-appstore --artifact dist/amazon/0.12.5-12005 --submit
```

Use the actual artifact directory printed by your build. Dry-run verifies local artifact integrity
without network access. Default upload creates and validates a draft; it does not commit it.
After reviewing that draft, submit it through the console. Do not rerun the upload command to
submit the same already-uploaded version. `--submit` is for a fresh upload that should be submitted
immediately after validation.

Only one edit can exist. The uploader does not take over an existing draft automatically.
For an upload that failed before the APK was replaced, pass its printed `--edit-id ID` to retry.
If replacement succeeded and a later step failed, inspect and finish the draft in the console
or explicitly discard that draft there before uploading again. Multiple APK listings require
`--apk-id ID`. Replacement preserves existing tested device targeting. Existing listing text
is preserved; only English release notes are updated. ETags protect replacement, listing updates
and commit from concurrent modification. Failed authentication, upload or validation never submits.

## Physical Fire test record

Test both Fire OS 7 and 8; enable only device families that pass. Keep the model, OS/API level,
system WebView version, APK SHA-256 and actual results with each release.

- Fresh installation without Google Play services: launch, registration, sign-in, password recovery.
- Claim a free book, Discover, library sync, EPUB/PDF file-picker imports and offline reading.
- Page turns, fonts, annotations, rotation, TTS, audiobook playback and background/resume behavior.
- Account management and deletion; no purchase actions or Stripe requests, including direct payment links.
- System WebView rendering without installing Google WebView; app updates supplied by Amazon.
- Upgrade from the previous Amazon APK with `adb install -r`; preserve books and reading progress.
- Inspect the Amazon-distributed build in Live App Testing before first production release, including
  browser sign-in return links. If signing changes, configure verified app links for Amazon's certificate.

Fire OS 6 and earlier are excluded by the existing minimum SDK 26. This work does not establish
that every Fire OS 7/8 model passes: exclude any failing model until its compatibility issue is fixed.

References: [API overview](https://developer.amazon.com/docs/app-submission-api/overview.html),
[API reference](https://developer.amazon.com/docs/app-submission-api/appsub-api-ref.html),
[presubmission checklist](https://developer.amazon.com/docs/app-submission/presubmission-checklist.html).
