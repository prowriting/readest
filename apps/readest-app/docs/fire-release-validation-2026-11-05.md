# Fire 0.12.8 release validation

Candidate **0.12.8 (12025)**, source `da7a2879bf456cf6d0f8b1f928fa70be84f19203`, is built and installed on the physical Fire tablet. Amazon's draft contains 12025 and passes Amazon validation. It replaces superseded build 12024; neither build has been submitted. Submission remains on hold. The November 6 investigation below found a working local Kindle-library import, with watermark and reading-position retention, but it is an isolated prototype and is not included in 12025. Browser upload/delivery remains unverified pending Amazon sign-in in Silk. Read-back confirms the correct APK version, unchanged listing fields and matching release notes.

## Fire compatibility fix

Build 12024 exposed Send to Kindle in the library, but the native handoff failed before showing the share sheet. The installed Fire Kindle app advertises no `ACTION_SEND` handler for EPUB or PDF. Build 12025 uses the existing native Fire detection and shared **Save file → Open Send to Kindle** dialog on Fire devices. Other Android devices and iOS retain native sharing. No conversion, automatic Amazon upload, or claim API changes were added.

This establishes a limitation of the EPUB share route on the tested Fire, not the impossibility of direct Kindle delivery. After the owner questioned BookFunnel compatibility, checked BookFunnel's current [Fire EPUB instructions](https://bookfunnel.com/help/app/fireos/save-epub-to-downloads/) and [Fire MOBI instructions](https://bookfunnel.com/help/app/fireos/save-mobi-to-downloads/) on November 5. The former directs EPUB readers to Amazon Send to Kindle; the latter marks its older local MOBI method unsupported. Their [Send to Kindle guide](https://bookfunnel.com/send-to-kindle/) documents saving a file, signing in to Amazon and uploading it. Those instructions support offering the browser fallback, but do not establish that local MOBI opening cannot work. The installed Kindle package advertises local VIEW handlers for MOBI/AZW3 and PDF but no SEND handler, including with wildcard MIME. BookFunnel was not installed on the tablet during this investigation.

Two regression tests cover Fire's fallback and retention of native sharing on ordinary Android. The Fire case failed before the fix. All **5,436 unit tests passed**, with 8 existing skips. Type checking, Biome, translation and production lookbehind checks passed. Optional Lua checking was skipped because LuaJIT is absent; no Lua or native source changed.

## Physical verification

Amazon Fire HD 10 (2023), KFTUWI; Fire OS 8 / Android 11 / API 30; build RS8338.3344N; Amazon WebView 150. No app data was cleared or uninstalled.

- Upgraded the installed 0.12.7 (12011) to 12024. All four existing books survived. Pride and Prejudice reopened at page 3 with identical visible text; accessibility nodes split one sentence differently, but the concatenated text was identical.
- A reusable review claim link opened over the reader and retained its dialog. Save to My Library returned to the library; Start Reading opened the saved book. The review audiobook saved successfully and exposed no Kindle action. Selecting multiple books also hid Kindle.
- Moby-Dick playback advanced on screen and Android MediaSession reported `PLAYING`, with the correct title and chapter. Paused after the check. This does not establish physical speaker audibility or long-duration playback.
- Upgraded to 12025 without clearing data. All six books, including the two review fixtures, remained.
- The saved review EPUB offered Kindle after the upgrade/restart. Fire opened the shared save/upload dialog. Canceling the native save picker left the book and dialog intact and the Amazon step disabled. Retry saved the EPUB and enabled the Amazon step.
- Independently pulled the saved EPUB from Downloads: ZIP integrity passed and its personalized watermark was present. The file is 9,411,108 bytes, SHA-256 `e393ccdb2c263060f4fddb155d0b67ff6f8ee58ee7bf4d426cde307b251ef77a`.
- Open Send to Kindle launched `https://www.amazon.com/sendtokindle` in Silk. Amazon displayed its sign-in page and supported EPUB upload. Actual delivery is not yet verified on Fire.

Reusable review codes do not expire or consume their use allowance. Consumed/expired-code independence is covered by the shared saved-file regression tests and earlier iOS device testing, not by claiming that these reusable codes were consumed.

## Standalone MOBI conversion experiment

Following the owner's question about conversion, converted a separate copy of the personalized review EPUB using the installed Calibre on the Mac, with `--mobi-file-type both` and a unique test title. The original EPUB was unchanged. Transferred the resulting file to the Fire's Downloads directory using ADB, then opened it with `ACTION_VIEW`, a file URI and MIME type `application/x-mobipocket-ebook` targeting Kindle.

Kindle 14.159.150(2.0.117354.0) opened the book in its reader and visibly rendered the personalized watermark. Screenshots `41-kindle-mobi-result.png` and `42-kindle-mobi-loaded.png` record this. The converted file is 9,587,321 bytes, SHA-256 `85e57e57ba86c5e7c8fbe80a2f1bb10e0ec4a37a3138e5926733239a51120c6b`.

After restarting Kindle, the test book was absent from library search and the six-item Downloaded view. Searching its original title also returned only store results. Copying the file into the existing Books and Kindle folders, requesting a media scan and relaunching Kindle did not make it appear in library search. Reopening the Downloads file with the same VIEW intent worked, but after advancing to location 11, exiting via Kindle's back arrow, force-stopping and reopening, the reader returned to the opening watermark page rather than restoring that position. Screenshots 50, 53, 60, 61, 63 and 65 record these checks. The converted file already has EBOK metadata in both its MOBI 6 and KF8 headers.

That first experiment proved local MOBI rendering and reopening on the attached Fire, but its tested route did not provide a complete library-delivery experience. It did not establish that every possible local import method fails. At that point, an app-to-app content-URI handoff remained untested; the November 6 work below resolves that question and demonstrates a different, successful import route. No conversion code has been added to BookArc and neither prototype is part of build 12025. The temporary copies were no longer present in Books and Kindle at cleanup; their disposition was not established. The Downloads demonstration file remained byte-identical to the Mac conversion, and the original EPUB was retained. The temporary plugged-in awake setting was restored after testing.

## Direct import investigation — November 6

**Result: a converted MOBI saved through Android's native document provider into internal storage's Books folder becomes a persistent, downloaded Kindle-library book.** Opening that library entry preserves the personalized watermark and remembers the reading position after Kindle is force-stopped and relaunched. A fresh, normally converted hybrid MOBI appeared on a normal switch to Kindle, without restarting Kindle, patching personal-document metadata, or a shell-issued media scan.

This was tested on the same Fire HD 10 and Kindle version using an isolated `app.bookarc.kindleprobe` application targeting Android 35. The helper has no internet or storage permissions in its manifest and never accesses BookArc's private files. Converted public-domain review fixtures were bundled into it, then written using the native Android file picker. ADB installed the helper and drove UI interactions; the successful MOBI saves were performed by the app through the document provider, not by shell file copies. EPUB originals were unchanged. Each format fixture had a distinct title and identifier to avoid confusing stale import identities.

The initial test order was secure content-URI handoff, alternative formats, personal-document metadata, then folder indexing. Ranked by the resulting evidence:

| Rank | Option | Observed result |
| --- | --- | --- |
| 1 | Hybrid MOBI into Books through a retained native folder grant, then open Kindle | Works. The first folder selection saved fixture A. After restarting the helper, fixture C saved without another picker and appeared in Kindle. C also opened from its library entry. |
| 2 | Hybrid MOBI into Books through a native Save dialog for each book | Works. Fresh fixture G appeared immediately on a normal app switch, displayed its watermark, and retained location **53 of 6545** after Kindle restarted. Explicit-PDOC fixture F independently retained **105 of 6545**. |
| 3 | AZW3 into Books | Works in the tested folder-copy route. Fixture B opened its watermark and retained **36 of 6544** after restart. B was copied by ADB, so an app-native AZW3 save was not separately verified. |
| 4 | Direct content-URI VIEW, without registering a file in Books | Not a complete import. Hybrid MOBI, old MOBI and share-not-sync MOBI opened but lost their reading positions. Hybrid did not appear in library search. Both AZW3 variants produced an Invalid Item/DRM message despite verified unencrypted headers. The same B file later worked when opened from its Books-folder library entry. |

The successful standard fixture G used Calibre's `--mobi-file-type both`, without `--share-not-sync` or EXTH patches. It is 9,587,133 bytes, SHA-256 `713944ddfe7f3d86c3700e75593335204055e9d71acf109b1c8741d059fae5bf`; the saved device copy was independently read back and matched. Changing to old MOBI or personal-document metadata alone did not fix direct VIEW. The old-MOBI watermark also had noticeably poorer contrast in Kindle's dark mode, favoring hybrid MOBI for further work.

For retained access, the helper used `ACTION_OPEN_DOCUMENT_TREE`, starting in Books. After the system's folder confirmation it called `takePersistableUriPermission`, then `DocumentsContract.createDocument` and wrote through the returned URI. Its write path was restricted to `primary:Books`. The second save after helper restart reused this grant. This follows Android's documented [Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files), without all-files access or access to Kindle's private database. The per-file alternative uses `ACTION_CREATE_DOCUMENT` with the same initial directory. Native document-provider logs showed a media scan of the completed file; no separate scan was sent by the helper or shell in the successful native tests.

The distinction between opening an external file and adding a file from Books agrees with [Standard Ebooks' Fire instructions](https://standardebooks.org/help/how-to-use-our-ebooks). The exact reason the previous experiment's temporary folder copies disappeared remains unproven; do not attribute that deletion to Kindle, metadata, or a particular scan URI without a controlled test.

**Recommended implementation:** convert the already-personalized saved EPUB to hybrid MOBI; request Books access on first use; save successfully before opening Kindle's library. Retain a per-file Save alternative and the Amazon web route. Do not send the newly saved content URI through the transient VIEW helper or label a successful file write as confirmed Kindle delivery. Keep app-only restrictions, preserve the original EPUB and watermark, and handle cancellation, revoked folder access, incomplete writes, and repeat exports without silently making duplicates.

The conversion in this investigation ran on the Mac. A production conversion service or on-device converter, integration with BookArc's shared handoff, error handling, and regression/device validation remain to be implemented. No Amazon upload or cross-device sync was tested, and no Kindle-cloud delivery is claimed. Device reboot persistence and other Fire models remain untested. Build 12025 and the Amazon draft are unchanged and unsubmitted.

Evidence is under `/Users/chrisbanks/bookarc/output/releases/fire-direct-import-20261106/`: source and signed helper APK, conversion fixtures/manifests, native logs, machine-readable results, and step screenshots. Key screenshots: 21–24 (native save, library and watermark), 25/27 (same reading position before/after restart), 28–33 (one-time folder grant and reuse), 13–16 (PDOC independent pass), and 17–20 (AZW3 folder pass).

The helper was uninstalled, revoking its folder grant. G still opened from Kindle at location 53 afterward (screenshot 36), demonstrating that it does not depend on the helper's private file or a temporary URI grant. Its durable Books file remains on the Fire. Removing the other four test files did not immediately remove their Kindle entries, so their original test bytes were restored to keep those entries usable; no user books or app data were removed. The temporary plugged-in awake setting was restored to its original value, 0, and read back successfully. Production exports must remain durable rather than being treated as disposable sharing-cache files.

## Artifact

Package `com.bookarc.app`; Amazon/foss distribution; version 0.12.8 / code 12025; min SDK 26; ARM64 and ARMv7. Verified the previous Fire signing identity, APK signature, 16 KB ZIP alignment, deep-link intent filters, and absence of restricted install/all-files permissions, Google billing, Google WebView initializer and Fire TV launcher targeting.

APK SHA-256: `61233d468449330cc2e9c0fd0e51a02ed8d6c534c4db6c64250da6acc22c8ffc`.

Private screenshots, XML, exported review EPUB, build logs and package checks are retained under `/Users/chrisbanks/bookarc/output/releases/fire-delivery-20261104/`. Open `screenshots.html` for the journey; replacement artifacts are in `fix-12025/`. These private files are excluded from Git. Only the named Fire model was physically tested.
