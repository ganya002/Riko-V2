# RikoRoast

RikoRoast is a Mac app. You open it, talk to Riko, and the AI runs on your own Mac with Ollama instead of sending your chats somewhere else.

This repo contains:
- the app itself
- the first-time setup wizard
- automatic update publishing
- local voice playback and local speech-to-text support

## Normal Install

If someone sends you a `RikoRoast-Share.zip`, do this:

1. Download the zip.
2. Double-click the zip so it opens into a folder.
3. Open the folder.
4. Double-click `Install RikoRoast.command`.
5. If macOS warns you, click to continue or open it anyway.
6. The installer copies `RikoRoast.app` into your `Applications` folder and opens it.
7. The first launch wizard starts.

That is it. You do not need to install Homebrew, Xcode, Ollama, ffmpeg, whisper, or anything else yourself. The app checks for what it needs and installs missing parts when needed.

## First Launch

When RikoRoast opens for the first time, it may do a few setup steps:

1. Check Homebrew.
2. Check Ollama.
3. Start Ollama.
4. Ask you to choose a model for your Mac.

If something is missing, the app tries to install it for you.

Important:
- macOS may ask for your password during Homebrew installs. That is normal.
- The app never sees or stores your password.
- The first setup can take a while because AI models are large.

## Updating The App

RikoRoast now supports in-app updates.

What that means:
- old manual builds still need to be installed once
- from the updater-enabled build onward, users should get an update prompt inside the app when a newer version is published
- they should not need to delete the app and reinstall every time

Current update feed:
- [latest.json](https://github.com/ganya002/Riko-V2/releases/latest/download/latest.json)

Current releases:
- [GitHub Releases](https://github.com/ganya002/Riko-V2/releases)

## If Something Looks Broken

Try these in order:

1. Close the app and open it again.
2. Open `Settings`.
3. Leave `Auto-repair dependencies on launch` turned on.
4. If voice input is enabled, wait a bit for speech tools to install the first time.
5. If Ollama says a model is missing, let the app redownload it.

## Developer Build

If you are building the app from source on your own Mac:

```bash
cd /Users/gabriel/Downloads/RikoRoast
bash INSTALL.sh
```

That script installs the developer tools needed to build the app.

The finished app ends up here:

```text
src-tauri/target/release/bundle/macos/RikoRoast.app
```

## Publish A New Version

This project can publish a full signed updater release to GitHub.

Before publishing, make sure these are available in your shell:

```bash
export RIKO_UPDATE_REPO="ganya002/Riko-V2"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/rikoroast-updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

Then run:

```bash
./scripts/publish_update.sh
```

That does all of this:
- builds the Mac app
- creates the updater package
- signs the updater package
- generates `latest.json`
- creates a fresh `RikoRoast-Share.zip`
- uploads everything to GitHub Releases

## Project Structure

```text
RikoRoast/
├── src/                  frontend HTML, CSS, and JS
├── src-tauri/            Rust backend and Mac packaging
├── scripts/              release publishing helpers
├── INSTALL.sh            one-shot developer setup script
└── README.md             this file
```
