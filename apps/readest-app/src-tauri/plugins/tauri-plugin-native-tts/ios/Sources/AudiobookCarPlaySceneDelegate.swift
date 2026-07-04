import CarPlay
import Foundation

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
  private var observer: NSObjectProtocol?

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    observer = NotificationCenter.default.addObserver(
      forName: AudiobookCarLibrary.changedNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.refreshRootTemplate()
    }
    refreshRootTemplate()
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
    self.interfaceController = nil
  }

  private func refreshRootTemplate() {
    guard let interfaceController else { return }
    let books = AudiobookCarLibrary.shared.books
    let items = books.map { book -> CPListItem in
      let item = CPListItem(text: book.title, detailText: book.author)
      item.handler = { [weak self] _, completion in
        self?.openBook(book)
        completion()
      }
      return item
    }
    let section = CPListSection(items: items)
    let template = CPListTemplate(title: "Audiobooks", sections: [section])
    template.emptyViewTitleVariants = ["No audiobooks yet"]
    template.emptyViewSubtitleVariants = ["Audiobooks from your library appear here"]
    interfaceController.setRootTemplate(template, animated: false, completion: nil)
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
    let playAll = CPListItem(text: "Resume", detailText: book.title)
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
    AudiobookCarLibrary.shared.requestPlay(bookId: bookId, chapterIndex: chapterIndex)
    interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
  }
}
