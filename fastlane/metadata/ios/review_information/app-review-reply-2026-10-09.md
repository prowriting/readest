Hello, and thank you for the review. Here is the information requested.

1. Screen recording
Attached: a recording on an iPhone running iOS 26 that starts at launch and shows claiming a book with a code, reading it, playing an audiobook (including the lock screen controls), browsing Discover, signing in with Apple, and deleting the account from Library > menu > Account > Delete Account.

2. Purpose and audience
BookArc lets authors send their books and audiobooks directly to readers. An author creates a claim code on the BookArc author platform (author.bookarc.app) and shares it with readers, for example as a launch gift, an advance review copy, or a bonus for newsletter subscribers. Readers enter the code in the app to add the book to their library and read or listen to it. The app also offers a catalog of free public-domain classics.
The audience is adult readers of fiction and non-fiction who follow independent authors, and the authors who want a direct, low-cost way to deliver books to them. The app is free for readers, with no in-app purchases, subscriptions, or ads.

3. Setup and access
No account or login is required. On launch the app opens to the Library.
- Claim tab: enter a single-use claim code to add a book. "Pride and Prejudice" (ebook): 3QF7ZHZ, SJE7EPT, 36D7KY6. "Moby-Dick" (audiobook): 9R8EBWR.
- Library tab: open the claimed book to read, or open "Moby-Dick" to listen. Audio continues in the background and on the lock screen, and the app supports CarPlay as an audio app.
- Discover tab: browse and open free classics.
- Optional: Sign in with Apple (any Apple account) from Library > "Sign in to sync your library" to sync the library and reading progress across devices. Account deletion is under Library > menu > Account > Delete Account; it removes the account and all cloud data and revokes the Sign in with Apple token.

4. External services
- BookArc Reader API (our own service, hosted on Microsoft Azure): accounts, library sync, claim-code redemption, and book delivery.
- BookArc author platform (our own service, Azure): where authors upload books and create claim codes.
- Microsoft Azure Blob Storage and Azure SQL: storage for book files and account data.
- Sign in with Apple and Google Sign-In: optional authentication.
- PostHog: opt-in, anonymized product analytics and crash reports.
- SendGrid: account confirmation and password reset emails.
- Optional integrations the reader can turn on in Settings: Readwise and Hardcover (export highlights and reading status), KOReader sync, and WebDAV.

5. Regional differences
The app works the same in all regions. Content availability depends only on which claim codes a reader has; the public-domain catalog is the same everywhere.

6. Third-party content
Books delivered by claim code are uploaded by their authors or publishers, who confirm they hold the rights when they upload. Authors decide who receives a code, and each copy is watermarked for the recipient. The Discover catalog contains only public-domain works (for example from Project Gutenberg and Standard Ebooks). Our terms are at https://bookarc.app/reader-terms and our privacy policy at https://bookarc.app/reader-privacy.

Thank you,
Chris Banks
Orpheus Technology Ltd
