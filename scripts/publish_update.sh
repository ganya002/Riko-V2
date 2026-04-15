#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it with: brew install gh" >&2
  exit 1
fi

if [[ -z "${RIKO_UPDATE_REPO:-}" ]]; then
  echo "Set RIKO_UPDATE_REPO to your GitHub repo, for example: export RIKO_UPDATE_REPO=owner/RikoRoast" >&2
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/rikoroast-updater.key"
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && ! -f "${TAURI_SIGNING_PRIVATE_KEY_PATH}" ]]; then
  echo "Updater private key not found at ${TAURI_SIGNING_PRIVATE_KEY_PATH}" >&2
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "${TAURI_SIGNING_PRIVATE_KEY_PATH}")"
fi
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

export RIKO_UPDATE_ENDPOINT="https://github.com/${RIKO_UPDATE_REPO}/releases/latest/download/latest.json"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
NOTES_FILE="${1:-}"

if [[ -z "$NOTES_FILE" ]]; then
  NOTES_FILE="$(mktemp)"
  cat >"$NOTES_FILE" <<EOF
RikoRoast ${VERSION}

- App update published from the local release workflow.
EOF
  CLEANUP_NOTES=1
else
  CLEANUP_NOTES=0
fi

echo "Building RikoRoast ${VERSION} for auto-update publishing..."
npm run build

APP_BUNDLE="src-tauri/target/release/bundle/macos/RikoRoast.app"
APP_TAR="src-tauri/target/release/bundle/macos/RikoRoast.app.tar.gz"
APP_SIG="${APP_TAR}.sig"
SHARE_ROOT="src-tauri/target/release/bundle/share"
SHARE_DIR="${SHARE_ROOT}/RikoRoast-Share"
SHARE_ZIP="src-tauri/target/release/bundle/share/RikoRoast-Share.zip"
LATEST_JSON="src-tauri/target/release/bundle/macos/latest.json"

for path in "$APP_BUNDLE" "$APP_TAR" "$APP_SIG"; do
  if [[ ! -e "$path" ]]; then
    echo "Missing expected build artifact: $path" >&2
    exit 1
  fi
done

rm -rf "$SHARE_DIR"
mkdir -p "$SHARE_DIR"
cp -R "$APP_BUNDLE" "$SHARE_DIR/"
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

xattr -dr com.apple.quarantine "$SRC_APP" 2>/dev/null || true
rm -rf "$DST_APP"
cp -R "$SRC_APP" "/Applications/"
xattr -dr com.apple.quarantine "$DST_APP" 2>/dev/null || true
open "$DST_APP"
osascript -e 'display dialog "RikoRoast was installed to Applications and opened." buttons {"OK"} default button "OK"'
EOF
chmod +x "$SHARE_DIR/Install RikoRoast.command"
rm -f "$SHARE_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$SHARE_DIR" "$SHARE_ZIP"

PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
SIGNATURE="$(tr -d '\n' < "$APP_SIG")"
NOTES_CONTENT="$(cat "$NOTES_FILE")"

node - <<'EOF' "$LATEST_JSON" "$VERSION" "$PUB_DATE" "$RIKO_UPDATE_REPO" "$SIGNATURE" "$NOTES_CONTENT"
const fs = require('fs');
const [outPath, version, pubDate, repo, signature, notes] = process.argv.slice(2);
const assetUrl = `https://github.com/${repo}/releases/download/v${version}/RikoRoast.app.tar.gz`;
const payload = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    "darwin-aarch64": {
      signature,
      url: assetUrl
    }
  }
};
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
EOF

if gh release view "$TAG" --repo "$RIKO_UPDATE_REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists in ${RIKO_UPDATE_REPO}. Delete it or bump the app version first." >&2
  exit 1
fi

echo "Publishing GitHub release ${TAG} to ${RIKO_UPDATE_REPO}..."
gh release create "$TAG" \
  "$APP_TAR" \
  "$APP_SIG" \
  "$LATEST_JSON" \
  "$SHARE_ZIP" \
  --repo "$RIKO_UPDATE_REPO" \
  --title "RikoRoast ${VERSION}" \
  --notes-file "$NOTES_FILE" \
  --latest

echo
echo "Published ${TAG}"
echo "Updater feed: ${RIKO_UPDATE_ENDPOINT}"
echo "Share zip: https://github.com/${RIKO_UPDATE_REPO}/releases/download/${TAG}/RikoRoast-Share.zip"

if [[ "$CLEANUP_NOTES" == "1" ]]; then
  rm -f "$NOTES_FILE"
fi
