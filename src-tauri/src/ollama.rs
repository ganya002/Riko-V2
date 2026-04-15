use anyhow::Result;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use which::which;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OllamaModel {
    pub name: String,
    pub size_gb: f32,
}

#[derive(Debug, Serialize, Clone)]
pub struct PullProgress {
    pub status: String,
    pub percent: f32,
    pub downloaded_gb: f32,
    pub total_gb: f32,
    pub eta_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaPullEvent {
    status: Option<String>,
    total: Option<u64>,
    completed: Option<u64>,
    error: Option<String>,
    done: Option<bool>,
}

fn resolve_ollama_binary() -> Option<String> {
    crate::setup::ensure_common_bin_paths();
    if let Ok(path) = which("ollama") {
        return Some(path.to_string_lossy().to_string());
    }
    let fallback = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"];
    fallback
        .iter()
        .find(|p| std::path::Path::new(*p).exists())
        .map(|s| s.to_string())
}

/// Check if ollama binary exists on PATH
pub fn is_ollama_installed() -> bool {
    resolve_ollama_binary().is_some()
}

/// List all locally available models that contain "dolphin"
pub fn list_dolphin_models() -> Vec<OllamaModel> {
    let Some(bin) = resolve_ollama_binary() else {
        return vec![];
    };
    let output = std::process::Command::new(bin).arg("list").output();
    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            text.lines()
                .skip(1)
                .filter(|line| line.to_lowercase().contains("dolphin"))
                .filter_map(|line| {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.is_empty() { return None; }
                    let name = parts[0].to_string();
                    let size_gb = parts.windows(2)
                        .find(|w| w[1].to_uppercase() == "GB")
                        .and_then(|w| w[0].parse::<f32>().ok())
                        .unwrap_or(0.0);
                    Some(OllamaModel { name, size_gb })
                })
                .collect()
        }
        Err(_) => vec![],
    }
}

pub fn has_model(model_name: &str) -> bool {
    let Some(bin) = resolve_ollama_binary() else {
        return false;
    };
    let output = std::process::Command::new(bin)
        .args(["show", model_name])
        .output();
    matches!(output, Ok(out) if out.status.success())
}

/// Check if ollama serve is currently running.
/// Async — safe to call from within a Tokio runtime (no blocking I/O).
pub async fn is_ollama_running() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build();
    match client {
        Ok(c) => c.get("http://localhost:11434").send().await.is_ok(),
        Err(_) => false,
    }
}

/// Start ollama serve in the background (non-blocking)
pub fn start_ollama_serve() {
    let Some(bin) = resolve_ollama_binary() else {
        return;
    };
    let _ = std::process::Command::new(bin)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    std::thread::sleep(std::time::Duration::from_millis(1500));
}

/// Pull a model with streaming progress events emitted to the frontend.
pub async fn pull_model_with_progress(app: AppHandle, model_name: String) -> Result<()> {
    let _ = app.emit("pull-progress", PullProgress {
        status: "starting".to_string(),
        percent: 0.0,
        downloaded_gb: 0.0,
        total_gb: 0.0,
        eta_seconds: None,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()?;
    let response = client
        .post("http://127.0.0.1:11434/api/pull")
        .json(&serde_json::json!({
            "name": model_name,
            "stream": true
        }))
        .send()
        .await?;

    if !response.status().is_success() {
        let error_body = response.text().await.unwrap_or_default();
        let _ = app.emit("pull-progress", PullProgress {
            status: "error".to_string(),
            percent: 0.0,
            downloaded_gb: 0.0,
            total_gb: 0.0,
            eta_seconds: None,
        });
        anyhow::bail!("ollama pull request failed: {}", error_body);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut last_downloaded: u64 = 0;
    let mut last_time = std::time::Instant::now();
    let mut speed_bps: f64 = 0.0;

    while let Some(next) = stream.next().await {
        let chunk = next?;
        let chunk_text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_text);

        while let Some(newline_pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline_pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let Ok(event) = serde_json::from_str::<OllamaPullEvent>(line) else {
                continue;
            };

            if let Some(error) = event.error {
                let _ = app.emit("pull-progress", PullProgress {
                    status: "error".to_string(),
                    percent: 0.0,
                    downloaded_gb: 0.0,
                    total_gb: 0.0,
                    eta_seconds: None,
                });
                anyhow::bail!("ollama pull failed: {}", error);
            }

            let status = event.status.unwrap_or_default().to_lowercase();

            if status.contains("verifying") {
                let _ = app.emit("pull-progress", PullProgress {
                    status: "verifying".to_string(),
                    percent: 99.0,
                    downloaded_gb: 0.0,
                    total_gb: 0.0,
                    eta_seconds: Some(0),
                });
                continue;
            }

            if let (Some(total), Some(completed)) = (event.total, event.completed) {
                if total > 0 {
                    let percent = ((completed as f64 / total as f64) * 100.0) as f32;
                    let downloaded_gb = completed as f64 / 1024_f64.powi(3);
                    let total_gb = total as f64 / 1024_f64.powi(3);

                    let elapsed = last_time.elapsed().as_secs_f64();
                    if elapsed > 0.5 && completed > last_downloaded {
                        let instant_speed = (completed - last_downloaded) as f64 / elapsed;
                        speed_bps = speed_bps * 0.7 + instant_speed * 0.3;
                        last_downloaded = completed;
                        last_time = std::time::Instant::now();
                    }

                    let eta_seconds = if speed_bps > 0.0 && completed < total {
                        Some(((total - completed) as f64 / speed_bps) as u64)
                    } else {
                        None
                    };

                    let _ = app.emit("pull-progress", PullProgress {
                        status: "downloading".to_string(),
                        percent,
                        downloaded_gb: downloaded_gb as f32,
                        total_gb: total_gb as f32,
                        eta_seconds,
                    });
                }
            } else if status.contains("pulling") {
                let _ = app.emit("pull-progress", PullProgress {
                    status: "starting".to_string(),
                    percent: 0.0,
                    downloaded_gb: 0.0,
                    total_gb: 0.0,
                    eta_seconds: None,
                });
            }

            if event.done.unwrap_or(false) || status.contains("success") {
                let _ = app.emit("pull-progress", PullProgress {
                    status: "done".to_string(),
                    percent: 100.0,
                    downloaded_gb: 0.0,
                    total_gb: 0.0,
                    eta_seconds: Some(0),
                });
                return Ok(());
            }
        }
    }

    let _ = app.emit("pull-progress", PullProgress {
        status: "done".to_string(),
        percent: 100.0,
        downloaded_gb: 0.0,
        total_gb: 0.0,
        eta_seconds: Some(0),
    });

    Ok(())
}
