import Foundation

struct CarPlaybackQueueEntry: Equatable {
  let sectionIndex: Int
  let segmentIndex: Int
  let durationMs: Int64
}

struct CarPlaybackSeekTarget: Equatable {
  let itemIndex: Int
  let positionMs: Int64
}

struct CarPlaybackLocatorEntry: Equatable {
  let href: String
  let clipBeginMs: Int64
  let clipEndMs: Int64
  let cueTargets: [String]
}

enum CarPlaybackTimeline {
  static func resolveLocation(
    _ entries: [CarPlaybackLocatorEntry],
    editionId: String,
    location: AudiobookCarLibrary.PlaybackLocation?
  ) -> CarPlaybackSeekTarget? {
    guard let location, location.schemaVersion == 2, location.editionId == editionId,
      let fragment = location.locator.locations.fragments.first(where: {
        $0.range(of: #"^t=(?:npt:)?\d+(?:\.\d+)?$"#, options: .regularExpression) != nil
      }),
      let rawTime = fragment.split(separator: "=").last,
      let seconds = Double(String(rawTime).replacingOccurrences(of: "npt:", with: ""))
    else { return nil }
    let sourceTimeMs = Int64((seconds * 1_000).rounded())
    let textTarget = location.textLocator.flatMap { locator in
      locator.locations.fragments.first.map { "\(locator.href)#\($0)" }
    }
    let matches = entries.enumerated().compactMap {
      index, entry -> (CarPlaybackSeekTarget, Bool, Bool)? in
      guard entry.href == location.locator.href,
        sourceTimeMs >= entry.clipBeginMs,
        sourceTimeMs <= entry.clipEndMs
      else { return nil }
      return (
        CarPlaybackSeekTarget(
          itemIndex: index,
          positionMs: min(max(0, sourceTimeMs - entry.clipBeginMs), entry.clipEndMs - entry.clipBeginMs)
        ),
        textTarget.map { entry.cueTargets.contains($0) } ?? false,
        sourceTimeMs == entry.clipBeginMs
      )
    }
    return (matches.first(where: { $0.1 }) ?? matches.first(where: { $0.2 }) ?? matches.first)?.0
  }

  static func startIndex(
    _ entries: [CarPlaybackQueueEntry],
    requestedSection: Int?,
    savedSection: Int?
  ) -> Int {
    let section = requestedSection ?? savedSection
    return entries.firstIndex { $0.sectionIndex == section } ?? 0
  }

  static func chapterPosition(
    _ entries: [CarPlaybackQueueEntry],
    itemIndex: Int,
    itemPositionMs: Int64
  ) -> Int64 {
    guard entries.indices.contains(itemIndex) else { return 0 }
    let sectionIndex = entries[itemIndex].sectionIndex
    let elapsed = entries[..<itemIndex]
      .filter { $0.sectionIndex == sectionIndex }
      .reduce(Int64(0)) { $0 + $1.durationMs }
    return elapsed + max(0, itemPositionMs)
  }

  static func chapterDuration(_ entries: [CarPlaybackQueueEntry], itemIndex: Int) -> Int64 {
    guard entries.indices.contains(itemIndex) else { return 0 }
    let sectionIndex = entries[itemIndex].sectionIndex
    return
      entries
      .filter { $0.sectionIndex == sectionIndex }
      .reduce(Int64(0)) { $0 + $1.durationMs }
  }

  static func seekTarget(
    _ entries: [CarPlaybackQueueEntry],
    itemIndex: Int,
    chapterPositionMs: Int64
  ) -> CarPlaybackSeekTarget? {
    guard entries.indices.contains(itemIndex) else { return nil }
    let sectionIndex = entries[itemIndex].sectionIndex
    let chapterEntries = entries.enumerated().filter { $0.element.sectionIndex == sectionIndex }
    var remaining = max(0, chapterPositionMs)
    for (index, entry) in chapterEntries {
      if remaining < entry.durationMs || entry.durationMs == 0 {
        return CarPlaybackSeekTarget(
          itemIndex: index,
          positionMs: min(remaining, entry.durationMs)
        )
      }
      remaining -= entry.durationMs
    }
    guard let last = chapterEntries.last else { return nil }
    return CarPlaybackSeekTarget(itemIndex: last.offset, positionMs: last.element.durationMs)
  }

  static func relativeSeekTarget(
    _ entries: [CarPlaybackQueueEntry],
    itemIndex: Int,
    itemPositionMs: Int64,
    offsetMs: Int64
  ) -> CarPlaybackSeekTarget? {
    guard entries.indices.contains(itemIndex), !entries.isEmpty else { return nil }
    let before = entries[..<itemIndex].reduce(Int64(0)) { $0 + $1.durationMs }
    let total = entries.reduce(Int64(0)) { $0 + $1.durationMs }
    var remaining = min(total, max(0, before + max(0, itemPositionMs) + offsetMs))
    for (index, entry) in entries.enumerated() {
      if remaining < entry.durationMs || index == entries.count - 1 {
        return CarPlaybackSeekTarget(
          itemIndex: index,
          positionMs: min(remaining, entry.durationMs)
        )
      }
      remaining -= entry.durationMs
    }
    return nil
  }

  static func adjacentChapterStart(
    _ entries: [CarPlaybackQueueEntry],
    itemIndex: Int,
    direction: Int
  ) -> Int? {
    guard entries.indices.contains(itemIndex) else { return nil }
    let sections = entries.map(\.sectionIndex).reduce(into: [Int]()) { result, section in
      if result.last != section { result.append(section) }
    }
    guard let current = sections.firstIndex(of: entries[itemIndex].sectionIndex),
      sections.indices.contains(current + direction)
    else { return nil }
    let targetSection = sections[current + direction]
    return entries.firstIndex { $0.sectionIndex == targetSection }
  }
}
