import AVKit
import SwiftRs
import Tauri
import UIKit
import WebKit

class PingArgs: Decodable {
  let value: String?
}

class BridgeBookArgs: Decodable {
  let id: String
  let title: String?
  let author: String?
  let durationSec: Double?
}

class UpdateAudiobookLibraryArgs: Decodable {
  let books: [BridgeBookArgs]?
}

class BridgeChapterArgs: Decodable {
  let index: Int
  let label: String?
}

class UpdateAudiobookChaptersArgs: Decodable {
  let bookId: String
  let chapters: [BridgeChapterArgs]?
  let currentIndex: Int?
}

class CarPlaybackCueArgs: Decodable {
  let offsetMs: Int64
  let text: String
}

class CarPlaybackSegmentArgs: Decodable {
  let href: String
  let type: String
  let path: String
  let clipBeginMs: Int64
  let clipEndMs: Int64
  let sourceDurationMs: Int64
  let cues: [CarPlaybackCueArgs]?
}

class CarPlaybackSectionArgs: Decodable {
  let sectionIndex: Int
  let label: String?
  let durationMs: Int64?
  let segments: [CarPlaybackSegmentArgs]?
}

class UpdateAudiobookPlaybackManifestArgs: Decodable {
  let bookId: String
  let title: String?
  let author: String?
  let coverPath: String?
  let sections: [CarPlaybackSectionArgs]?
}

class LocatorLocationsArgs: Decodable {
  let fragments: [String]
  let progression: Double?
  let totalProgression: Double?
}

class LocatorArgs: Decodable {
  let href: String
  let type: String
  let title: String?
  let locations: LocatorLocationsArgs
}

class PlaybackLocationArgs: Decodable {
  let schemaVersion: Int
  let editionId: String
  let locator: LocatorArgs
  let textLocator: LocatorArgs?
  let updatedAt: Int64
}

class UpdateAudiobookPlaybackLocationArgs: Decodable {
  let location: PlaybackLocationArgs
}

class GetAudiobookPlaybackLocationArgs: Decodable {
  let bookId: String
}

class TakeAudiobookPendingBookmarksArgs: Decodable {
  let bookId: String
}

class AudiobookPlaybackCommandArgs: Decodable {
  let action: String
  let bookId: String?
  let location: PlaybackLocationArgs?
  let chapterIndex: Int?
  let offsetMs: Int64?
  let rate: Float?
  let volume: Float?
  let mode: String?
  let endsAt: Int64?
}

class NativeTTSPlugin: Plugin {
  public override func load(webview: WKWebView) {
    ReaderWindowSceneDelegate.register(webView: webview)
    if #available(iOS 14.0, *) {
      // Plist-only references are stripped from the static Swift library in
      // release builds. Keep both UIKit entry points linked and diagnosable.
      NSLog("BookArc scene delegates: %@, %@",
        NSStringFromClass(ReaderWindowSceneDelegate.self),
        NSStringFromClass(AudiobookCarPlaySceneDelegate.self))
      AudiobookCarPlayer.shared.stateHandler = { [weak self] snapshot in
        self?.trigger(
          "audiobook-playback-state",
          data: JSTypes.coerceDictionaryToJSObject(snapshot) ?? [:]
        )
      }
    }
  }

  @objc public func ping(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PingArgs.self)
    invoke.resolve(["value": args.value ?? ""])
  }

  @objc public func update_audiobook_library(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateAudiobookLibraryArgs.self)
    let books = (args.books ?? []).map { book in
      AudiobookCarLibrary.Book(
        id: book.id,
        title: book.title ?? "",
        author: book.author ?? "",
        durationSec: book.durationSec ?? 0
      )
    }
    AudiobookCarLibrary.shared.updateBooks(books)
    invoke.resolve()
  }

  @objc public func show_audio_route_picker(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      // AVRoutePickerView is a button, not an API: attach it off-screen and
      // press it. This presents the system AirPlay/output sheet, which then
      // routes the WKWebView's audio at the OS level.
      guard
        let window = UIApplication.shared.connectedScenes
          .compactMap({ $0 as? UIWindowScene })
          .flatMap({ $0.windows })
          .first(where: { $0.isKeyWindow })
      else { return }
      let picker = AVRoutePickerView(frame: CGRect(x: -100, y: -100, width: 44, height: 44))
      picker.alpha = 0.01
      window.addSubview(picker)
      if let button = picker.subviews.compactMap({ $0 as? UIButton }).first {
        button.sendActions(for: .touchUpInside)
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        picker.removeFromSuperview()
      }
    }
    invoke.resolve()
  }

  @objc public func update_audiobook_chapters(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateAudiobookChaptersArgs.self)
    let chapters = (args.chapters ?? []).map { chapter in
      AudiobookCarLibrary.Chapter(index: chapter.index, label: chapter.label ?? "")
    }
    AudiobookCarLibrary.shared.updateChapters(bookId: args.bookId, chapters: chapters)
    invoke.resolve()
  }

  @objc public func update_audiobook_playback_manifest(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateAudiobookPlaybackManifestArgs.self)
    let sections = (args.sections ?? []).map { section in
      AudiobookCarLibrary.PlaybackSection(
        sectionIndex: section.sectionIndex,
        label: section.label ?? "",
        durationMs: section.durationMs ?? 0,
        segments: (section.segments ?? []).map { segment in
          AudiobookCarLibrary.PlaybackSegment(
            href: segment.href,
            type: segment.type,
            path: segment.path,
            clipBeginMs: segment.clipBeginMs,
            clipEndMs: segment.clipEndMs,
            sourceDurationMs: segment.sourceDurationMs,
            cues: (segment.cues ?? []).map { cue in
              AudiobookCarLibrary.PlaybackCue(offsetMs: cue.offsetMs, text: cue.text)
            }
          )
        }
      )
    }
    AudiobookCarLibrary.shared.updatePlaybackManifest(
      AudiobookCarLibrary.PlaybackManifest(
        bookId: args.bookId,
        title: args.title ?? "",
        author: args.author ?? "",
        coverPath: args.coverPath,
        sections: sections
      )
    )
    invoke.resolve()
  }

  private func makeLocator(_ args: LocatorArgs) -> AudiobookCarLibrary.Locator {
    .init(
      href: args.href,
      type: args.type,
      title: args.title,
      locations: .init(
        fragments: args.locations.fragments,
        progression: args.locations.progression,
        totalProgression: args.locations.totalProgression
      )
    )
  }

  private func makePlaybackLocation(
    _ args: PlaybackLocationArgs?
  ) -> AudiobookCarLibrary.PlaybackLocation? {
    guard let args, args.schemaVersion == 2, !args.editionId.isEmpty else { return nil }
    return .init(
      schemaVersion: 2,
      editionId: args.editionId,
      locator: makeLocator(args.locator),
      textLocator: args.textLocator.map(makeLocator),
      updatedAt: args.updatedAt
    )
  }

  @objc public func update_audiobook_playback_location(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateAudiobookPlaybackLocationArgs.self)
    guard args.location.schemaVersion == 2, args.location.editionId.isEmpty == false else {
      invoke.reject("valid Readium playback location is required")
      return
    }
    AudiobookCarLibrary.shared.updatePlaybackLocation(
      .init(
        schemaVersion: 2,
        editionId: args.location.editionId,
        locator: makeLocator(args.location.locator),
        textLocator: args.location.textLocator.map(makeLocator),
        updatedAt: args.location.updatedAt
      )
    )
    invoke.resolve()
  }

  @objc public func get_audiobook_playback_location(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GetAudiobookPlaybackLocationArgs.self)
    guard #available(iOS 14.0, *),
      let location = AudiobookCarPlayer.shared.playbackLocation(for: args.bookId),
      let data = try? JSONEncoder().encode(location),
      let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      invoke.resolve([:])
      return
    }
    invoke.resolve(["location": dictionary])
  }

  @objc public func take_audiobook_pending_bookmarks(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TakeAudiobookPendingBookmarksArgs.self)
    let locations = AudiobookCarLibrary.shared.takePendingBookmarks(for: args.bookId)
    let dictionaries: [[String: Any]] = locations.compactMap { location in
      guard let data = try? JSONEncoder().encode(location) else { return nil }
      return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
    invoke.resolve(["locations": dictionaries])
  }

  @objc public func control_audiobook_playback(_ invoke: Invoke) throws {
    guard #available(iOS 14.0, *) else {
      invoke.reject("Native audiobook playback requires iOS 14")
      return
    }
    let args = try invoke.parseArgs(AudiobookPlaybackCommandArgs.self)
    let location = makePlaybackLocation(args.location)
    if args.location != nil, location == nil {
      invoke.reject("valid Readium playback location is required")
      return
    }
    let result = AudiobookCarPlayer.shared.control(
      action: args.action,
      bookId: args.bookId,
      location: location,
      chapterIndex: args.chapterIndex,
      offsetMs: args.offsetMs,
      rate: args.rate,
      volume: args.volume,
      mode: args.mode,
      endsAt: args.endsAt
    )
    invoke.resolve(JSTypes.coerceDictionaryToJSObject(result) ?? [:])
  }

  @objc public func get_audiobook_playback_snapshot(_ invoke: Invoke) throws {
    guard #available(iOS 14.0, *) else {
      invoke.reject("Native audiobook playback requires iOS 14")
      return
    }
    invoke.resolve(
      JSTypes.coerceDictionaryToJSObject(AudiobookCarPlayer.shared.snapshot()) ?? [:]
    )
  }
}

@_cdecl("init_plugin_native_tts")
func initPlugin() -> Plugin {
  return NativeTTSPlugin()
}
