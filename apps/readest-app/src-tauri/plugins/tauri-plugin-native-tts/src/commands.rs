use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NativeTtsExt;
use crate::Result;

#[command]
pub(crate) async fn init<R: Runtime>(app: AppHandle<R>) -> Result<InitResponse> {
    app.native_tts().init()
}

#[command]
pub(crate) async fn speak<R: Runtime>(
    app: AppHandle<R>,
    payload: SpeakArgs,
) -> Result<SpeakResponse> {
    app.native_tts().speak(payload)
}

#[command]
pub(crate) async fn pause<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().pause()
}

#[command]
pub(crate) async fn resume<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().resume()
}

#[command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().stop()
}

#[command]
pub(crate) async fn set_rate<R: Runtime>(app: AppHandle<R>, payload: SetRateArgs) -> Result<()> {
    app.native_tts().set_rate(payload)
}

#[command]
pub(crate) async fn set_pitch<R: Runtime>(app: AppHandle<R>, payload: SetPitchArgs) -> Result<()> {
    app.native_tts().set_pitch(payload)
}

#[command]
pub(crate) async fn set_voice<R: Runtime>(app: AppHandle<R>, payload: SetVoiceArgs) -> Result<()> {
    app.native_tts().set_voice(payload)
}

#[command]
pub(crate) async fn get_all_voices<R: Runtime>(app: AppHandle<R>) -> Result<GetVoicesResponse> {
    app.native_tts().get_all_voices()
}

#[command]
pub(crate) async fn set_media_session_active<R: Runtime>(
    app: AppHandle<R>,
    payload: SetMediaSessionActiveRequest,
) -> Result<()> {
    app.native_tts().set_media_session_active(payload)
}

#[command]
pub(crate) async fn update_media_session_state<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateMediaSessionStateRequest,
) -> Result<()> {
    app.native_tts().update_media_session_state(payload)
}

#[command]
pub(crate) async fn update_media_session_metadata<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateMediaSessionMetadataRequest,
) -> Result<()> {
    app.native_tts().update_media_session_metadata(payload)
}

#[command]
pub(crate) async fn update_audiobook_library<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateAudiobookLibraryRequest,
) -> Result<()> {
    app.native_tts().update_audiobook_library(payload)
}

#[command]
pub(crate) async fn update_audiobook_chapters<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateAudiobookChaptersRequest,
) -> Result<()> {
    app.native_tts().update_audiobook_chapters(payload)
}

#[command]
pub(crate) async fn update_audiobook_playback_manifest<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateAudiobookPlaybackManifestRequest,
) -> Result<()> {
    app.native_tts().update_audiobook_playback_manifest(payload)
}

#[command]
pub(crate) async fn update_audiobook_playback_location<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateAudiobookPlaybackLocationRequest,
) -> Result<()> {
    app.native_tts().update_audiobook_playback_location(payload)
}

#[command]
pub(crate) async fn get_audiobook_playback_location<R: Runtime>(
    app: AppHandle<R>,
    payload: GetAudiobookPlaybackLocationRequest,
) -> Result<GetAudiobookPlaybackLocationResponse> {
    app.native_tts().get_audiobook_playback_location(payload)
}

#[command]
pub(crate) async fn take_audiobook_pending_bookmarks<R: Runtime>(
    app: AppHandle<R>,
    payload: TakeAudiobookPendingBookmarksRequest,
) -> Result<TakeAudiobookPendingBookmarksResponse> {
    app.native_tts().take_audiobook_pending_bookmarks(payload)
}

#[command]
pub(crate) async fn control_audiobook_playback<R: Runtime>(
    app: AppHandle<R>,
    payload: AudiobookPlaybackCommandRequest,
) -> Result<AudiobookPlaybackSnapshot> {
    app.native_tts().control_audiobook_playback(payload)
}

#[command]
pub(crate) async fn get_audiobook_playback_snapshot<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AudiobookPlaybackSnapshot> {
    app.native_tts().get_audiobook_playback_snapshot()
}

#[command]
pub(crate) async fn show_audio_route_picker<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.native_tts().show_audio_route_picker()
}
