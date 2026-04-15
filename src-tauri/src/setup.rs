use anyhow::Result;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use which::which;

#[derive(Clone, serde::Serialize)]
pub struct SetupStepEvent {
    pub step: String,
    pub status: String,
    pub message: String,
}

fn emit(app: &AppHandle, step: &str, status: &str, message: &str) {
    let _ = app.emit("setup-step", SetupStepEvent {
        step: step.to_string(),
        status: status.to_string(),
        message: message.to_string(),
    });
}

const COMMON_BIN_PATHS: [&str; 4] = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
];

pub fn ensure_common_bin_paths() {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut paths: Vec<String> = COMMON_BIN_PATHS.iter().map(|s| s.to_string()).collect();
    paths.extend(current.split(':').map(str::to_string).filter(|s| !s.is_empty()));
    paths.dedup();
    std::env::set_var("PATH", paths.join(":"));
}

pub fn resolve_brew_binary() -> Option<String> {
    ensure_common_bin_paths();
    if let Ok(path) = which("brew") {
        return Some(path.to_string_lossy().to_string());
    }
    let fallback = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
    fallback
        .iter()
        .find(|p| std::path::Path::new(*p).exists())
        .map(|s| s.to_string())
}

pub fn is_brew_installed() -> bool {
    resolve_brew_binary().is_some()
}

pub async fn install_brew(app: AppHandle) -> Result<()> {
    emit(&app, "brew_install", "needs_password",
        "macOS needs your password to install Homebrew. \
         A system prompt will appear — this is completely normal and safe.");

    tokio::time::sleep(std::time::Duration::from_millis(1800)).await;
    emit(&app, "brew_install", "running", "Installing Homebrew…");

    let script = r#"/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)""#;
    let output = tokio::process::Command::new("/bin/bash")
        .args(["-c", script])
        .env("NONINTERACTIVE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if output.status.success() {
        std::env::set_var("PATH", format!(
            "/opt/homebrew/bin:/usr/local/bin:{}",
            std::env::var("PATH").unwrap_or_default()
        ));
        emit(&app, "brew_install", "done", "Homebrew installed successfully!");
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let msg = format!(
            "Homebrew installation failed: {}\nPlease run manually in Terminal:\n\
             /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
            err.lines().last().unwrap_or("unknown error")
        );
        emit(&app, "brew_install", "error", &msg);
        anyhow::bail!("brew install failed")
    }
}

pub async fn install_ollama(app: AppHandle) -> Result<()> {
    emit(&app, "ollama_install", "running", "Installing Ollama via Homebrew…");

    let brew_bin = resolve_brew_binary().ok_or_else(|| anyhow::anyhow!("Homebrew not found"))?;
    let output = tokio::process::Command::new(brew_bin)
        .args(["install", "ollama"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if output.status.success() {
        emit(&app, "ollama_install", "done", "Ollama installed successfully!");
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let msg = format!(
            "Ollama installation failed: {}\nPlease run: brew install ollama",
            err.lines().last().unwrap_or("unknown error")
        );
        emit(&app, "ollama_install", "error", &msg);
        anyhow::bail!("ollama install failed")
    }
}

pub async fn run_setup_pipeline(app: AppHandle) -> Result<()> {
    ensure_common_bin_paths();

    // Step 1: Homebrew
    emit(&app, "brew_check", "running", "Checking for Homebrew…");
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;

    if is_brew_installed() {
        emit(&app, "brew_check", "done", "Homebrew is already installed ✓");
    } else {
        emit(&app, "brew_check", "done", "Homebrew not found — installing…");
        install_brew(app.clone()).await?;
    }

    // Step 2: Ollama
    emit(&app, "ollama_check", "running", "Checking for Ollama…");
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;

    if crate::ollama::is_ollama_installed() {
        emit(&app, "ollama_check", "done", "Ollama is already installed ✓");
    } else {
        emit(&app, "ollama_check", "done", "Ollama not found — installing…");
        install_ollama(app.clone()).await?;
    }

    // Step 3: Start ollama serve
    emit(&app, "ollama_serve", "running", "Starting Ollama in the background…");
    if !crate::ollama::is_ollama_running().await {
        crate::ollama::start_ollama_serve();
        // Wait a moment and verify it started
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        if !crate::ollama::is_ollama_running().await {
            emit(&app, "ollama_serve", "error",
                "Ollama didn't start. Try running 'ollama serve' in a terminal.");
            anyhow::bail!("ollama serve failed to start");
        }
    }
    emit(&app, "ollama_serve", "done", "Ollama is running ✓");

    emit(&app, "pipeline_done", "done", "Setup complete!");
    Ok(())
}
