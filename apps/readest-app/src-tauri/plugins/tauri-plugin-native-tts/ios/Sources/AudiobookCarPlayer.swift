import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/// Native audiobook playback used when CarPlay starts playback without a
/// running web view. The EPUB and SMIL parsing remains in foliate-js; this
/// class only consumes the resolved local-file playback manifest.
@available(iOS 14.0, *)
public final class AudiobookCarPlayer {
  public static let shared = AudiobookCarPlayer()

  private struct QueueEntry {
    let timeline: CarPlaybackQueueEntry
    let segment: AudiobookCarLibrary.PlaybackSegment
    let section: AudiobookCarLibrary.PlaybackSection
  }

  private let library: AudiobookCarLibrary
  private let player = AVPlayer()
  private var manifest: AudiobookCarLibrary.PlaybackManifest?
  private var queue: [QueueEntry] = []
  private var currentIndex = 0
  private var itemEndObserver: NSObjectProtocol?
  private var itemFailureObserver: NSObjectProtocol?
  private var interruptionObserver: NSObjectProtocol?
  private var timeObserver: Any?
  private var shouldResumeAfterInterruption = false
  private var lastSavedPositionMs: Int64 = -1
  private var artwork: MPMediaItemArtwork?

  init(library: AudiobookCarLibrary = .shared) {
    self.library = library
    configureRemoteCommands()
    observeInterruptions()
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
    guard let manifest = library.playbackManifest(for: bookId) else { return false }
    let queue = buildQueue(manifest)
    guard !queue.isEmpty else { return false }

    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio, policy: .longFormAudio)
      try session.setActive(true)
    } catch {
      return false
    }

    self.manifest = manifest
    self.queue = queue
    artwork = loadArtwork(path: manifest.coverPath)

    let progress = library.playbackProgress(for: bookId)
    let requestedSection = chapterIndex ?? progress?.sectionIndex
    let timeline = queue.map(\.timeline)
    let startIndex = CarPlaybackTimeline.startIndex(
      timeline,
      requestedSection: requestedSection,
      savedSection: manifest.currentSectionIndex
    )
    let resumePosition =
      chapterIndex == nil && progress?.sectionIndex == queue[startIndex].timeline.sectionIndex
      ? progress?.positionMs ?? 0
      : 0
    let target =
      CarPlaybackTimeline.seekTarget(
        timeline,
        itemIndex: startIndex,
        chapterPositionMs: resumePosition
      ) ?? CarPlaybackSeekTarget(itemIndex: startIndex, positionMs: 0)

    loadItem(at: target.itemIndex, positionMs: target.positionMs, autoplay: true)
    return true
  }

  private func buildQueue(_ manifest: AudiobookCarLibrary.PlaybackManifest) -> [QueueEntry] {
    manifest.sections.flatMap { section -> [QueueEntry] in
      guard !section.segments.isEmpty,
        section.segments.allSatisfy({ FileManager.default.fileExists(atPath: $0.path) })
      else { return [] }
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
      if autoplay { self.player.play() }
      self.updateNowPlayingMetadata()
    }
  }

  private func advanceToNextSegment() {
    let nextIndex = currentIndex + 1
    guard queue.indices.contains(nextIndex) else {
      player.pause()
      saveProgress(force: true)
      updateNowPlayingPlaybackState()
      return
    }
    loadItem(at: nextIndex, positionMs: 0, autoplay: true)
  }

  private func resume() -> MPRemoteCommandHandlerStatus {
    guard player.currentItem != nil else { return .noActionableNowPlayingItem }
    do {
      try AVAudioSession.sharedInstance().setActive(true)
      player.play()
      updateNowPlayingPlaybackState()
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
    seekChapter(to: chapterPositionMs() + offsetMs)
  }

  private func seekToAdjacentChapter(_ direction: Int) -> MPRemoteCommandHandlerStatus {
    guard
      let target = CarPlaybackTimeline.adjacentChapterStart(
        queue.map(\.timeline),
        itemIndex: currentIndex,
        direction: direction
      )
    else { return .noSuchContent }
    loadItem(at: target, positionMs: 0, autoplay: true)
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
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(chapterPositionMs()) / 1_000
    info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    saveProgress(force: false)
  }

  private func updateNowPlayingPlaybackState() {
    MPNowPlayingInfoCenter.default().playbackState = player.rate == 0 ? .paused : .playing
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func saveProgress(force: Bool) {
    guard let manifest, queue.indices.contains(currentIndex) else { return }
    let position = chapterPositionMs()
    if !force && abs(position - lastSavedPositionMs) < 5_000 { return }
    lastSavedPositionMs = position
    library.updatePlaybackProgress(
      bookId: manifest.bookId,
      sectionIndex: queue[currentIndex].timeline.sectionIndex,
      positionMs: position
    )
  }

  private func configureRemoteCommands() {
    let commands = MPRemoteCommandCenter.shared()
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
    commands.skipForwardCommand.preferredIntervals = [30]
    commands.skipForwardCommand.addTarget { [weak self] event in
      let seconds = (event as? MPSkipIntervalCommandEvent)?.interval ?? 30
      return self?.seekBy(Int64(seconds * 1_000)) ?? .commandFailed
    }
    commands.skipBackwardCommand.preferredIntervals = [15]
    commands.skipBackwardCommand.addTarget { [weak self] event in
      let seconds = (event as? MPSkipIntervalCommandEvent)?.interval ?? 15
      return self?.seekBy(-Int64(seconds * 1_000)) ?? .commandFailed
    }
    commands.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
        return .commandFailed
      }
      return self?.seekChapter(to: Int64(positionEvent.positionTime * 1_000)) ?? .commandFailed
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
