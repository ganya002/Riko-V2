mod hardware;
mod ollama;
mod setup;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

// ─── Tauri Commands ────────────────────────────────────────────

#[tauri::command]
async fn run_setup(app: AppHandle) -> Result<(), String> {
    setup::run_setup_pipeline(app)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_hardware() -> hardware::HardwareInfo {
    hardware::get_hardware_info()
}

#[tauri::command]
fn get_model_recommendation() -> hardware::ModelRecommendation {
    let hw = hardware::get_hardware_info();
    hardware::recommend_model(&hw)
}

#[tauri::command]
fn get_model_catalog() -> hardware::ModelCatalog {
    let hw = hardware::get_hardware_info();
    hardware::model_catalog(&hw)
}

#[tauri::command]
fn list_models() -> Vec<ollama::OllamaModel> {
    ollama::list_dolphin_models()
}

#[tauri::command]
async fn check_ollama_running() -> bool {
    ollama::is_ollama_running().await
}

#[tauri::command]
fn start_ollama() {
    ollama::start_ollama_serve();
}

#[tauri::command]
async fn pull_model(app: AppHandle, model_name: String) -> Result<(), String> {
    ollama::pull_model_with_progress(app, model_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn is_setup_complete(app: AppHandle) -> bool {
    let path = app
        .path()
        .app_data_dir()
        .unwrap_or_default()
        .join("setup_complete");
    path.exists()
}

#[tauri::command]
fn mark_setup_complete(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("setup_complete"), b"1").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn launch_chat(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Window not found")?;
    window
        .eval("window.location.href = 'index.html'")
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_saved_model(app: AppHandle) -> Option<String> {
    let path = app
        .path()
        .app_data_dir()
        .unwrap_or_default()
        .join("selected_model");
    std::fs::read_to_string(path).ok()
}

#[tauri::command]
fn save_model(app: AppHandle, model_name: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("selected_model"), model_name.as_bytes())
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
struct RuntimeHealth {
    brew_installed: bool,
    ollama_installed: bool,
    ollama_running: bool,
    selected_model: Option<String>,
    selected_model_installed: bool,
}

struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadata {
    version: String,
    current_version: String,
    body: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadEvent {
    event: String,
    chunk_length: Option<u64>,
    downloaded: Option<u64>,
    content_length: Option<u64>,
}

#[derive(Debug, Serialize)]
struct SpeechRuntimeHealth {
    ffmpeg_installed: bool,
    whisper_installed: bool,
    stt_model_present: bool,
}

fn expand_path(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("path cannot be empty".to_string());
    }
    if input == "~" || input.starts_with("~/") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        return Ok(Path::new(&home).join(input.trim_start_matches("~/")));
    }
    let p = PathBuf::from(input);
    if p.is_absolute() {
        Ok(p)
    } else {
        Ok(std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(p))
    }
}

#[tauri::command]
async fn runtime_health_check(app: AppHandle) -> RuntimeHealth {
    setup::ensure_common_bin_paths();
    let selected_model = get_saved_model(app.clone()).map(|m| m.trim().to_string());
    let selected_model_installed = selected_model
        .as_ref()
        .map(|m| ollama::has_model(m))
        .unwrap_or(false);

    RuntimeHealth {
        brew_installed: setup::is_brew_installed(),
        ollama_installed: ollama::is_ollama_installed(),
        ollama_running: ollama::is_ollama_running().await,
        selected_model,
        selected_model_installed,
    }
}

#[tauri::command]
async fn repair_runtime(app: AppHandle) -> Result<Vec<String>, String> {
    setup::ensure_common_bin_paths();
    let mut actions = Vec::new();

    if !setup::is_brew_installed() {
        setup::install_brew(app.clone())
            .await
            .map_err(|e| e.to_string())?;
        actions.push("Installed Homebrew".to_string());
    }

    if !ollama::is_ollama_installed() {
        setup::install_ollama(app.clone())
            .await
            .map_err(|e| e.to_string())?;
        actions.push("Installed Ollama".to_string());
    }

    if !ollama::is_ollama_running().await {
        ollama::start_ollama_serve();
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        if !ollama::is_ollama_running().await {
            return Err("Ollama failed to start".to_string());
        }
        actions.push("Started Ollama".to_string());
    }

    Ok(actions)
}

#[tauri::command]
async fn ensure_model_installed(app: AppHandle, model_name: String) -> Result<(), String> {
    if ollama::has_model(&model_name) {
        return Ok(());
    }
    ollama::pull_model_with_progress(app, model_name)
        .await
        .map_err(|e| e.to_string())
}

fn stt_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|dir| dir.join("stt"))
}

fn stt_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    stt_model_dir(app).map(|dir| dir.join("ggml-base.en.bin"))
}

#[tauri::command]
fn speech_runtime_health_check(app: AppHandle) -> Result<SpeechRuntimeHealth, String> {
    setup::ensure_common_bin_paths();
    let model_present = stt_model_path(&app)?.exists();
    Ok(SpeechRuntimeHealth {
        ffmpeg_installed: setup::is_ffmpeg_installed(),
        whisper_installed: setup::is_whisper_installed(),
        stt_model_present: model_present,
    })
}

#[tauri::command]
async fn ensure_stt_runtime(app: AppHandle) -> Result<Vec<String>, String> {
    setup::ensure_common_bin_paths();
    let mut actions = Vec::new();

    if !setup::is_ffmpeg_installed() {
        setup::install_ffmpeg(app.clone())
            .await
            .map_err(|e| e.to_string())?;
        actions.push("Installed ffmpeg".to_string());
    }

    if !setup::is_whisper_installed() {
        setup::install_whisper_cpp(app.clone())
            .await
            .map_err(|e| e.to_string())?;
        actions.push("Installed whisper.cpp".to_string());
    }

    let model_path = stt_model_path(&app)?;
    if !model_path.exists() {
        let parent = model_path
            .parent()
            .ok_or_else(|| "Invalid STT model path".to_string())?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

        let response = reqwest::get("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin")
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("Failed to download Whisper model: HTTP {}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        tokio::fs::write(&model_path, bytes)
            .await
            .map_err(|e| e.to_string())?;
        actions.push("Downloaded Whisper STT model".to_string());
    }

    Ok(actions)
}

#[tauri::command]
async fn stt_transcribe_audio(
    app: AppHandle,
    audio_base64: String,
    mime_type: Option<String>,
) -> Result<String, String> {
    use base64::Engine;

    ensure_stt_runtime(app.clone()).await?;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(audio_base64)
        .map_err(|e| e.to_string())?;

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("stt");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let extension = match mime_type.as_deref().unwrap_or_default() {
        "audio/webm" => "webm",
        "audio/mp4" | "audio/x-m4a" | "audio/m4a" => "m4a",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/wave" => "wav",
        _ => "webm",
    };

    let stamp = chrono_like_timestamp();
    let input_path = cache_dir.join(format!("input-{}.{}", stamp, extension));
    let wav_path = cache_dir.join(format!("input-{}.wav", stamp));
    let out_base = cache_dir.join(format!("transcript-{}", stamp));
    let out_txt = cache_dir.join(format!("transcript-{}.txt", stamp));
    let model_path = stt_model_path(&app)?;

    tokio::fs::write(&input_path, decoded)
        .await
        .map_err(|e| e.to_string())?;

    let ffmpeg = which::which("ffmpeg")
        .map_err(|e| e.to_string())?;
    let ffmpeg_output = tokio::process::Command::new(ffmpeg)
        .args([
            "-y",
            "-i",
            &input_path.to_string_lossy(),
            "-ar",
            "16000",
            "-ac",
            "1",
            &wav_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !ffmpeg_output.status.success() {
        return Err(String::from_utf8_lossy(&ffmpeg_output.stderr).to_string());
    }

    let whisper = which::which("whisper-cli")
        .map_err(|e| e.to_string())?;
    let whisper_output = tokio::process::Command::new(whisper)
        .args([
            "-m",
            &model_path.to_string_lossy(),
            "-f",
            &wav_path.to_string_lossy(),
            "-l",
            "en",
            "-otxt",
            "-of",
            &out_base.to_string_lossy(),
            "-np",
            "-nt",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !whisper_output.status.success() {
        return Err(String::from_utf8_lossy(&whisper_output.stderr).to_string());
    }

    let text = tokio::fs::read_to_string(&out_txt)
        .await
        .map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
}

fn update_endpoint() -> Option<String> {
    option_env!("RIKO_UPDATE_ENDPOINT")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[tauri::command]
fn get_update_endpoint() -> Option<String> {
    update_endpoint()
}

#[tauri::command]
async fn check_for_app_update(
    app: AppHandle,
    pending_update: tauri::State<'_, PendingUpdate>,
) -> Result<Option<UpdateMetadata>, String> {
    let Some(endpoint) = update_endpoint() else {
        return Ok(None);
    };

    let url = url::Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let metadata = update.as_ref().map(|update| UpdateMetadata {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        body: update.body.clone(),
        date: update.date.map(|value| value.to_string()),
    });

    *pending_update.0.lock().map_err(|e| e.to_string())? = update;
    Ok(metadata)
}

#[tauri::command]
async fn install_app_update(
    app: AppHandle,
    pending_update: tauri::State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "No pending update. Check for an update first.".to_string())?;

    let mut started = false;
    let mut downloaded: u64 = 0;

    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = app.emit(
                        "app-update-download",
                        UpdateDownloadEvent {
                            event: "started".to_string(),
                            chunk_length: None,
                            downloaded: Some(0),
                            content_length,
                        },
                    );
                }

                downloaded += chunk_length as u64;
                let _ = app.emit(
                    "app-update-download",
                    UpdateDownloadEvent {
                        event: "progress".to_string(),
                        chunk_length: Some(chunk_length as u64),
                        downloaded: Some(downloaded),
                        content_length,
                    },
                );
            },
            || {
                let _ = app.emit(
                    "app-update-download",
                    UpdateDownloadEvent {
                        event: "finished".to_string(),
                        chunk_length: None,
                        downloaded: None,
                        content_length: None,
                    },
                );
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}

#[tauri::command]
fn computer_read_file(path: String) -> Result<String, String> {
    let path = expand_path(&path)?;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn computer_write_file(path: String, content: String, append: bool) -> Result<(), String> {
    let path = expand_path(&path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if append {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())
    } else {
        std::fs::write(path, content).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn computer_delete_path(path: String) -> Result<(), String> {
    let path = expand_path(&path)?;
    if path.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn computer_list_dir(path: String) -> Result<Vec<String>, String> {
    let path = expand_path(&path)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        out.push(entry.path().to_string_lossy().to_string());
    }
    Ok(out)
}

#[tauri::command]
fn computer_run_shell(command: String, args: Vec<String>) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}\n{}", stdout, stderr))
}

#[tauri::command]
fn autonomous_create_note(app: AppHandle, text: String) -> Result<String, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("RikoRoast Autonomous Notes");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!("riko-note-{}.txt", chrono_like_timestamp());
    let path = dir.join(filename);
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn autonomous_notes_dir(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("RikoRoast Autonomous Notes");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn computer_close_app(app_name: String) -> Result<(), String> {
    Command::new("osascript")
        .args([
            "-e",
            &format!("tell application \"{}\" to quit", app_name.replace('"', "")),
        ])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn tts_list_system_voices() -> Result<Vec<String>, String> {
    let output = Command::new("say")
        .args(["-v", "?"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let voices = text
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    Ok(voices)
}

#[tauri::command]
fn tts_generate_chunk(
    app: AppHandle,
    text: String,
    voice: Option<String>,
    rate: Option<u16>,
) -> Result<String, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("tts-chunks");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let filename = format!("tts-{}.aiff", chrono_like_timestamp());
    let out = cache_dir.join(filename);

    let chosen_voice = voice.unwrap_or_else(|| "Samantha".to_string());
    let chosen_rate = rate.unwrap_or(188).clamp(120, 260).to_string();
    let clean_text = text.replace('\n', " ").trim().to_string();
    if clean_text.is_empty() {
        return Err("empty tts text chunk".to_string());
    }

    let output = Command::new("say")
        .args([
            "-v",
            &chosen_voice,
            "-r",
            &chosen_rate,
            "-o",
            &out.to_string_lossy(),
            "--",
            &clean_text,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(out.to_string_lossy().to_string())
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

// ─── App entry ─────────────────────────────────────────────────
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            run_setup,
            get_hardware,
            get_model_recommendation,
            get_model_catalog,
            list_models,
            check_ollama_running,
            start_ollama,
            pull_model,
            is_setup_complete,
            mark_setup_complete,
            launch_chat,
            get_saved_model,
            save_model,
            runtime_health_check,
            repair_runtime,
            ensure_model_installed,
            speech_runtime_health_check,
            ensure_stt_runtime,
            stt_transcribe_audio,
            get_update_endpoint,
            check_for_app_update,
            install_app_update,
            computer_read_file,
            computer_write_file,
            computer_delete_path,
            computer_list_dir,
            computer_run_shell,
            autonomous_create_note,
            autonomous_notes_dir,
            computer_close_app,
            tts_list_system_voices,
            tts_generate_chunk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RikoRoast");
}
