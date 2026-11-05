# Fire 0.12.8 release validation

Candidate **0.12.8 (12025)**, source `da7a2879bf456cf6d0f8b1f928fa70be84f19203`, is built and installed on the physical Fire tablet. Amazon's draft contains 12025 and passes Amazon validation. It replaces superseded build 12024; neither build has been submitted. Final Kindle delivery testing is awaiting Amazon sign-in in Silk. Read-back confirms the correct APK version, unchanged listing fields and matching release notes.

## Fire compatibility fix

Build 12024 exposed Send to Kindle in the library, but the native handoff failed before showing the share sheet. The installed Fire Kindle app advertises no `ACTION_SEND` handler for EPUB or PDF. Build 12025 uses the existing native Fire detection and shared **Save file → Open Send to Kindle** dialog on Fire devices. Other Android devices and iOS retain native sharing. No conversion, automatic Amazon upload, or claim API changes were added.

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

## Artifact

Package `com.bookarc.app`; Amazon/foss distribution; version 0.12.8 / code 12025; min SDK 26; ARM64 and ARMv7. Verified the previous Fire signing identity, APK signature, 16 KB ZIP alignment, deep-link intent filters, and absence of restricted install/all-files permissions, Google billing, Google WebView initializer and Fire TV launcher targeting.

APK SHA-256: `61233d468449330cc2e9c0fd0e51a02ed8d6c534c4db6c64250da6acc22c8ffc`.

Private screenshots, XML, exported review EPUB, build logs and package checks are retained under `/Users/chrisbanks/bookarc/output/releases/fire-delivery-20261104/`. Open `screenshots.html` for the journey; replacement artifacts are in `fix-12025/`. These private files are excluded from Git. Only the named Fire model was physically tested.
