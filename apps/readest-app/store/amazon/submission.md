# Amazon submission packet

Status: listing copy and icon assets prepared; console entry, reviewer credentials,
content-rating questionnaire, Fire-device screenshots and certification are pending.
This file is a preparation worksheet, not a declaration that Amazon has approved the app.

## Listing settings

- App name: BookArc. Package: `com.bookarc.app`.
- Default language: English (United States). Copy: `en-US/listing.json` (plain text, no HTML).
- Price: Free. In-app purchases: No. Advertising: No.
- Category: Books & Comics. Devices: tested Fire tablets only; deselect Fire TV.
- Website: https://bookarc.app/reader
- Support: hello@bookarc.app
- Privacy: https://bookarc.app/reader-privacy
- Terms: https://bookarc.app/reader-terms
- DRM: leave disabled for this free reader. Preserve the signing choice across later updates.
- Territories: use BookArc's existing Play distribution territories, subject to content rights.
- Audience: general readership aged 13+, based on the reader privacy policy; not child-directed.
  Complete Amazon's content-rating questionnaire for the actual discoverable catalogue,
  author-provided content, and user imports. Do not equate the intended audience with a rating.

## Privacy questionnaire preparation

Answer Yes to collection of user data. Free pricing does not mean no data collection.
Confirm these mappings against the production backend and enabled SDKs before submitting:

| Data | Intended purpose |
| --- | --- |
| Email, optional name, account/profile identifiers | Account access, library delivery, support |
| Library, progress, bookmarks, notes and highlights when synced | App functionality and personal settings |
| Delivery/download events and service usage | Delivery operation and analytics |
| IP, device/browser information, approximate region | Security, operation and compatibility |
| Support correspondence | Support |

Review analytics SDK configuration, author-facing delivery reporting, and service providers
when answering transfer questions. Do not mark all third-party transfers No without that check.
Payment details from the separate author service are not collected by this free reader edition.
Account deletion remains in the app. The published policy also provides hello@bookarc.app for
deletion requests and describes deletion within 60 days.

Sources: [BookArc reader privacy](https://bookarc.app/reader-privacy),
[Amazon privacy labels](https://developer.amazon.com/docs/app-submission/appstore-privacy-labels.html).

## Reviewer access

Create a dedicated reader account through the normal free registration flow. Verify its email,
seed it with rights-cleared sample ebooks and an audiobook, and confirm sign-in on the release APK.
Enter its email/password in Amazon's private testing-instructions fields, never in this repository.
Provide a working non-expiring test claim code through the same private fields if claim testing needs it.

Reviewer instructions:

1. Open BookArc; sign in with the supplied test account, or create a free reader account.
2. Open Library and select a sample book. Turn pages, add a bookmark, then reopen the book.
3. Download a sample and read it after disconnecting the device from the network.
4. Open Discover for free classics, or use the supplied claim code to add a sample author's book.
5. Open the sample audiobook and test playback. Use account settings to test sync and account actions.
6. There are no paid features, purchase flows, or subscription requirements.

## Images

Prepared icons: `images/icon-114.png` and `images/icon-512.png`, exported from the existing app icon.
Three reviewed tablet web previews are in `previews/`; see their README for capture provenance.
Required screenshots: 3–10 real tablet app screens, PNG/JPEG, using an Amazon-supported size
(for example 800×1280 or 1280×800). Capture Library, Reader, and Discover; add an audiobook screen
when available. Use fictional reviewer data and rights-cleared content.

Use `pnpm amazon:screenshot --artifact dist/amazon/<version>-<code> --name library --serial DEVICE`
after navigating a tested Fire tablet to each screen. The helper verifies the device and installed
app version and records the system WebView for the test record. No Fire tablet was attached during
implementation, so Fire screenshots must still be captured before submission.

Source: [Amazon listing and image requirements](https://developer.amazon.com/docs/app-submission/appstore-details.html).
