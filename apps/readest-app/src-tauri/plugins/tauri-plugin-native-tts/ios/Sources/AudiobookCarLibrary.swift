import Foundation

/// Native-side cache of the audiobook browse data the webview pushes down
/// (car bridge). CarPlay serves its lists from here instantly and offline;
/// play requests flow back to the webview through `playHandler`, which the
/// plugin wires to a `trigger("audiobook-play")` event.
public final class AudiobookCarLibrary {
  public struct Book: Codable {
    public let id: String
    public let title: String
    public let author: String
    public let durationSec: Double
  }

  public struct Chapter: Codable {
    public let index: Int
    public let label: String
  }

  public struct PlaybackCue: Codable {
    public let offsetMs: Int64
    public let text: String
  }

  public struct PlaybackSegment: Codable {
    public let path: String
    public let clipBeginMs: Int64
    public let clipEndMs: Int64
    public let cues: [PlaybackCue]
  }

  public struct PlaybackSection: Codable {
    public let sectionIndex: Int
    public let label: String
    public let durationMs: Int64
    public let segments: [PlaybackSegment]
  }

  public struct PlaybackManifest: Codable {
    public let bookId: String
    public let title: String
    public let author: String
    public let coverPath: String?
    public let currentSectionIndex: Int?
    public let sections: [PlaybackSection]
  }

  public struct PlaybackProgress: Codable {
    public let bookId: String
    public let sectionIndex: Int
    public let positionMs: Int64
  }

  public static let shared = AudiobookCarLibrary()
  public static let changedNotification = Notification.Name("AudiobookCarLibraryChanged")

  private let queue = DispatchQueue(label: "audiobook-car-library")
  private let defaults: UserDefaults
  private var _books: [Book] = []
  private var _chapters: [String: [Chapter]] = [:]
  private var _playbackManifests: [String: PlaybackManifest] = [:]
  private var _playbackProgress: [String: PlaybackProgress] = [:]

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    _books = Self.decode([Book].self, from: defaults.data(forKey: Keys.books)) ?? []
    _chapters =
      Self.decode([String: [Chapter]].self, from: defaults.data(forKey: Keys.chapters)) ?? [:]
    _playbackManifests =
      Self.decode(
        [String: PlaybackManifest].self,
        from: defaults.data(forKey: Keys.playbackManifests)
      ) ?? [:]
    _playbackProgress =
      Self.decode(
        [String: PlaybackProgress].self,
        from: defaults.data(forKey: Keys.playbackProgress)
      ) ?? [:]
  }

  /// Set by the plugin; called from CarPlay with (bookId, chapterIndex?).
  public var playHandler: ((String, Int?) -> Void)?

  public var books: [Book] {
    queue.sync { _books }
  }

  public func chapters(for bookId: String) -> [Chapter] {
    queue.sync { _chapters[bookId] ?? [] }
  }

  public func updateBooks(_ books: [Book]) {
    queue.sync {
      _books = books
      persist(books, key: Keys.books)
    }
    NotificationCenter.default.post(name: Self.changedNotification, object: nil)
  }

  public func updateChapters(bookId: String, chapters: [Chapter]) {
    queue.sync {
      _chapters[bookId] = chapters
      persist(_chapters, key: Keys.chapters)
    }
    NotificationCenter.default.post(name: Self.changedNotification, object: nil)
  }

  public func updatePlaybackManifest(_ manifest: PlaybackManifest) {
    queue.sync {
      _playbackManifests[manifest.bookId] = manifest
      persist(_playbackManifests, key: Keys.playbackManifests)
    }
    NotificationCenter.default.post(name: Self.changedNotification, object: nil)
  }

  public func playbackManifest(for bookId: String) -> PlaybackManifest? {
    queue.sync { _playbackManifests[bookId] }
  }

  public func updatePlaybackProgress(bookId: String, sectionIndex: Int, positionMs: Int64) {
    queue.sync {
      _playbackProgress[bookId] = PlaybackProgress(
        bookId: bookId,
        sectionIndex: sectionIndex,
        positionMs: positionMs
      )
      persist(_playbackProgress, key: Keys.playbackProgress)
    }
  }

  public func playbackProgress(for bookId: String) -> PlaybackProgress? {
    queue.sync { _playbackProgress[bookId] }
  }

  public func requestPlay(bookId: String, chapterIndex: Int?) {
    playHandler?(bookId, chapterIndex)
  }

  private func persist<T: Encodable>(_ value: T, key: String) {
    defaults.set(try? JSONEncoder().encode(value), forKey: key)
  }

  private static func decode<T: Decodable>(_ type: T.Type, from data: Data?) -> T? {
    guard let data else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }

  private enum Keys {
    static let books = "bookarc.car.books"
    static let chapters = "bookarc.car.chapters"
    static let playbackManifests = "bookarc.car.playback-manifests"
    static let playbackProgress = "bookarc.car.playback-progress"
  }
}
