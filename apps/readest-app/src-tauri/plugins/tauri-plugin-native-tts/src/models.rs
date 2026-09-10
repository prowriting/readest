use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSVoice {
    pub id: String,
    pub name: String,
    pub lang: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSMessageEvent {
    pub code: String, // 'boundary' | 'error' | 'end'
    pub message: Option<String>,
    pub mark: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakArgs {
    pub text: String,
    #[serde(default)]
    pub preload: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakResponse {
    pub utterance_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRateArgs {
    pub rate: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPitchArgs {
    pub pitch: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVoiceArgs {
    pub voice: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetVoicesResponse {
    pub voices: Vec<TTSVoice>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMediaSessionActiveRequest {
    pub active: bool,
    pub keep_app_in_foreground: bool,
    pub notification_title: Option<String>,
    pub notification_text: Option<String>,
    pub foreground_service_title: Option<String>,
    pub foreground_service_text: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMediaSessionStateRequest {
    pub playing: bool,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub playback_rate: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMediaSessionMetadataRequest {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAudiobook {
    pub id: String,
    pub title: String,
    pub author: String,
    pub duration_sec: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAudiobookLibraryRequest {
    pub books: Vec<BridgeAudiobook>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeChapter {
    pub index: u32,
    pub label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAudiobookChaptersRequest {
    pub book_id: String,
    pub chapters: Vec<BridgeChapter>,
    pub current_index: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarPlaybackCue {
    pub offset_ms: u64,
    pub text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarPlaybackSegment {
    pub href: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub path: String,
    pub clip_begin_ms: u64,
    pub clip_end_ms: u64,
    pub source_duration_ms: u64,
    pub cues: Vec<CarPlaybackCue>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarPlaybackSection {
    pub section_index: u32,
    pub label: String,
    pub duration_ms: u64,
    pub segments: Vec<CarPlaybackSegment>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAudiobookPlaybackManifestRequest {
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub cover_path: Option<String>,
    pub sections: Vec<CarPlaybackSection>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadiumLocatorLocations {
    pub fragments: Vec<String>,
    pub progression: Option<f64>,
    pub total_progression: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadiumLocator {
    pub href: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub title: Option<String>,
    pub locations: ReadiumLocatorLocations,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiobookPlaybackLocation {
    pub schema_version: u32,
    pub edition_id: String,
    pub locator: ReadiumLocator,
    pub text_locator: Option<ReadiumLocator>,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAudiobookPlaybackLocationRequest {
    pub location: AudiobookPlaybackLocation,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAudiobookPlaybackLocationRequest {
    pub book_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAudiobookPlaybackLocationResponse {
    pub location: Option<AudiobookPlaybackLocation>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeAudiobookPendingBookmarksRequest {
    pub book_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeAudiobookPendingBookmarksResponse {
    pub locations: Vec<AudiobookPlaybackLocation>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiobookPlaybackCommandRequest {
    pub action: String,
    pub book_id: Option<String>,
    pub location: Option<AudiobookPlaybackLocation>,
    pub chapter_index: Option<u32>,
    pub offset_ms: Option<i64>,
    pub rate: Option<f64>,
    pub volume: Option<f64>,
    pub mode: Option<String>,
    pub ends_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiobookPlaybackSnapshot {
    pub session_id: String,
    pub sequence: u64,
    pub book_id: String,
    pub state: String,
    pub location: Option<AudiobookPlaybackLocation>,
    pub chapter_index: i32,
    pub chapter_position_ms: u64,
    pub chapter_duration_ms: u64,
    pub playback_rate: f64,
    pub is_bookmarked: bool,
    pub sleep_timer_ends_at: Option<u64>,
    pub error: Option<String>,
}

#[cfg(test)]
mod bridge_contract_tests {
    use super::*;

    // These JSON strings are exactly what the TS side sends
    // (src/services/audiobook/carBridge.ts) — the wire contract.
    #[test]
    fn deserializes_the_library_payload_from_ts() {
        let json = r#"{
            "books": [
                {"id": "abc123", "title": "New Audio", "author": "A. Author", "durationSec": 30},
                {"id": "def456", "title": "Old Audio", "author": "", "durationSec": 0}
            ]
        }"#;
        let payload: UpdateAudiobookLibraryRequest = serde_json::from_str(json).unwrap();
        assert_eq!(payload.books.len(), 2);
        assert_eq!(payload.books[0].id, "abc123");
        assert_eq!(payload.books[0].duration_sec, 30.0);
    }

    #[test]
    fn deserializes_the_chapters_payload_from_ts() {
        let json = r#"{
            "bookId": "abc123",
            "currentIndex": 1,
            "chapters": [
                {"index": 0, "label": "Chapter 1"},
                {"index": 1, "label": "Chapter 2"}
            ]
        }"#;
        let payload: UpdateAudiobookChaptersRequest = serde_json::from_str(json).unwrap();
        assert_eq!(payload.book_id, "abc123");
        assert_eq!(payload.current_index, Some(1));
        assert_eq!(payload.chapters[1].label, "Chapter 2");
    }

    #[test]
    fn chapters_payload_tolerates_a_missing_current_index() {
        let json = r#"{"bookId": "abc123", "chapters": []}"#;
        let payload: UpdateAudiobookChaptersRequest = serde_json::from_str(json).unwrap();
        assert_eq!(payload.current_index, None);
    }

    #[test]
    fn deserializes_the_shared_car_playback_manifest() {
        let json = r#"{
            "bookId":"abc123","title":"Book","author":"Author",
            "sections":[{"sectionIndex":4,"label":"One","durationMs":12000,
              "segments":[{"href":"audio/ch1.mp3","type":"audio/mpeg","path":"/data/audio.mp3",
                "clipBeginMs":1250,"clipEndMs":5500,"sourceDurationMs":10000,
                "cues":[{"offsetMs":500,"text":"text/c1.xhtml#p1"}]}]}]
        }"#;
        let payload: UpdateAudiobookPlaybackManifestRequest = serde_json::from_str(json).unwrap();
        assert_eq!(payload.sections[0].segments[0].href, "audio/ch1.mp3");
        assert_eq!(payload.sections[0].segments[0].clip_begin_ms, 1250);
        assert_eq!(payload.sections[0].segments[0].cues[0].offset_ms, 500);
    }

    #[test]
    fn deserializes_native_audiobook_commands_from_typescript() {
        let seek: AudiobookPlaybackCommandRequest = serde_json::from_str(
            r#"{"action":"seekRelative","offsetMs":30000}"#,
        )
        .unwrap();
        assert_eq!(seek.action, "seekRelative");
        assert_eq!(seek.offset_ms, Some(30_000));

        let play: AudiobookPlaybackCommandRequest = serde_json::from_str(
            r#"{"action":"play","bookId":"abc123"}"#,
        )
        .unwrap();
        assert_eq!(play.book_id.as_deref(), Some("abc123"));
    }

    #[test]
    fn serializes_the_authoritative_native_snapshot_for_typescript() {
        let snapshot = AudiobookPlaybackSnapshot {
            session_id: "session-1".into(),
            sequence: 7,
            book_id: "abc123".into(),
            state: "playing".into(),
            location: None,
            chapter_index: 2,
            chapter_position_ms: 12_000,
            chapter_duration_ms: 60_000,
            playback_rate: 1.25,
            is_bookmarked: false,
            sleep_timer_ends_at: None,
            error: None,
        };
        let json = serde_json::to_value(snapshot).unwrap();
        assert_eq!(json["sessionId"], "session-1");
        assert_eq!(json["chapterPositionMs"], 12_000);
        assert_eq!(json["playbackRate"], 1.25);
    }
}
