import XCTest
import AVFoundation
import MediaPlayer

@testable import tauri_plugin_native_tts

@available(iOS 14.0, *)
private final class FakeAudiobookAVPlayer: AudiobookAVPlayer {
  var currentItem: AVPlayerItem?
  var rate: Float = 0
  var volume: Float = 1
  var clock = CMTime.zero
  private var periodicTimeObserver: (@Sendable (CMTime) -> Void)?

  func replaceCurrentItem(with item: AVPlayerItem?) {
    currentItem = item
    if item == nil { clock = .zero }
  }
  func seek(
    to time: CMTime,
    toleranceBefore: CMTime,
    toleranceAfter: CMTime,
    completionHandler: @escaping @Sendable (Bool) -> Void
  ) {
    clock = time
    completionHandler(true)
  }
  func playImmediately(atRate rate: Float) { self.rate = rate }
  func pause() { rate = 0 }
  func currentTime() -> CMTime { clock }
  func addPeriodicTimeObserver(
    forInterval interval: CMTime,
    queue: dispatch_queue_t?,
    using block: @escaping @Sendable (CMTime) -> Void
  ) -> Any {
    periodicTimeObserver = block
    return NSObject()
  }
  func removeTimeObserver(_ observer: Any) { periodicTimeObserver = nil }

  func advanceClock(to milliseconds: Int64) {
    clock = CMTime(value: milliseconds, timescale: 1_000)
    periodicTimeObserver?(clock)
  }
}

@available(iOS 14.0, *)
final class AudiobookCarPlayerCommandTests: XCTestCase {
  func testSharedAudiobookPlaybackContract() throws {
    let contract = try loadPlaybackContract()
    let availableBookId = try XCTUnwrap(contract["availableBookId"] as? String)
    let durationMs = try XCTUnwrap(contract["durationMs"] as? NSNumber).int64Value
    let scenarios = try XCTUnwrap(contract["scenarios"] as? [[String: Any]])

    for scenario in scenarios {
      let scenarioId = try XCTUnwrap(scenario["id"] as? String)
      let fixture = try makePlayer(bookId: availableBookId, durationMs: durationMs)
      defer { fixture.cleanup() }
      fixture.library.updatePlaybackManifest(
        .init(
          bookId: availableBookId, title: "Book", author: "Author", coverPath: nil,
          sections: [
            contractSection(
              index: 0, href: "audio/chapter.mp3", text: "text/chapter.xhtml#p1",
              file: fixture.file, durationMs: durationMs),
            contractSection(
              index: 1, href: "audio/chapter-2.mp3", text: "text/chapter-2.xhtml#p1",
              file: fixture.file, durationMs: durationMs),
          ])
      )
      var result = fixture.player.snapshot()
      for command in try XCTUnwrap(scenario["commands"] as? [[String: Any]]) {
        result = fixture.player.control(
          action: try XCTUnwrap(command["action"] as? String),
          bookId: command["bookId"] as? String,
          location: try decodePlaybackLocation(command["location"]),
          chapterIndex: (command["chapterIndex"] as? NSNumber)?.intValue,
          offsetMs: (command["offsetMs"] as? NSNumber)?.int64Value,
          rate: (command["rate"] as? NSNumber)?.floatValue,
          volume: (command["volume"] as? NSNumber)?.floatValue,
          mode: command["mode"] as? String,
          endsAt: (command["endsAt"] as? NSNumber)?.int64Value
        )
      }

      let expected = try XCTUnwrap(scenario["expected"] as? [String: Any])
      XCTAssertEqual(result["bookId"] as? String, expected["bookId"] as? String, scenarioId)
      XCTAssertEqual(result["state"] as? String, expected["state"] as? String, scenarioId)
      if let error = expected["error"] as? String {
        XCTAssertEqual(result["error"] as? String, error, scenarioId)
      }
      if let rate = (expected["playbackRate"] as? NSNumber)?.floatValue {
        XCTAssertEqual(result["playbackRate"] as? Float, rate, scenarioId)
      }
      if let chapterIndex = (expected["chapterIndex"] as? NSNumber)?.intValue {
        XCTAssertEqual(result["chapterIndex"] as? Int, chapterIndex, scenarioId)
      }
      if let isBookmarked = expected["isBookmarked"] as? Bool {
        XCTAssertEqual(result["isBookmarked"] as? Bool, isBookmarked, scenarioId)
      }
      if let endsAt = (expected["sleepTimerEndsAt"] as? NSNumber)?.int64Value {
        XCTAssertEqual(result["sleepTimerEndsAt"] as? Int64, endsAt, scenarioId)
      }
      if expected["sleepTimerAbsent"] as? Bool == true {
        XCTAssertNil(result["sleepTimerEndsAt"], scenarioId)
      }
      if expected["locationAbsent"] as? Bool == true {
        XCTAssertNil(result["location"], scenarioId)
      }
      if let volume = (expected["volume"] as? NSNumber)?.floatValue {
        XCTAssertEqual(fixture.adapter.volume, volume, accuracy: 0.001, scenarioId)
      }
      if let timeSeconds = (expected["timeSeconds"] as? NSNumber)?.doubleValue {
        let location = try XCTUnwrap(result["location"] as? [String: Any], scenarioId)
        let locator = try XCTUnwrap(location["locator"] as? [String: Any], scenarioId)
        let locations = try XCTUnwrap(locator["locations"] as? [String: Any], scenarioId)
        let fragments = try XCTUnwrap(locations["fragments"] as? [String], scenarioId)
        let fragment = try XCTUnwrap(fragments.first, scenarioId)
        let actualTime = try XCTUnwrap(Double(fragment.dropFirst(2)), scenarioId)
        XCTAssertEqual(actualTime, timeSeconds, accuracy: 0.001, scenarioId)
      }
    }
  }

  func testPhoneCommandsDriveTheSameNativePlayerAndSnapshotAsCarPlay() throws {
    let suite = "AudiobookCarPlayerCommandTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let library = AudiobookCarLibrary(defaults: defaults)
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data([0]).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    library.updatePlaybackManifest(
      .init(
        bookId: "book-1", title: "Book", author: "Author", coverPath: nil,
        sections: [
          .init(
            sectionIndex: 3, label: "Chapter", durationMs: 60_000,
            segments: [
              .init(
                href: "audio/chapter.mp3", type: "audio/mpeg", path: file.path,
                clipBeginMs: 5_000, clipEndMs: 65_000, sourceDurationMs: 65_000,
                cues: [.init(offsetMs: 0, text: "text/chapter.xhtml#p1")])
            ])
        ])
    )
    let adapter = FakeAudiobookAVPlayer()
    let player = AudiobookCarPlayer(library: library, player: adapter)

    _ = player.control(
      action: "play", bookId: "book-1", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = player.control(
      action: "seekRelative", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: 30_000, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = player.control(
      action: "setRate", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: nil, rate: 1.5, volume: nil, mode: nil, endsAt: nil)

    let snapshot = player.snapshot()
    XCTAssertEqual(snapshot["bookId"] as? String, "book-1")
    XCTAssertEqual(snapshot["chapterIndex"] as? Int, 3)
    XCTAssertEqual(snapshot["chapterPositionMs"] as? Int64, 30_000)
    XCTAssertEqual(snapshot["playbackRate"] as? Float, 1.5)
    XCTAssertEqual(adapter.rate, 1.5)
  }

  func testReadingAPausedSnapshotDoesNotMakeItsLocatorNewer() throws {
    let fixture = try makePlayer(bookId: "book-read-only", durationMs: 60_000)
    defer { fixture.cleanup() }
    _ = fixture.player.control(
      action: "play", bookId: "book-read-only", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = fixture.player.control(
      action: "pause", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)

    let first = try XCTUnwrap(snapshotUpdatedAt(fixture.player.snapshot()))
    usleep(40_000)
    let second = try XCTUnwrap(snapshotUpdatedAt(fixture.player.snapshot()))

    XCTAssertEqual(
      first, second,
      "A read-only snapshot must not turn stale native progress into the newest marker")
  }

  func testReadingPlaybackLocationThroughTheBridgeDoesNotMakeItNewer() throws {
    let fixture = try makePlayer(bookId: "book-bridge-read-only", durationMs: 60_000)
    defer { fixture.cleanup() }
    _ = fixture.player.control(
      action: "play", bookId: "book-bridge-read-only", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = fixture.player.control(
      action: "pause", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    let firstUpdatedAt = try XCTUnwrap(
      fixture.library.playbackLocation(for: "book-bridge-read-only")?.updatedAt)

    usleep(40_000)
    let returnedLocation = fixture.player.playbackLocation(for: "book-bridge-read-only")
    let secondUpdatedAt = try XCTUnwrap(
      fixture.library.playbackLocation(for: "book-bridge-read-only")?.updatedAt)

    XCTAssertEqual(firstUpdatedAt, returnedLocation?.updatedAt)
    XCTAssertEqual(
      firstUpdatedAt, secondUpdatedAt,
      "Reading progress through the bridge must be side-effect free")
  }

  func testPressingPlayAfterTheBookEndsRestartsFromTheBeginning() throws {
    let fixture = try makePlayer(bookId: "book-ended", durationMs: 500)
    defer { fixture.cleanup() }
    _ = fixture.player.control(
      action: "play", bookId: "book-ended", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    fixture.adapter.clock = CMTime(value: 500, timescale: 1_000)
    NotificationCenter.default.post(
      name: .AVPlayerItemDidPlayToEndTime,
      object: fixture.adapter.currentItem
    )

    _ = fixture.player.control(
      action: "play", bookId: "book-ended", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)

    XCTAssertEqual(CMTimeGetSeconds(fixture.adapter.clock), 0, accuracy: 0.001)
    XCTAssertEqual(fixture.adapter.rate, 1)
  }

  func testCarPlayPlayCommandRestartsAnEndedBookFromTheBeginning() throws {
    let fixture = try makePlayer(bookId: "book-carplay-ended", durationMs: 500)
    defer { fixture.cleanup() }
    _ = fixture.player.control(
      action: "play", bookId: "book-carplay-ended", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    fixture.adapter.clock = CMTime(value: 500, timescale: 1_000)
    NotificationCenter.default.post(
      name: .AVPlayerItemDidPlayToEndTime,
      object: fixture.adapter.currentItem
    )

    _ = fixture.player.resume()

    XCTAssertEqual(CMTimeGetSeconds(fixture.adapter.clock), 0, accuracy: 0.001)
    XCTAssertEqual(fixture.adapter.rate, 1)
  }

  func testCarPlayReplayReactivatesTheAudioSessionAfterTheBookEnds() throws {
    var activationCount = 0
    let fixture = try makePlayer(
      bookId: "book-carplay-reactivation",
      durationMs: 500,
      activateAudioSession: { activationCount += 1 }
    )
    defer { fixture.cleanup() }
    _ = fixture.player.control(
      action: "play", bookId: "book-carplay-reactivation", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    fixture.adapter.clock = CMTime(value: 500, timescale: 1_000)
    NotificationCenter.default.post(
      name: .AVPlayerItemDidPlayToEndTime,
      object: fixture.adapter.currentItem
    )

    _ = fixture.player.resume()

    XCTAssertEqual(
      activationCount, 2,
      "Replaying an ended book must reactivate an audio session lost to another media app")
  }

  func testFailedBookReplacementDoesNotLeaveThePreviousBookPlaying() throws {
    let fixture = try makePlayer(bookId: "book-a", durationMs: 60_000)
    defer { fixture.cleanup() }
    _ = fixture.player.control(
      action: "play", bookId: "book-a", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    XCTAssertEqual(fixture.adapter.rate, 1)

    let result = fixture.player.control(
      action: "play", bookId: "book-without-a-manifest", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)

    XCTAssertEqual(result["state"] as? String, "error")
    XCTAssertEqual(fixture.adapter.rate, 0, "The previous AVPlayer continued audibly")
    XCTAssertNil(fixture.adapter.currentItem)
  }

  func testCarPlayChapterCommandsRemainEnabledForTheNativeQueue() throws {
    let fixture = try makePlayer(bookId: "book-chapters", durationMs: 60_000)
    defer { fixture.cleanup() }

    XCTAssertTrue(MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled)
    XCTAssertTrue(MPRemoteCommandCenter.shared().previousTrackCommand.isEnabled)
  }

  func testBookmarkStateAppliesOnlyToTheExactSmilCue() throws {
    let fixture = try makePlayer(bookId: "book-bookmark-cue", durationMs: 20_000)
    defer { fixture.cleanup() }
    fixture.library.updatePlaybackManifest(
      .init(
        bookId: "book-bookmark-cue", title: "Book", author: "Author", coverPath: nil,
        sections: [
          .init(
            sectionIndex: 0, label: "Chapter", durationMs: 20_000,
            segments: [
              .init(
                href: "audio/chapter.mp3", type: "audio/mpeg", path: fixture.file.path,
                clipBeginMs: 0, clipEndMs: 20_000, sourceDurationMs: 20_000,
                cues: [
                  .init(offsetMs: 0, text: "text/chapter.xhtml#p1"),
                  .init(offsetMs: 10_000, text: "text/chapter.xhtml#p2"),
                ])
            ])
        ])
    )
    _ = fixture.player.control(
      action: "play", bookId: "book-bookmark-cue", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = fixture.player.control(
      action: "addBookmark", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    XCTAssertEqual(fixture.player.snapshot()["isBookmarked"] as? Bool, true)

    fixture.adapter.clock = CMTime(value: 11_000, timescale: 1_000)
    let snapshot = fixture.player.snapshot()
    let textLocator = (snapshot["location"] as? [String: Any])?["textLocator"]
      as? [String: Any]
    let locations = textLocator?["locations"] as? [String: Any]
    XCTAssertEqual((locations?["fragments"] as? [String])?.first, "p2")
    XCTAssertEqual(snapshot["isBookmarked"] as? Bool, false)
  }

  func testCarPlayBookmarkNotificationRefreshesWhenTheCurrentCueChanges() throws {
    let fixture = try makePlayer(bookId: "book-carplay-bookmark", durationMs: 20_000)
    defer { fixture.cleanup() }
    fixture.library.updatePlaybackManifest(
      .init(
        bookId: "book-carplay-bookmark", title: "Book", author: "Author", coverPath: nil,
        sections: [
          .init(
            sectionIndex: 0, label: "Chapter", durationMs: 20_000,
            segments: [
              .init(
                href: "audio/chapter.mp3", type: "audio/mpeg", path: fixture.file.path,
                clipBeginMs: 0, clipEndMs: 20_000, sourceDurationMs: 20_000,
                cues: [
                  .init(offsetMs: 0, text: "text/chapter.xhtml#p1"),
                  .init(offsetMs: 10_000, text: "text/chapter.xhtml#p2"),
                ])
            ])
        ])
    )
    var bookmarkStates: [Bool] = []
    let observer = NotificationCenter.default.addObserver(
      forName: AudiobookCarPlayer.bookmarkStateDidChangeNotification,
      object: fixture.player,
      queue: nil
    ) { notification in
      if let isBookmarked = notification.userInfo?["isBookmarked"] as? Bool {
        bookmarkStates.append(isBookmarked)
      }
    }
    defer { NotificationCenter.default.removeObserver(observer) }

    _ = fixture.player.control(
      action: "play", bookId: "book-carplay-bookmark", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = fixture.player.control(
      action: "addBookmark", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    fixture.adapter.advanceClock(to: 11_000)

    XCTAssertEqual(
      Array(bookmarkStates.suffix(2)), [true, false],
      "CarPlay must fill the bookmark at the saved cue and clear it after playback enters another cue"
    )
  }

  func testPartiallyDownloadedManifestIsRejectedInsteadOfDroppingChapters() throws {
    let fixture = try makePlayer(bookId: "book-partial", durationMs: 60_000)
    defer { fixture.cleanup() }
    fixture.library.updatePlaybackManifest(
      .init(
        bookId: "book-partial", title: "Book", author: "Author", coverPath: nil,
        sections: [
          .init(
            sectionIndex: 0, label: "Downloaded", durationMs: 60_000,
            segments: [
              .init(
                href: "audio/one.mp3", type: "audio/mpeg", path: fixture.file.path,
                clipBeginMs: 0, clipEndMs: 60_000, sourceDurationMs: 60_000,
                cues: [.init(offsetMs: 0, text: "text/one.xhtml#p1")]
              )
            ]
          ),
          .init(
            sectionIndex: 1, label: "Missing", durationMs: 60_000,
            segments: [
              .init(
                href: "audio/two.mp3", type: "audio/mpeg",
                path: fixture.file.deletingLastPathComponent()
                  .appendingPathComponent(UUID().uuidString).path,
                clipBeginMs: 0, clipEndMs: 60_000, sourceDurationMs: 60_000,
                cues: [.init(offsetMs: 0, text: "text/two.xhtml#p1")]
              )
            ]
          ),
        ]
      )
    )

    let result = fixture.player.control(
      action: "play", bookId: "book-partial", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)

    XCTAssertEqual(result["state"] as? String, "error")
    XCTAssertEqual(result["error"] as? String, "audio_unavailable")
    XCTAssertNil(fixture.adapter.currentItem)
  }

  func testNativeSavesAdvancePastAnExistingFutureTimestamp() throws {
    let fixture = try makePlayer(bookId: "book-monotonic", durationMs: 60_000)
    defer { fixture.cleanup() }
    let futureTimestamp = Int64(Date().timeIntervalSince1970 * 1_000) + 60_000
    fixture.library.updatePlaybackLocation(
      playbackLocation(bookId: "book-monotonic", seconds: 0, updatedAt: futureTimestamp))
    _ = fixture.player.control(
      action: "play", bookId: "book-monotonic", location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = fixture.player.control(
      action: "seekRelative", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: 30_000, rate: nil, volume: nil, mode: nil, endsAt: nil)
    _ = fixture.player.control(
      action: "pause", bookId: nil, location: nil, chapterIndex: nil,
      offsetMs: nil, rate: nil, volume: nil, mode: nil, endsAt: nil)

    let saved = try XCTUnwrap(fixture.library.playbackLocation(for: "book-monotonic"))
    XCTAssertEqual(saved.locator.locations.fragments.first, "t=30.0")
    XCTAssertGreaterThan(saved.updatedAt, futureTimestamp)
  }

  private struct PlayerFixture {
    let suiteName: String
    let defaults: UserDefaults
    let library: AudiobookCarLibrary
    let file: URL
    let adapter: FakeAudiobookAVPlayer
    let player: AudiobookCarPlayer

    func cleanup() {
      defaults.removePersistentDomain(forName: suiteName)
      try? FileManager.default.removeItem(at: file)
    }
  }

  private func makePlayer(
    bookId: String,
    durationMs: Int64,
    activateAudioSession: @escaping () throws -> Void = {}
  ) throws -> PlayerFixture {
    let suiteName = "AudiobookCarPlayerRegressionTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    let library = AudiobookCarLibrary(defaults: defaults)
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data([0]).write(to: file)
    library.updatePlaybackManifest(
      .init(
        bookId: bookId, title: "Book", author: "Author", coverPath: nil,
        sections: [
          .init(
            sectionIndex: 0, label: "Chapter", durationMs: durationMs,
            segments: [
              .init(
                href: "audio/chapter.mp3", type: "audio/mpeg", path: file.path,
                clipBeginMs: 0, clipEndMs: durationMs, sourceDurationMs: durationMs,
                cues: [.init(offsetMs: 0, text: "text/chapter.xhtml#p1")]
              )
            ]
          )
        ]
      )
    )
    let adapter = FakeAudiobookAVPlayer()
    let player = AudiobookCarPlayer(
      library: library,
      player: adapter,
      activateAudioSession: activateAudioSession
    )
    return PlayerFixture(
      suiteName: suiteName,
      defaults: defaults,
      library: library,
      file: file,
      adapter: adapter,
      player: player
    )
  }

  private func loadPlaybackContract() throws -> [String: Any] {
    let url = try XCTUnwrap(
      Bundle.module.url(
        forResource: "audiobook-playback-contract",
        withExtension: "json"
      ))
    return try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
  }

  private func contractSection(
    index: Int,
    href: String,
    text: String,
    file: URL,
    durationMs: Int64
  ) -> AudiobookCarLibrary.PlaybackSection {
    .init(
      sectionIndex: index,
      label: "Chapter \(index + 1)",
      durationMs: durationMs,
      segments: [
        .init(
          href: href, type: "audio/mpeg", path: file.path,
          clipBeginMs: 0, clipEndMs: durationMs, sourceDurationMs: durationMs,
          cues: [.init(offsetMs: 0, text: text)]
        )
      ]
    )
  }

  private func decodePlaybackLocation(
    _ value: Any?
  ) throws -> AudiobookCarLibrary.PlaybackLocation? {
    guard let object = value as? [String: Any] else { return nil }
    return try JSONDecoder().decode(
      AudiobookCarLibrary.PlaybackLocation.self,
      from: JSONSerialization.data(withJSONObject: object)
    )
  }

  private func snapshotUpdatedAt(_ snapshot: [String: Any]) -> Int64? {
    guard let value = (snapshot["location"] as? [String: Any])?["updatedAt"] else {
      return nil
    }
    if let value = value as? Int64 { return value }
    return (value as? NSNumber)?.int64Value
  }

  private func playbackLocation(
    bookId: String,
    seconds: Double,
    updatedAt: Int64
  ) -> AudiobookCarLibrary.PlaybackLocation {
    .init(
      schemaVersion: 2,
      editionId: bookId,
      locator: .init(
        href: "audio/chapter.mp3",
        type: "audio/mpeg",
        title: "Chapter",
        locations: .init(
          fragments: ["t=\(seconds)"], progression: nil, totalProgression: nil)
      ),
      textLocator: nil,
      updatedAt: updatedAt
    )
  }
}

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

  func testThirtySecondSeekCrossesChapterAndResourceBoundaries() {
    XCTAssertEqual(
      CarPlaybackTimeline.relativeSeekTarget(
        entries, itemIndex: 1, itemPositionMs: 5_000, offsetMs: 3_000),
      CarPlaybackSeekTarget(itemIndex: 2, positionMs: 2_000)
    )
    XCTAssertEqual(
      CarPlaybackTimeline.relativeSeekTarget(
        entries, itemIndex: 2, itemPositionMs: 1_000, offsetMs: -8_000),
      CarPlaybackSeekTarget(itemIndex: 0, positionMs: 3_000)
    )
  }

  func testResolvesReadiumLocatorByResourceClockTextCueAndEdition() {
    let locatorEntries = [
      CarPlaybackLocatorEntry(
        href: "audio/shared.mp3", clipBeginMs: 1_000, clipEndMs: 5_000,
        cueTargets: ["text/one.xhtml#p1"]),
      CarPlaybackLocatorEntry(
        href: "audio/shared.mp3", clipBeginMs: 1_000, clipEndMs: 5_000,
        cueTargets: ["text/two.xhtml#p1"]),
    ]
    let location = AudiobookCarLibrary.PlaybackLocation(
      schemaVersion: 2,
      editionId: "edition-1",
      locator: .init(
        href: "audio/shared.mp3", type: "audio/mpeg", title: "Two",
        locations: .init(fragments: ["t=2.5"], progression: nil, totalProgression: nil)
      ),
      textLocator: .init(
        href: "text/two.xhtml", type: "application/xhtml+xml", title: "Two",
        locations: .init(fragments: ["p1"], progression: nil, totalProgression: nil)
      ),
      updatedAt: 1
    )

    XCTAssertEqual(
      CarPlaybackTimeline.resolveLocation(
        locatorEntries, editionId: "edition-1", location: location),
      CarPlaybackSeekTarget(itemIndex: 1, positionMs: 1_500)
    )
    XCTAssertNil(
      CarPlaybackTimeline.resolveLocation(
        locatorEntries, editionId: "different-edition", location: location)
    )
  }

  func testLocatorAtSharedClipBoundaryChoosesTheStartingSegment() {
    let locatorEntries = [
      CarPlaybackLocatorEntry(
        href: "audio/shared.mp3", clipBeginMs: 0, clipEndMs: 10_000, cueTargets: []),
      CarPlaybackLocatorEntry(
        href: "audio/shared.mp3", clipBeginMs: 10_000, clipEndMs: 20_000, cueTargets: []),
    ]
    let location = AudiobookCarLibrary.PlaybackLocation(
      schemaVersion: 2,
      editionId: "edition-1",
      locator: .init(
        href: "audio/shared.mp3", type: "audio/mpeg", title: nil,
        locations: .init(fragments: ["t=10"], progression: nil, totalProgression: nil)
      ),
      textLocator: nil,
      updatedAt: 1
    )

    XCTAssertEqual(
      CarPlaybackTimeline.resolveLocation(
        locatorEntries, editionId: "edition-1", location: location),
      CarPlaybackSeekTarget(itemIndex: 1, positionMs: 0)
    )
  }
}

final class AudiobookCarLibraryPersistenceTests: XCTestCase {
  func testPendingBookmarksPersistUntilTheReaderConsumesThem() throws {
    let suiteName = "AudiobookCarLibraryBookmarkTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let location = AudiobookCarLibrary.PlaybackLocation(
      schemaVersion: 2,
      editionId: "book-1",
      locator: .init(
        href: "audio/one.mp3", type: "audio/mpeg", title: nil,
        locations: .init(fragments: ["t=12"], progression: nil, totalProgression: nil)
      ),
      textLocator: .init(
        href: "text/one.xhtml", type: "application/xhtml+xml", title: nil,
        locations: .init(fragments: ["p1"], progression: nil, totalProgression: nil)
      ),
      updatedAt: 1
    )

    AudiobookCarLibrary(defaults: defaults).addPendingBookmark(location)
    let restored = AudiobookCarLibrary(defaults: defaults)
    XCTAssertEqual(restored.takePendingBookmarks(for: "book-1").count, 1)
    XCTAssertTrue(restored.takePendingBookmarks(for: "book-1").isEmpty)
  }

  func testDoesNotReadLegacyChapterOffsetProgress() throws {
    let suiteName = "AudiobookCarLibraryLegacyTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    defaults.set(
      try JSONSerialization.data(withJSONObject: [
        "book-1": ["bookId": "book-1", "sectionIndex": 3, "positionMs": 4_000]
      ]),
      forKey: "bookarc.car.playback-progress"
    )

    XCTAssertNil(AudiobookCarLibrary(defaults: defaults).playbackLocation(for: "book-1"))
  }

  func testStaleWebLocationCannotOverwriteNewerCarPlayback() throws {
    let suiteName = "AudiobookCarLibraryOrderingTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let library = AudiobookCarLibrary(defaults: defaults)
    let newer = AudiobookCarLibrary.PlaybackLocation(
      schemaVersion: 2,
      editionId: "book-1",
      locator: .init(
        href: "audio/one.mp3", type: "audio/mpeg", title: nil,
        locations: .init(fragments: ["t=12"], progression: nil, totalProgression: nil)
      ),
      textLocator: nil,
      updatedAt: 2_000
    )
    let stale = AudiobookCarLibrary.PlaybackLocation(
      schemaVersion: 2,
      editionId: "book-1",
      locator: .init(
        href: "audio/one.mp3", type: "audio/mpeg", title: nil,
        locations: .init(fragments: ["t=3"], progression: nil, totalProgression: nil)
      ),
      textLocator: nil,
      updatedAt: 1_000
    )

    library.updatePlaybackLocation(newer)
    library.updatePlaybackLocation(stale)

    XCTAssertEqual(library.playbackLocation(for: "book-1")?.updatedAt, 2_000)
    XCTAssertEqual(
      library.playbackLocation(for: "book-1")?.locator.locations.fragments.first,
      "t=12"
    )
  }

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
        sections: [
          .init(
            sectionIndex: 3,
            label: "Chapter One",
            durationMs: 10_000,
            segments: [
              .init(
                href: "OEBPS/audio/ch1.mp3",
                type: "audio/mpeg",
                path: "/tmp/audio.mp3",
                clipBeginMs: 1_000,
                clipEndMs: 11_000,
                sourceDurationMs: 20_000,
                cues: [.init(offsetMs: 0, text: "text/ch1.xhtml#p1")]
              )
            ]
          )
        ]
      )
    )
    library.updatePlaybackLocation(
      .init(
        schemaVersion: 2,
        editionId: "book-1",
        locator: .init(
          href: "OEBPS/audio/ch1.mp3",
          type: "audio/mpeg",
          title: "Chapter One",
          locations: .init(
            fragments: ["t=5.25"], progression: 0.2625, totalProgression: 0.425)
        ),
        textLocator: nil,
        updatedAt: 1_234
      )
    )

    let restored = AudiobookCarLibrary(defaults: defaults)
    XCTAssertEqual(restored.books.first?.id, "book-1")
    XCTAssertEqual(restored.chapters(for: "book-1").first?.index, 3)
    XCTAssertEqual(restored.playbackManifest(for: "book-1")?.sections.first?.durationMs, 10_000)
    XCTAssertEqual(
      restored.playbackLocation(for: "book-1")?.locator.locations.fragments.first,
      "t=5.25"
    )
  }

  func testRepeatedCarPlayReconnectsKeepTheNewestLocator() throws {
    let suiteName = "AudiobookCarLibraryReconnectTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    for (time, updatedAt) in [(3.0, 3_000), (8.0, 8_000), (5.0, 5_000), (12.0, 12_000)] {
      AudiobookCarLibrary(defaults: defaults).updatePlaybackLocation(
        makeLocation(editionId: "book-1", time: time, updatedAt: Int64(updatedAt))
      )
    }

    let restored = AudiobookCarLibrary(defaults: defaults).playbackLocation(for: "book-1")
    XCTAssertEqual(restored?.updatedAt, 12_000)
    XCTAssertEqual(restored?.locator.locations.fragments.first, "t=12.0")
  }

  func testEqualTimestampCannotMoveCarPlayProgressBackward() throws {
    let suiteName = "AudiobookCarLibraryEqualTimestampTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let library = AudiobookCarLibrary(defaults: defaults)

    library.updatePlaybackLocation(makeLocation(editionId: "book-1", time: 12, updatedAt: 2_000))
    library.updatePlaybackLocation(makeLocation(editionId: "book-1", time: 3, updatedAt: 2_000))

    XCTAssertEqual(
      library.playbackLocation(for: "book-1")?.locator.locations.fragments.first,
      "t=12.0"
    )
  }

  func testAudiobookEditionsPersistProgressIndependently() throws {
    let suiteName = "AudiobookCarLibraryEditionTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let library = AudiobookCarLibrary(defaults: defaults)

    library.updatePlaybackLocation(makeLocation(editionId: "edition-a", time: 7, updatedAt: 7))
    library.updatePlaybackLocation(makeLocation(editionId: "edition-b", time: 19, updatedAt: 19))

    XCTAssertEqual(
      AudiobookCarLibrary(defaults: defaults)
        .playbackLocation(for: "edition-a")?.locator.locations.fragments.first,
      "t=7.0"
    )
    XCTAssertEqual(
      AudiobookCarLibrary(defaults: defaults)
        .playbackLocation(for: "edition-b")?.locator.locations.fragments.first,
      "t=19.0"
    )
  }

  private func makeLocation(
    editionId: String,
    time: Double,
    updatedAt: Int64
  ) -> AudiobookCarLibrary.PlaybackLocation {
    AudiobookCarLibrary.PlaybackLocation(
      schemaVersion: 2,
      editionId: editionId,
      locator: .init(
        href: "audio/chapter.mp3",
        type: "audio/mpeg",
        title: "Chapter",
        locations: .init(
          fragments: ["t=\(time)"], progression: nil, totalProgression: nil)
      ),
      textLocator: nil,
      updatedAt: updatedAt
    )
  }
}
