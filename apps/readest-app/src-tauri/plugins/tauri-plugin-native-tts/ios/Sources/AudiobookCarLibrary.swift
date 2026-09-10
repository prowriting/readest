import Foundation

/// Native-side cache of the audiobook browse data the webview pushes down
/// (car bridge). CarPlay serves its lists and native playback manifests from
/// here instantly and offline.
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
    public let href: String
    public let type: String
    public let path: String
    public let clipBeginMs: Int64
    public let clipEndMs: Int64
    public let sourceDurationMs: Int64
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
    public let sections: [PlaybackSection]
  }

  public struct LocatorLocations: Codable {
    public let fragments: [String]
    public let progression: Double?
    public let totalProgression: Double?
  }

  public struct Locator: Codable {
    public let href: String
    public let type: String
    public let title: String?
    public let locations: LocatorLocations
  }

  public struct PlaybackLocation: Codable {
    public let schemaVersion: Int
    public let editionId: String
    public let locator: Locator
    public let textLocator: Locator?
    public let updatedAt: Int64
  }

  public static let shared = AudiobookCarLibrary()
  public static let changedNotification = Notification.Name("AudiobookCarLibraryChanged")

  private let queue = DispatchQueue(label: "audiobook-car-library")
  private let defaults: UserDefaults
  private var _books: [Book] = []
  private var _chapters: [String: [Chapter]] = [:]
  private var _playbackManifests: [String: PlaybackManifest] = [:]
  private var _playbackLocations: [String: PlaybackLocation] = [:]
  private var _pendingBookmarks: [String: [PlaybackLocation]] = [:]

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
    _playbackLocations =
      Self.decode(
        [String: PlaybackLocation].self,
        from: defaults.data(forKey: Keys.playbackLocations)
      ) ?? [:]
    _pendingBookmarks =
      Self.decode(
        [String: [PlaybackLocation]].self,
        from: defaults.data(forKey: Keys.pendingBookmarks)
      ) ?? [:]
  }

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

  public func updatePlaybackLocation(_ location: PlaybackLocation) {
    guard location.schemaVersion == 2, location.editionId.isEmpty == false else { return }
    queue.sync {
      if let existing = _playbackLocations[location.editionId],
        existing.updatedAt >= location.updatedAt
      {
        return
      }
      _playbackLocations[location.editionId] = location
      persist(_playbackLocations, key: Keys.playbackLocations)
    }
  }

  public func playbackLocation(for bookId: String) -> PlaybackLocation? {
    queue.sync { _playbackLocations[bookId] }
  }

  public func addPendingBookmark(_ location: PlaybackLocation) {
    guard location.schemaVersion == 2, location.editionId.isEmpty == false else { return }
    queue.sync {
      var bookmarks = _pendingBookmarks[location.editionId] ?? []
      let audioKey = location.locator.href + "#" + (location.locator.locations.fragments.first ?? "")
      let textKey = location.textLocator.map {
        $0.href + "#" + ($0.locations.fragments.first ?? "")
      }
      let duplicate = bookmarks.contains { existing in
        let existingAudio = existing.locator.href + "#"
          + (existing.locator.locations.fragments.first ?? "")
        let existingText = existing.textLocator.map {
          $0.href + "#" + ($0.locations.fragments.first ?? "")
        }
        return (textKey != nil && existingText == textKey) || existingAudio == audioKey
      }
      guard !duplicate else { return }
      bookmarks.append(location)
      _pendingBookmarks[location.editionId] = bookmarks
      persist(_pendingBookmarks, key: Keys.pendingBookmarks)
    }
  }

  public func takePendingBookmarks(for bookId: String) -> [PlaybackLocation] {
    queue.sync {
      let bookmarks = _pendingBookmarks.removeValue(forKey: bookId) ?? []
      if !bookmarks.isEmpty { persist(_pendingBookmarks, key: Keys.pendingBookmarks) }
      return bookmarks
    }
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
    static let playbackLocations = "bookarc.car.playback-locations-v2"
    static let pendingBookmarks = "bookarc.car.pending-bookmarks-v2"
  }
}
