import Foundation

/// Native-side cache of the audiobook browse data the webview pushes down
/// (car bridge). CarPlay serves its lists from here instantly and offline;
/// play requests flow back to the webview through `playHandler`, which the
/// plugin wires to a `trigger("audiobook-play")` event.
public final class AudiobookCarLibrary {
  public struct Book {
    public let id: String
    public let title: String
    public let author: String
    public let durationSec: Double
  }

  public struct Chapter {
    public let index: Int
    public let label: String
  }

  public static let shared = AudiobookCarLibrary()
  public static let changedNotification = Notification.Name("AudiobookCarLibraryChanged")

  private let queue = DispatchQueue(label: "audiobook-car-library")
  private var _books: [Book] = []
  private var _chaptersBookId: String?
  private var _chapters: [Chapter] = []

  /// Set by the plugin; called from CarPlay with (bookId, chapterIndex?).
  public var playHandler: ((String, Int?) -> Void)?

  public var books: [Book] {
    queue.sync { _books }
  }

  public func chapters(for bookId: String) -> [Chapter] {
    queue.sync { _chaptersBookId == bookId ? _chapters : [] }
  }

  public func updateBooks(_ books: [Book]) {
    queue.sync { _books = books }
    NotificationCenter.default.post(name: Self.changedNotification, object: nil)
  }

  public func updateChapters(bookId: String, chapters: [Chapter]) {
    queue.sync {
      _chaptersBookId = bookId
      _chapters = chapters
    }
    NotificationCenter.default.post(name: Self.changedNotification, object: nil)
  }

  public func requestPlay(bookId: String, chapterIndex: Int?) {
    playHandler?(bookId, chapterIndex)
  }
}
