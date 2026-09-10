import AVFoundation
import Foundation
import MediaPlayer
import UIKit

@available(iOS 14.0, *)
protocol AudiobookAVPlayer: AnyObject {
  var currentItem: AVPlayerItem? { get }
  var rate: Float { get set }
  var volume: Float { get set }
  func replaceCurrentItem(with item: AVPlayerItem?)
  func seek(
    to time: CMTime,
    toleranceBefore: CMTime,
    toleranceAfter: CMTime,
    completionHandler: @escaping @Sendable (Bool) -> Void
  )
  func playImmediately(atRate rate: Float)
  func pause()
  func currentTime() -> CMTime
  func addPeriodicTimeObserver(
    forInterval interval: CMTime,
    queue: dispatch_queue_t?,
    using block: @escaping @Sendable (CMTime) -> Void
  ) -> Any
  func removeTimeObserver(_ observer: Any)
}

@available(iOS 14.0, *)
extension AVPlayer: AudiobookAVPlayer {}

/// Native audiobook playback used when CarPlay starts playback without a
/// running web view. The EPUB and SMIL parsing remains in foliate-js; this
/// class only consumes the resolved local-file playback manifest.
@available(iOS 14.0, *)
public final class AudiobookCarPlayer {
  public static let shared = AudiobookCarPlayer()
  public static let bookmarkStateDidChangeNotification = Notification.Name(
    "AudiobookCarPlayer.bookmarkStateDidChange"
  )

  private struct QueueEntry {
    let timeline: CarPlaybackQueueEntry
    let segment: AudiobookCarLibrary.PlaybackSegment
    let section: AudiobookCarLibrary.PlaybackSection
  }

  private let library: AudiobookCarLibrary
  private let player: AudiobookAVPlayer
  private let activateAudioSession: () throws -> Void
  private var manifest: AudiobookCarLibrary.PlaybackManifest?
  private var queue: [QueueEntry] = []
  private var currentIndex = 0
  private var itemEndObserver: NSObjectProtocol?
  private var itemFailureObserver: NSObjectProtocol?
  private var interruptionObserver: NSObjectProtocol?
  private var backgroundObserver: NSObjectProtocol?
  private var terminationObserver: NSObjectProtocol?
  private var timeObserver: Any?
  private var shouldResumeAfterInterruption = false
  private var lastSavedPositionMs: Int64 = -1
  private var locationUpdatedAt = Int64(Date().timeIntervalSince1970 * 1_000)
  private var playbackEnded = false
  private var artwork: MPMediaItemArtwork?
  private var selectedPlaybackRate: Float = 1
  private let playbackRates: [Float] = [0.75, 1, 1.25, 1.5, 1.75, 2]
  private var sessionId = UUID().uuidString
  private var sequence: Int64 = 0
  private var bookmarkedTextTarget: String?
  private var publishedBookmarkState: Bool?
  private var sleepTimerMode: String?
  private var sleepTimerEndsAt: Int64?
  public var stateHandler: (([String: Any]) -> Void)?

  init(
    library: AudiobookCarLibrary = .shared,
    player: AudiobookAVPlayer = AVPlayer(),
    activateAudioSession: @escaping () throws -> Void = {
      try AVAudioSession.sharedInstance().setActive(true)
    }
  ) {
    self.library = library
    self.player = player
    self.activateAudioSession = activateAudioSession
    configureRemoteCommands()
    observeInterruptions()
    observeAppLifecycle()
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 1, preferredTimescale: 1),
      queue: .main
    ) { [weak self] _ in
      self?.updateElapsedPlaybackState()
    }
  }

  deinit {
    if let itemEndObserver { NotificationCenter.default.removeObserver(itemEndObserver) }
    if let itemFailureObserver { NotificationCenter.default.removeObserver(itemFailureObserver) }
    if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    if let terminationObserver { NotificationCenter.default.removeObserver(terminationObserver) }
    if let timeObserver { player.removeTimeObserver(timeObserver) }
  }

  /// Returns false when the book has not yet been prepared in the reader.
  @discardableResult
  public func play(bookId: String, chapterIndex: Int?) -> Bool {
    if !Thread.isMainThread {
      var started = false
      DispatchQueue.main.sync { started = play(bookId: bookId, chapterIndex: chapterIndex) }
      return started
    }
    return startPlayback(bookId: bookId, chapterIndex: chapterIndex) == nil
  }

  /// Starts playback and returns the exact failure snapshot sent to listeners, if any.
  private func startPlayback(bookId: String, chapterIndex: Int?) -> [String: Any]? {
    let previousBookId = manifest?.bookId
    guard let manifest = library.playbackManifest(for: bookId) else {
      clearPlaybackAfterFailedReplacement()
      return emitSnapshot(state: "error", error: "manifest_unavailable", bookId: bookId)
    }
    let queue = buildQueue(manifest)
    guard !queue.isEmpty else {
      clearPlaybackAfterFailedReplacement()
      return emitSnapshot(state: "error", error: "audio_unavailable", bookId: bookId)
    }

    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playback, mode: .spokenAudio, policy: .longFormAudio)
      try activateAudioSession()
    } catch {
      clearPlaybackAfterFailedReplacement()
      return emitSnapshot(state: "error", error: "audio_session_unavailable", bookId: bookId)
    }

    if player.currentItem != nil, previousBookId != nil, previousBookId != bookId {
      saveProgress(force: true)
    }
    self.manifest = manifest
    if previousBookId != bookId { sessionId = UUID().uuidString }
    self.queue = queue
    locationUpdatedAt = Int64(Date().timeIntervalSince1970 * 1_000)
    bookmarkedTextTarget = nil
    artwork = loadArtwork(path: manifest.coverPath)

    let timeline = queue.map(\.timeline)
    let target: CarPlaybackSeekTarget
    if let chapterIndex {
      let startIndex = CarPlaybackTimeline.startIndex(
        timeline, requestedSection: chapterIndex, savedSection: nil)
      target = CarPlaybackSeekTarget(itemIndex: startIndex, positionMs: 0)
    } else {
      target = CarPlaybackTimeline.resolveLocation(
        queue.map {
          CarPlaybackLocatorEntry(
            href: $0.segment.href,
            clipBeginMs: $0.segment.clipBeginMs,
            clipEndMs: $0.segment.clipEndMs,
            cueTargets: $0.segment.cues.map(\.text)
          )
        },
        editionId: manifest.bookId,
        location: library.playbackLocation(for: bookId)
      )
        ?? CarPlaybackSeekTarget(itemIndex: 0, positionMs: 0)
    }

    loadItem(at: target.itemIndex, positionMs: target.positionMs, autoplay: true)
    emitSnapshot(state: "loading")
    return nil
  }

  private func buildQueue(_ manifest: AudiobookCarLibrary.PlaybackManifest) -> [QueueEntry] {
    guard manifest.sections.allSatisfy({ section in
      !section.segments.isEmpty
        && section.segments.allSatisfy { FileManager.default.fileExists(atPath: $0.path) }
    }) else { return [] }
    return manifest.sections.flatMap { section in
      return section.segments.enumerated().map { segmentIndex, segment in
        QueueEntry(
          timeline: CarPlaybackQueueEntry(
            sectionIndex: section.sectionIndex,
            segmentIndex: segmentIndex,
            durationMs: max(0, segment.clipEndMs - segment.clipBeginMs)
          ),
          segment: segment,
          section: section
        )
      }
    }
  }

  private func loadItem(at index: Int, positionMs: Int64, autoplay: Bool) {
    guard queue.indices.contains(index) else { return }
    clearItemObservers()
    playbackEnded = false
    currentIndex = index
    let entry = queue[index]
    let item = AVPlayerItem(url: URL(fileURLWithPath: entry.segment.path))
    item.forwardPlaybackEndTime = time(entry.segment.clipEndMs)
    itemEndObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: item,
      queue: .main
    ) { [weak self] _ in
      self?.advanceToNextSegment()
    }
    itemFailureObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemFailedToPlayToEndTime,
      object: item,
      queue: .main
    ) { [weak self] _ in
      self?.pause()
    }
    player.replaceCurrentItem(with: item)
    let absolutePosition =
      entry.segment.clipBeginMs + min(max(0, positionMs), entry.timeline.durationMs)
    player.seek(to: time(absolutePosition), toleranceBefore: .zero, toleranceAfter: .zero) {
      [weak self] complete in
      guard complete, let self, self.player.currentItem === item else { return }
      if autoplay { self.player.playImmediately(atRate: self.selectedPlaybackRate) }
      self.updateNowPlayingMetadata()
      self.emitSnapshot()
    }
  }

  private func advanceToNextSegment() {
    let nextIndex = currentIndex + 1
    guard queue.indices.contains(nextIndex) else {
      player.pause()
      playbackEnded = true
      saveProgress(force: true)
      updateNowPlayingPlaybackState()
      emitSnapshot(state: "ended")
      return
    }
    if sleepTimerMode == "endOfChapter",
      queue[nextIndex].timeline.sectionIndex != queue[currentIndex].timeline.sectionIndex
    {
      player.pause()
      sleepTimerMode = nil
      sleepTimerEndsAt = nil
      saveProgress(force: true)
      emitSnapshot(state: "paused")
      return
    }
    loadItem(at: nextIndex, positionMs: 0, autoplay: true)
  }

  func resume() -> MPRemoteCommandHandlerStatus {
    guard player.currentItem != nil else { return .noActionableNowPlayingItem }
    do {
      try activateAudioSession()
      if playbackEnded {
        loadItem(at: 0, positionMs: 0, autoplay: true)
        return .success
      }
      player.playImmediately(atRate: selectedPlaybackRate)
      updateNowPlayingPlaybackState()
      emitSnapshot(state: "playing")
      return .success
    } catch {
      return .commandFailed
    }
  }

  @discardableResult
  private func pause() -> MPRemoteCommandHandlerStatus {
    guard player.currentItem != nil else { return .noActionableNowPlayingItem }
    player.pause()
    saveProgress(force: true)
    updateNowPlayingPlaybackState()
    emitSnapshot(state: "paused")
    return .success
  }

  private func seekChapter(to positionMs: Int64) -> MPRemoteCommandHandlerStatus {
    let timeline = queue.map(\.timeline)
    guard
      let target = CarPlaybackTimeline.seekTarget(
        timeline,
        itemIndex: currentIndex,
        chapterPositionMs: positionMs
      )
    else { return .noActionableNowPlayingItem }
    let autoplay = player.rate != 0
    loadItem(at: target.itemIndex, positionMs: target.positionMs, autoplay: autoplay)
    return .success
  }

  private func seekBy(_ offsetMs: Int64) -> MPRemoteCommandHandlerStatus {
    guard queue.indices.contains(currentIndex),
      let target = CarPlaybackTimeline.relativeSeekTarget(
        queue.map(\.timeline),
        itemIndex: currentIndex,
        itemPositionMs: max(
          0,
          milliseconds(player.currentTime()) - queue[currentIndex].segment.clipBeginMs
        ),
        offsetMs: offsetMs
      )
    else { return .noActionableNowPlayingItem }
    let autoplay = player.rate != 0
    loadItem(at: target.itemIndex, positionMs: target.positionMs, autoplay: autoplay)
    return .success
  }

  private func seekToAdjacentChapter(_ direction: Int) -> MPRemoteCommandHandlerStatus {
    guard
      let target = CarPlaybackTimeline.adjacentChapterStart(
        queue.map(\.timeline),
        itemIndex: currentIndex,
        direction: direction
      )
    else { return .noSuchContent }
    loadItem(at: target, positionMs: 0, autoplay: player.rate != 0)
    return .success
  }

  private func chapterPositionMs() -> Int64 {
    guard queue.indices.contains(currentIndex) else { return 0 }
    let sourcePositionMs = milliseconds(player.currentTime())
    let segmentPositionMs = max(0, sourcePositionMs - queue[currentIndex].segment.clipBeginMs)
    return CarPlaybackTimeline.chapterPosition(
      queue.map(\.timeline),
      itemIndex: currentIndex,
      itemPositionMs: segmentPositionMs
    )
  }

  private func updateNowPlayingMetadata() {
    guard let manifest, queue.indices.contains(currentIndex) else { return }
    let entry = queue[currentIndex]
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: manifest.title,
      MPMediaItemPropertyArtist: manifest.author,
      MPMediaItemPropertyAlbumTitle: entry.section.label,
      MPMediaItemPropertyPlaybackDuration: Double(entry.section.durationMs) / 1_000,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(chapterPositionMs()) / 1_000,
      MPNowPlayingInfoPropertyPlaybackRate: player.rate,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: selectedPlaybackRate,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      MPNowPlayingInfoPropertyExternalContentIdentifier: manifest.bookId,
    ]
    if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    updateNowPlayingPlaybackState()
    saveProgress(force: true)
  }

  private func updateElapsedPlaybackState() {
    guard player.currentItem != nil else { return }
    if sleepTimerMode == "duration", let endsAt = sleepTimerEndsAt {
      let remaining = endsAt - Int64(Date().timeIntervalSince1970 * 1_000)
      if remaining <= 0 {
        player.pause()
        player.volume = 1
        sleepTimerMode = nil
        sleepTimerEndsAt = nil
        saveProgress(force: true)
      } else if remaining <= 10_000 {
        player.volume = max(0, min(1, Float(remaining) / 10_000))
      } else {
        player.volume = 1
      }
    }
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(chapterPositionMs()) / 1_000
    info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate
    info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = selectedPlaybackRate
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    saveProgress(force: false)
    emitSnapshot()
  }

  private func updateNowPlayingPlaybackState() {
    MPNowPlayingInfoCenter.default().playbackState = player.rate == 0 ? .paused : .playing
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate
    info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = selectedPlaybackRate
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func currentLocation(
    updatedAt: Int64? = nil
  ) -> AudiobookCarLibrary.PlaybackLocation? {
    guard let manifest, queue.indices.contains(currentIndex) else { return nil }
    let position = chapterPositionMs()
    let entry = queue[currentIndex]
    let sourceTimeMs = min(
      entry.segment.clipEndMs,
      max(entry.segment.clipBeginMs, milliseconds(player.currentTime()))
    )
    let sourceDurationMs = max(entry.segment.sourceDurationMs, entry.segment.clipEndMs)
    let totalDurationMs = manifest.sections.reduce(0) { $0 + $1.durationMs }
    let beforeSectionMs = manifest.sections.prefix {
      $0.sectionIndex != entry.timeline.sectionIndex
    }.reduce(0) { $0 + $1.durationMs }
    let cue = entry.segment.cues.last { $0.offsetMs <= sourceTimeMs - entry.segment.clipBeginMs }
    let textLocator = cue.flatMap { cue -> AudiobookCarLibrary.Locator? in
      guard let separator = cue.text.lastIndex(of: "#") else { return nil }
      return .init(
        href: String(cue.text[..<separator]),
        type: "application/xhtml+xml",
        title: entry.section.label,
        locations: .init(
          fragments: [String(cue.text[cue.text.index(after: separator)...])],
          progression: nil,
          totalProgression: nil
        )
      )
    }
    return .init(
        schemaVersion: 2,
        editionId: manifest.bookId,
        locator: .init(
          href: entry.segment.href,
          type: entry.segment.type,
          title: entry.section.label,
          locations: .init(
            fragments: ["t=\(Double(sourceTimeMs) / 1_000)"],
            progression: sourceDurationMs > 0
              ? min(1, max(0, Double(sourceTimeMs) / Double(sourceDurationMs))) : nil,
            totalProgression: totalDurationMs > 0
              ? min(1, max(0, Double(beforeSectionMs + position) / Double(totalDurationMs))) : nil
          )
        ),
        textLocator: textLocator,
        updatedAt: updatedAt ?? locationUpdatedAt
    )
  }

  private func saveProgress(force: Bool) {
    let position = chapterPositionMs()
    if !force && abs(position - lastSavedPositionMs) < 5_000 { return }
    let persistedUpdatedAt = manifest.flatMap {
      library.playbackLocation(for: $0.bookId)?.updatedAt
    } ?? 0
    let previousUpdatedAt = max(locationUpdatedAt, persistedUpdatedAt)
    let updatedAt = max(
      Int64(Date().timeIntervalSince1970 * 1_000),
      previousUpdatedAt == Int64.max ? previousUpdatedAt : previousUpdatedAt + 1
    )
    guard let location = currentLocation(updatedAt: updatedAt) else { return }
    lastSavedPositionMs = position
    locationUpdatedAt = updatedAt
    library.updatePlaybackLocation(location)
  }

  private func clearPlaybackAfterFailedReplacement() {
    if player.currentItem != nil { saveProgress(force: true) }
    clearItemObservers()
    player.pause()
    player.replaceCurrentItem(with: nil)
    manifest = nil
    queue = []
    currentIndex = 0
    playbackEnded = false
    bookmarkedTextTarget = nil
  }

  @discardableResult
  public func cyclePlaybackRateOrRequestWeb() -> Bool {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in _ = self?.cyclePlaybackRateOrRequestWeb() }
      return true
    }
    guard player.currentItem != nil else {
      return false
    }
    selectedPlaybackRate = playbackRates.first { $0 > selectedPlaybackRate + 0.01 }
      ?? playbackRates[0]
    if player.rate != 0 { player.rate = selectedPlaybackRate }
    updateNowPlayingPlaybackState()
    emitSnapshot()
    return true
  }

  @discardableResult
  public func addBookmarkOrRequestWeb() -> Bool {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in _ = self?.addBookmarkOrRequestWeb() }
      return true
    }
    guard let location = currentLocation() else {
      return false
    }
    guard let target = textTarget(location) else { return false }
    if bookmarkedTextTarget == target { return true }
    library.addPendingBookmark(location)
    bookmarkedTextTarget = target
    emitSnapshot()
    return true
  }

  private func locationDictionary(_ location: AudiobookCarLibrary.PlaybackLocation) -> [String: Any]? {
    guard let data = try? JSONEncoder().encode(location) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  }

  public func snapshot(
    state: String? = nil,
    error: String? = nil,
    bookId: String? = nil
  ) -> [String: Any] {
    let entry = queue.indices.contains(currentIndex) ? queue[currentIndex] : nil
    let location = player.currentItem != nil
      ? currentLocation()
      : manifest.flatMap { library.playbackLocation(for: $0.bookId) }
    let isBookmarked = bookmarkedTextTarget != nil
      && location.flatMap(textTarget) == bookmarkedTextTarget
    var result: [String: Any] = [
      "sessionId": sessionId,
      "sequence": sequence,
      "bookId": bookId ?? manifest?.bookId ?? "",
      "state": state ?? (player.currentItem == nil ? "stopped" : (player.rate == 0 ? "paused" : "playing")),
      "chapterIndex": entry?.timeline.sectionIndex ?? -1,
      "chapterPositionMs": chapterPositionMs(),
      "chapterDurationMs": entry?.section.durationMs ?? 0,
      "playbackRate": selectedPlaybackRate,
      "isBookmarked": isBookmarked,
    ]
    if let location, let dictionary = locationDictionary(location) {
      result["location"] = dictionary
    }
    if let sleepTimerEndsAt { result["sleepTimerEndsAt"] = sleepTimerEndsAt }
    if let error { result["error"] = error }
    return result
  }

  private func textTarget(
    _ location: AudiobookCarLibrary.PlaybackLocation
  ) -> String? {
    guard let locator = location.textLocator,
      let fragment = locator.locations.fragments.first
    else { return nil }
    return "\(locator.href)#\(fragment)"
  }

  @discardableResult
  private func emitSnapshot(
    state: String? = nil,
    error: String? = nil,
    bookId: String? = nil
  ) -> [String: Any] {
    sequence += 1
    let result = snapshot(state: state, error: error, bookId: bookId)
    stateHandler?(result)
    let isBookmarked = result["isBookmarked"] as? Bool ?? false
    if publishedBookmarkState != isBookmarked {
      publishedBookmarkState = isBookmarked
      NotificationCenter.default.post(
        name: Self.bookmarkStateDidChangeNotification,
        object: self,
        userInfo: ["isBookmarked": isBookmarked]
      )
    }
    return result
  }

  private func seek(to location: AudiobookCarLibrary.PlaybackLocation) -> Bool {
    guard let manifest, location.editionId == manifest.bookId else { return false }
    guard let target = CarPlaybackTimeline.resolveLocation(
      queue.map {
        CarPlaybackLocatorEntry(
          href: $0.segment.href,
          clipBeginMs: $0.segment.clipBeginMs,
          clipEndMs: $0.segment.clipEndMs,
          cueTargets: $0.segment.cues.map(\.text)
        )
      },
      editionId: manifest.bookId,
      location: location
    ) else { return false }
    loadItem(at: target.itemIndex, positionMs: target.positionMs, autoplay: player.rate != 0)
    return true
  }

  public func control(
    action: String,
    bookId: String?,
    location: AudiobookCarLibrary.PlaybackLocation?,
    chapterIndex: Int?,
    offsetMs: Int64?,
    rate: Float?,
    volume: Float?,
    mode: String?,
    endsAt: Int64?
  ) -> [String: Any] {
    if !Thread.isMainThread {
      var result: [String: Any] = [:]
      DispatchQueue.main.sync {
        result = control(
          action: action, bookId: bookId, location: location, chapterIndex: chapterIndex,
          offsetMs: offsetMs, rate: rate, volume: volume, mode: mode, endsAt: endsAt)
      }
      return result
    }
    switch action {
    case "play":
      if let rate { selectedPlaybackRate = max(0.5, min(3, rate)) }
      if let location { library.updatePlaybackLocation(location) }
      if player.currentItem != nil, manifest?.bookId == bookId {
        if let location { _ = seek(to: location) }
        _ = resume()
      } else if let bookId {
        if let failure = startPlayback(bookId: bookId, chapterIndex: nil) { return failure }
      }
    case "startChapter":
      if let bookId, let chapterIndex,
        let failure = startPlayback(bookId: bookId, chapterIndex: chapterIndex)
      {
        return failure
      }
    case "pause": _ = pause()
    case "stop":
      saveProgress(force: true)
      player.pause()
      player.replaceCurrentItem(with: nil)
      emitSnapshot(state: "stopped")
    case "nextChapter": _ = seekToAdjacentChapter(1)
    case "previousChapter": _ = seekToAdjacentChapter(-1)
    case "seekRelative": if let offsetMs { _ = seekBy(offsetMs) }
    case "seekToLocator": if let location { _ = seek(to: location) }
    case "setRate":
      if let rate {
        selectedPlaybackRate = max(0.5, min(3, rate))
        if player.rate != 0 { player.rate = selectedPlaybackRate }
        emitSnapshot()
      }
    case "setVolume": if let volume { player.volume = max(0, min(1, volume)) }
    case "addBookmark": _ = addBookmarkOrRequestWeb()
    case "setSleepTimer":
      sleepTimerMode = mode
      sleepTimerEndsAt = mode == "duration" ? endsAt : nil
      emitSnapshot()
    case "cancelSleepTimer":
      sleepTimerMode = nil
      sleepTimerEndsAt = nil
      player.volume = 1
      emitSnapshot()
    default: break
    }
    return snapshot()
  }

  public func persistProgress() {
    if Thread.isMainThread {
      saveProgress(force: true)
    } else {
      DispatchQueue.main.async { [weak self] in self?.saveProgress(force: true) }
    }
  }

  public func persistProgressSynchronously() {
    if Thread.isMainThread {
      saveProgress(force: true)
    } else {
      DispatchQueue.main.sync { [weak self] in self?.saveProgress(force: true) }
    }
  }

  public func playbackLocation(for bookId: String) -> AudiobookCarLibrary.PlaybackLocation? {
    if !Thread.isMainThread {
      var location: AudiobookCarLibrary.PlaybackLocation?
      DispatchQueue.main.sync { location = playbackLocation(for: bookId) }
      return location
    }
    if player.currentItem != nil, manifest?.bookId == bookId, let location = currentLocation() {
      return location
    }
    return library.playbackLocation(for: bookId)
  }

  private func configureRemoteCommands() {
    let commands = MPRemoteCommandCenter.shared()
    commands.playCommand.isEnabled = true
    commands.pauseCommand.isEnabled = true
    commands.togglePlayPauseCommand.isEnabled = true
    commands.playCommand.addTarget { [weak self] _ in self?.resume() ?? .commandFailed }
    commands.pauseCommand.addTarget { [weak self] _ in self?.pause() ?? .commandFailed }
    commands.togglePlayPauseCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      return self.player.rate == 0 ? self.resume() : self.pause()
    }
    commands.nextTrackCommand.addTarget { [weak self] _ in
      self?.seekToAdjacentChapter(1) ?? .commandFailed
    }
    commands.previousTrackCommand.addTarget { [weak self] _ in
      self?.seekToAdjacentChapter(-1) ?? .commandFailed
    }
    commands.nextTrackCommand.isEnabled = true
    commands.previousTrackCommand.isEnabled = true
    commands.skipForwardCommand.preferredIntervals = [30]
    commands.skipForwardCommand.isEnabled = true
    commands.skipForwardCommand.addTarget { [weak self] event in
      let seconds = (event as? MPSkipIntervalCommandEvent)?.interval ?? 30
      return self?.seekBy(Int64(seconds * 1_000)) ?? .commandFailed
    }
    commands.skipBackwardCommand.preferredIntervals = [30]
    commands.skipBackwardCommand.isEnabled = true
    commands.skipBackwardCommand.addTarget { [weak self] event in
      let seconds = (event as? MPSkipIntervalCommandEvent)?.interval ?? 30
      return self?.seekBy(-Int64(seconds * 1_000)) ?? .commandFailed
    }
    commands.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
        return .commandFailed
      }
      return self?.seekChapter(to: Int64(positionEvent.positionTime * 1_000)) ?? .commandFailed
    }
    commands.changePlaybackRateCommand.supportedPlaybackRates = playbackRates.map {
      NSNumber(value: $0)
    }
    commands.changePlaybackRateCommand.isEnabled = true
    commands.changePlaybackRateCommand.addTarget { [weak self] event in
      guard let self,
        let rateEvent = event as? MPChangePlaybackRateCommandEvent,
        self.player.currentItem != nil
      else { return .noActionableNowPlayingItem }
      self.selectedPlaybackRate = rateEvent.playbackRate
      if self.player.rate != 0 { self.player.rate = rateEvent.playbackRate }
      self.updateNowPlayingPlaybackState()
      return .success
    }
    commands.bookmarkCommand.localizedTitle = "Add Bookmark"
    commands.bookmarkCommand.localizedShortTitle = "Bookmark"
    commands.bookmarkCommand.isActive = true
    commands.bookmarkCommand.isEnabled = true
    commands.bookmarkCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      return self.addBookmarkOrRequestWeb() ? .success : .noActionableNowPlayingItem
    }
  }

  private func observeInterruptions() {
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] notification in
      guard let self,
        let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        let type = AVAudioSession.InterruptionType(rawValue: rawType)
      else { return }
      if type == .began {
        self.shouldResumeAfterInterruption = self.player.rate != 0
        _ = self.pause()
      } else {
        let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
        if self.shouldResumeAfterInterruption && options.contains(.shouldResume) {
          _ = self.resume()
        }
        self.shouldResumeAfterInterruption = false
      }
    }
  }

  private func observeAppLifecycle() {
    backgroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.saveProgress(force: true)
    }
    terminationObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.willTerminateNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.saveProgress(force: true)
    }
  }

  private func clearItemObservers() {
    if let itemEndObserver { NotificationCenter.default.removeObserver(itemEndObserver) }
    if let itemFailureObserver { NotificationCenter.default.removeObserver(itemFailureObserver) }
    itemEndObserver = nil
    itemFailureObserver = nil
  }

  private func loadArtwork(path: String?) -> MPMediaItemArtwork? {
    guard let path, let image = UIImage(contentsOfFile: path) else { return nil }
    return MPMediaItemArtwork(boundsSize: image.size) { _ in image }
  }

  private func time(_ milliseconds: Int64) -> CMTime {
    CMTime(seconds: Double(milliseconds) / 1_000, preferredTimescale: 1_000)
  }

  private func milliseconds(_ time: CMTime) -> Int64 {
    guard time.isNumeric else { return 0 }
    return Int64((CMTimeGetSeconds(time) * 1_000).rounded())
  }
}
