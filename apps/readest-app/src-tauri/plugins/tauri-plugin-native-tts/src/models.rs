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
    pub path: String,
    pub clip_begin_ms: u64,
    pub clip_end_ms: u64,
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
    pub current_section_index: Option<u32>,
    pub sections: Vec<CarPlaybackSection>,
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
            "bookId":"abc123","title":"Book","author":"Author","currentSectionIndex":4,
            "sections":[{"sectionIndex":4,"label":"One","durationMs":12000,
              "segments":[{"path":"/data/audio.mp3","clipBeginMs":1250,"clipEndMs":5500,
                "cues":[{"offsetMs":500,"text":"text/c1.xhtml#p1"}]}]}]
        }"#;
        let payload: UpdateAudiobookPlaybackManifestRequest = serde_json::from_str(json).unwrap();
        assert_eq!(payload.current_section_index, Some(4));
        assert_eq!(payload.sections[0].segments[0].clip_begin_ms, 1250);
        assert_eq!(payload.sections[0].segments[0].cues[0].offset_ms, 500);
    }
}
