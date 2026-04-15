#!/bin/bash
# ─────────────────────────────────────────────────────────────────
#  RikoRoast — First-time build script
#  Run this once from the RikoRoast folder:  bash INSTALL.sh
# ─────────────────────────────────────────────────────────────────

set -e  # exit on any error

# ── Colours ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${RESET}"; }
info() { echo -e "${BLUE}  → $1${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${RESET}"; }
fail() { echo -e "${RED}  ✗ $1${RESET}"; exit 1; }
step() { echo -e "\n${BOLD}── $1${RESET}"; }

echo ""
echo -e "${BOLD}  RikoRoast — Build Setup${RESET}"
echo -e "  This script will install everything needed to build the app."
echo ""

# ── 1. Xcode Command Line Tools ───────────────────────────────────
step "Checking Xcode Command Line Tools"
if xcode-select -p &>/dev/null; then
    ok "Xcode CLT already installed"
else
    info "Installing Xcode Command Line Tools…"
    xcode-select --install 2>/dev/null || true
    echo ""
    warn "A dialog appeared asking you to install Xcode tools."
    warn "Click 'Install', wait for it to finish, then re-run this script."
    exit 0
fi

# ── 2. Homebrew ───────────────────────────────────────────────────
step "Checking Homebrew"
if command -v brew &>/dev/null; then
    ok "Homebrew already installed"
else
    info "Installing Homebrew (you may be asked for your password)…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add brew to PATH for Apple Silicon and Intel
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
fi

# Ensure brew is on PATH for this session
if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# ── 3. Node.js ────────────────────────────────────────────────────
step "Checking Node.js"
if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    ok "Node.js $NODE_VER already installed"
else
    info "Installing Node.js via Homebrew…"
    brew install node
    ok "Node.js installed"
fi

# ── 4. Rust ───────────────────────────────────────────────────────
step "Checking Rust"
if command -v rustc &>/dev/null; then
    RUST_VER=$(rustc --version)
    ok "Rust already installed: $RUST_VER"
else
    info "Installing Rust via rustup…"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    source "$HOME/.cargo/env"
    ok "Rust installed"
fi

# Make sure cargo is on PATH for this session
if [[ -f "$HOME/.cargo/env" ]]; then
    source "$HOME/.cargo/env"
fi

# ── 5. Tauri system dependencies (macOS) ─────────────────────────
step "Checking macOS build dependencies"
# Tauri on macOS needs nothing extra beyond Xcode CLT + Rust.
# Verify we have the Apple target (needed on Apple Silicon)
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    info "Apple Silicon detected — ensuring aarch64 Rust target…"
    rustup target add aarch64-apple-darwin 2>/dev/null || true
    ok "aarch64-apple-darwin target ready"
else
    info "Intel Mac detected — ensuring x86_64 Rust target…"
    rustup target add x86_64-apple-darwin 2>/dev/null || true
    ok "x86_64-apple-darwin target ready"
fi

# ── 6. npm install ────────────────────────────────────────────────
step "Installing Node dependencies"
if [[ ! -f "package.json" ]]; then
    fail "package.json not found. Run this script from the RikoRoast folder."
fi
npm install --silent
ok "Node dependencies installed"

# ── 7. Build ──────────────────────────────────────────────────────
step "Building RikoRoast.app"
info "This compiles Rust code — first build takes 2–5 minutes. Grab a coffee ☕"
echo ""

npm run build

APP_PATH="src-tauri/target/release/bundle/macos/RikoRoast.app"
SHARE_ROOT="src-tauri/target/release/bundle/share"
SHARE_DIR="$SHARE_ROOT/RikoRoast-Share"
SHARE_ZIP="$SHARE_ROOT/RikoRoast-Share.zip"

# ── 8. Re-sign app + create share package ───────────────────────
step "Preparing shareable package"

if [[ -d "$APP_PATH" ]]; then
    info "Re-signing app bundle (ad-hoc) to avoid 'app is damaged' errors…"
    if codesign --force --deep --sign - "$APP_PATH"; then
        ok "App re-signed"
    else
        warn "codesign step failed. App may be blocked on other Macs."
    fi

    info "Creating share folder + installer helper…"
    rm -rf "$SHARE_DIR"
    mkdir -p "$SHARE_DIR"
    cp -R "$APP_PATH" "$SHARE_DIR/"

    cat > "$SHARE_DIR/Install RikoRoast.command" <<'EOF'
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="RikoRoast.app"
SRC_APP="$SCRIPT_DIR/$APP_NAME"
DST_APP="/Applications/$APP_NAME"

if [[ ! -d "$SRC_APP" ]]; then
  osascript -e 'display dialog "Could not find RikoRoast.app next to this installer." buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi

# Remove quarantine metadata that can appear after transfer/download
xattr -dr com.apple.quarantine "$SRC_APP" 2>/dev/null || true

rm -rf "$DST_APP"
cp -R "$SRC_APP" "/Applications/"
xattr -dr com.apple.quarantine "$DST_APP" 2>/dev/null || true

open "$DST_APP"
osascript -e 'display dialog "RikoRoast was installed to Applications and opened." buttons {"OK"} default button "OK"'
EOF
    chmod +x "$SHARE_DIR/Install RikoRoast.command"
    ok "Share folder ready"

    info "Creating zip for AirDrop/sharing…"
    rm -f "$SHARE_ZIP"
    ditto -c -k --sequesterRsrc --keepParent "$SHARE_DIR" "$SHARE_ZIP"
    ok "Share zip created: $SHARE_ZIP"
else
    warn "Could not find built app at $APP_PATH — skipping share package."
fi

echo ""
echo -e "${GREEN}${BOLD}  ✓ Build complete!${RESET}"
echo ""
echo -e "  Your app is at:"
echo -e "  ${BOLD}src-tauri/target/release/bundle/macos/RikoRoast.app${RESET}"
echo ""
echo -e "  Drag it to your ${BOLD}Applications${RESET} folder and double-click to launch."
echo ""
echo -e "  Share zip:"
echo -e "  ${BOLD}src-tauri/target/release/bundle/share/RikoRoast-Share.zip${RESET}"
echo ""
