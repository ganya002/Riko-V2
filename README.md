# RikoRoast

Your personal AI companion that runs entirely on your Mac. Riko is snarky, honest, and genuinely useful — powered by a local Dolphin model via Ollama. Nothing you say ever leaves your computer.

---

## First-time build (for developers)

You need to build the app once before distributing it. This requires your Mac.

```bash
cd RikoRoast
bash INSTALL.sh
```

The script installs everything automatically:
- Xcode Command Line Tools
- Homebrew
- Node.js
- Rust + Cargo
- Tauri CLI

First build takes ~3–5 minutes (Rust compilation). After that, rebuilds are fast.

The finished app lands at:
```
src-tauri/target/release/bundle/macos/RikoRoast.app
```

Drag it to Applications. Done.

---

## Sharing the app

Once built, just zip `RikoRoast.app` and send it. Recipients:
1. Double-click to launch
2. The setup wizard runs automatically on first launch
3. Installs Homebrew + Ollama if needed, downloads a model
4. Then it's ready to chat

**Recipients don't need to install anything manually** — the wizard handles it.

> **Note:** macOS will ask for your password during Homebrew installation. This is normal — Homebrew needs permission to install to `/opt/homebrew`. The app shows a friendly explanation before this happens.

## Auto-updates

RikoRoast now supports signed macOS updater bundles, so from the first updater-enabled release onward users can get prompted to install new versions instead of deleting and reinstalling the app manually.

One-time setup before building the updater-enabled release:

```bash
npm run tauri signer generate -- -w ~/.tauri/rikoroast-updater.key
export RIKO_UPDATE_REPO="your-github-user/your-repo"
export RIKO_UPDATE_ENDPOINT="https://github.com/$RIKO_UPDATE_REPO/releases/latest/download/latest.json"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/rikoroast-updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
```

Then publish a signed update release with:

```bash
./scripts/publish_update.sh
```

That script:
- builds signed updater artifacts
- generates `latest.json`
- uploads the `.app.tar.gz`, signature, `latest.json`, and share zip to a GitHub release

At app startup, RikoRoast checks the configured feed URL and prompts the user when a newer version is available.

---

## Architecture

```
RikoRoast/
├── src/                    ← Frontend (HTML/CSS/JS)
│   ├── index.html          ← Main chat UI
│   ├── style.css
│   ├── script.js
│   ├── setup.html          ← First-launch wizard
│   ├── setup.css
│   └── setup.js
└── src-tauri/              ← Rust backend
    └── src/
        ├── lib.rs          ← Tauri commands
        ├── main.rs         ← Entry point
        ├── setup.rs        ← Brew/Ollama install pipeline
        ├── ollama.rs       ← Model management + pull progress
        └── hardware.rs     ← RAM/chip detection + model recommendation
```

---

## Adding future features

The setup system is built as a pipeline — adding a new dependency (e.g. Whisper for voice mode) means:

1. Add a check + install function in `setup.rs`
2. Emit events to the frontend at each stage
3. The wizard picks it up automatically

See `setup.rs` → `run_setup_pipeline()` for the pattern.

---

## Development

Run in dev mode (hot reload):
```bash
npm run dev
```

Build for distribution:
```bash
npm run build
```
