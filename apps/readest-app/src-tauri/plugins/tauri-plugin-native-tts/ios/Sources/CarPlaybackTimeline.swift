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

enum CarPlaybackTimeline {
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
