import XCTest

@testable import tauri_plugin_native_tts

final class CarPlaybackTimelineTests: XCTestCase {
  private let entries = [
    CarPlaybackQueueEntry(sectionIndex: 3, segmentIndex: 0, durationMs: 4_000),
    CarPlaybackQueueEntry(sectionIndex: 3, segmentIndex: 1, durationMs: 6_000),
    CarPlaybackQueueEntry(sectionIndex: 7, segmentIndex: 0, durationMs: 5_000),
  ]

  func testStartsAtRequestedChapterAndFallsBackToSavedChapter() {
    XCTAssertEqual(CarPlaybackTimeline.startIndex(entries, requestedSection: 7, savedSection: 3), 2)
    XCTAssertEqual(
      CarPlaybackTimeline.startIndex(entries, requestedSection: nil, savedSection: 3), 0)
    XCTAssertEqual(
      CarPlaybackTimeline.startIndex(entries, requestedSection: 99, savedSection: 3), 0)
  }

  func testMapsChapterPositionAcrossAudioSegments() {
    XCTAssertEqual(
      CarPlaybackTimeline.chapterPosition(entries, itemIndex: 1, itemPositionMs: 1_250),
      5_250
    )
    XCTAssertEqual(CarPlaybackTimeline.chapterDuration(entries, itemIndex: 1), 10_000)
  }

  func testMapsChapterSeekAndPreviousNextChapter() {
    XCTAssertEqual(
      CarPlaybackTimeline.seekTarget(entries, itemIndex: 0, chapterPositionMs: 7_000),
      CarPlaybackSeekTarget(itemIndex: 1, positionMs: 3_000)
    )
    XCTAssertEqual(CarPlaybackTimeline.adjacentChapterStart(entries, itemIndex: 1, direction: 1), 2)
    XCTAssertEqual(
      CarPlaybackTimeline.adjacentChapterStart(entries, itemIndex: 2, direction: -1), 0)
  }
}

final class AudiobookCarLibraryPersistenceTests: XCTestCase {
  func testPersistsBrowseDataAndPlaybackManifestForColdCarPlayLaunch() throws {
    let suiteName = "AudiobookCarLibraryTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let library = AudiobookCarLibrary(defaults: defaults)
    library.updateBooks([
      .init(id: "book-1", title: "Book", author: "Author", durationSec: 10)
    ])
    library.updateChapters(
      bookId: "book-1",
      chapters: [
        .init(index: 3, label: "Chapter One")
      ])
    library.updatePlaybackManifest(
      .init(
        bookId: "book-1",
        title: "Book",
        author: "Author",
        coverPath: "/tmp/cover.jpg",
        currentSectionIndex: 3,
        sections: [
          .init(
            sectionIndex: 3,
            label: "Chapter One",
            durationMs: 10_000,
            segments: [
              .init(
                path: "/tmp/audio.mp3",
                clipBeginMs: 1_000,
                clipEndMs: 11_000,
                cues: [.init(offsetMs: 0, text: "text/ch1.xhtml#p1")]
              )
            ]
          )
        ]
      )
    )
    library.updatePlaybackProgress(bookId: "book-1", sectionIndex: 3, positionMs: 4_250)

    let restored = AudiobookCarLibrary(defaults: defaults)
    XCTAssertEqual(restored.books.first?.id, "book-1")
    XCTAssertEqual(restored.chapters(for: "book-1").first?.index, 3)
    XCTAssertEqual(restored.playbackManifest(for: "book-1")?.sections.first?.durationMs, 10_000)
    XCTAssertEqual(restored.playbackProgress(for: "book-1")?.positionMs, 4_250)
  }
}
