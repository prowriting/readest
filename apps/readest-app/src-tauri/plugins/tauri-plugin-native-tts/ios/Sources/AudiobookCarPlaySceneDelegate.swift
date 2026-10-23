import CarPlay
import Foundation
import UIKit

/// CarPlay audio-app scene. Referenced from the app's Info.plist scene
/// manifest by its module-qualified name
/// (`tauri_plugin_native_tts.AudiobookCarPlaySceneDelegate`), so all CarPlay
/// code stays in this tracked plugin rather than the generated app project.
///
/// Layout follows Apple's driving-distraction rules: one shallow list
/// (most-recent audiobooks first), an optional chapter level, large
/// tappable rows, no free text input, playback handed to the system
/// Now Playing template.
@available(iOS 14.0, *)
public class AudiobookCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  private var interfaceController: CPInterfaceController?
  private var libraryObserver: NSObjectProtocol?
  private var bookmarkObserver: NSObjectProtocol?
  private var displayedBookmarkState: Bool?
  private(set) var audiobooksTemplate: CPListTemplate?

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    libraryObserver = NotificationCenter.default.addObserver(
      forName: AudiobookCarLibrary.changedNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.refreshRootTemplate()
    }
    bookmarkObserver = NotificationCenter.default.addObserver(
      forName: AudiobookCarPlayer.bookmarkStateDidChangeNotification,
      object: AudiobookCarPlayer.shared,
      queue: .main
    ) { [weak self] notification in
      guard let isBookmarked = notification.userInfo?["isBookmarked"] as? Bool else { return }
      self?.configureNowPlayingButtons(isBookmarked: isBookmarked)
    }
    let isBookmarked = AudiobookCarPlayer.shared.snapshot()["isBookmarked"] as? Bool ?? false
    configureNowPlayingButtons(isBookmarked: isBookmarked)
    refreshRootTemplate()
  }

  private func configureNowPlayingButtons(isBookmarked: Bool) {
    guard displayedBookmarkState != isBookmarked else { return }
    displayedBookmarkState = isBookmarked
    let rate = CPNowPlayingPlaybackRateButton { _ in
      _ = AudiobookCarPlayer.shared.cyclePlaybackRateOrRequestWeb()
    }
    let bookmarkImage =
      UIImage(systemName: isBookmarked ? "bookmark.fill" : "bookmark") ?? UIImage()
    let bookmark = CPNowPlayingImageButton(image: bookmarkImage) { _ in
      _ = AudiobookCarPlayer.shared.addBookmarkOrRequestWeb()
    }
    CPNowPlayingTemplate.shared.updateNowPlayingButtons([rate, bookmark])
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    AudiobookCarPlayer.shared.persistProgress()
    if let libraryObserver {
      NotificationCenter.default.removeObserver(libraryObserver)
    }
    if let bookmarkObserver {
      NotificationCenter.default.removeObserver(bookmarkObserver)
    }
    libraryObserver = nil
    bookmarkObserver = nil
    displayedBookmarkState = nil
    audiobooksTemplate = nil
    self.interfaceController = nil
  }

  func refreshRootTemplate() {
    let books = AudiobookCarLibrary.shared.books
    let items = books.map { book -> CPListItem in
      let cover = AudiobookCarLibrary.shared.playbackManifest(for: book.id)?.coverPath
        .flatMap(UIImage.init(contentsOfFile:))
      let item = CPListItem(text: book.title, detailText: book.author, image: cover)
      item.handler = { [weak self] _, completion in
        self?.openBook(book)
        completion()
      }
      return item
    }
    let section = CPListSection(items: items)
    if let audiobooksTemplate {
      // Replacing the root clears the stack, dismissing Now Playing or
      // chapters whenever the phone republishes its library during playback.
      audiobooksTemplate.updateSections([section])
      return
    }
    let template = CPListTemplate(title: "Audiobooks", sections: [section])
    template.emptyViewTitleVariants = ["No audiobooks yet"]
    template.emptyViewSubtitleVariants = ["Audiobooks from your library appear here"]
    audiobooksTemplate = template
    interfaceController?.setRootTemplate(template, animated: false, completion: nil)
  }

  private func openBook(_ book: AudiobookCarLibrary.Book) {
    guard let interfaceController else { return }
    let chapters = AudiobookCarLibrary.shared.chapters(for: book.id)
    if chapters.isEmpty {
      playAndShowNowPlaying(bookId: book.id, chapterIndex: nil)
      return
    }
    let items = chapters.map { chapter -> CPListItem in
      let item = CPListItem(text: chapter.label, detailText: nil)
      item.handler = { [weak self] _, completion in
        self?.playAndShowNowPlaying(bookId: book.id, chapterIndex: chapter.index)
        completion()
      }
      return item
    }
    let canResume = AudiobookCarLibrary.shared.playbackLocation(for: book.id) != nil
    let playAll = CPListItem(text: canResume ? "Resume" : "Play", detailText: book.title)
    playAll.handler = { [weak self] _, completion in
      self?.playAndShowNowPlaying(bookId: book.id, chapterIndex: nil)
      completion()
    }
    let template = CPListTemplate(
      title: book.title,
      sections: [CPListSection(items: [playAll]), CPListSection(items: items)]
    )
    interfaceController.pushTemplate(template, animated: true, completion: nil)
  }

  private func playAndShowNowPlaying(bookId: String, chapterIndex: Int?) {
    _ = AudiobookCarPlayer.shared.play(bookId: bookId, chapterIndex: chapterIndex)
    interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
  }
}
