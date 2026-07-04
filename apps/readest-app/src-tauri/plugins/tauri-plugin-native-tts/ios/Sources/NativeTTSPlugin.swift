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

class NativeTTSPlugin: Plugin {
  public override func load(webview: WKWebView) {
    // CarPlay play requests flow back to the webview as plugin events.
    AudiobookCarLibrary.shared.playHandler = { [weak self] bookId, chapterIndex in
      var data: JSObject = [:]
      data["bookId"] = bookId
      if let chapterIndex {
        data["chapterIndex"] = chapterIndex
      }
      self?.trigger("audiobook-play", data: data)
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
}

@_cdecl("init_plugin_native_tts")
func initPlugin() -> Plugin {
  return NativeTTSPlugin()
}
