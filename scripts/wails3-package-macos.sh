#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-package-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

APP_NAME="$(plutil -extract outputfilename raw -o - "$ROOT_DIR/wails.json")"
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi

VERSION="${ARLE_WAILS3_APP_VERSION:-0.0.0-beta}"
BUILD_NUMBER="${ARLE_WAILS3_APP_BUILD:-1}"
BUNDLE_ID="${ARLE_WAILS3_BUNDLE_ID:-io.arlecchino.ide}"
DISPLAY_NAME="${ARLE_WAILS3_APP_DISPLAY_NAME:-Arlecchino}"
MIN_MACOS_VERSION="${ARLE_WAILS3_MIN_MACOS:-11.0}"
SIGN_MODE="${ARLE_WAILS3_SIGN_MODE:-none}"
OUTPUT="${ARLE_WAILS3_OUTPUT:-$BUILD_DIR/bin/$APP_NAME-v3}"
APP_BUNDLE="${ARLE_WAILS3_APP_BUNDLE:-$BUILD_DIR/bin/$APP_NAME.app}"
SKIP_BUILD="0"
SKIP_FRONTEND="0"

usage() {
  cat <<'EOF'
Usage: scripts/wails3-package-macos.sh [options]

Options:
  --app-bundle <path>   Output .app path.
  --output <path>       Intermediate Wails v3 binary path.
  --bundle-id <id>      CFBundleIdentifier.
  --version <version>   CFBundleShortVersionString.
  --build <number>      CFBundleVersion.
  --min-macos <version> LSMinimumSystemVersion.
  --skip-build          Reuse an existing --output binary.
  --skip-frontend       Pass --skip-frontend to the v3 build script.
  --sign <mode>         none, adhoc, or developer-id.

Build artifacts are written outside the repository by default through wails.json build:dir.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-bundle)
      shift
      APP_BUNDLE="${1:-}"
      shift
      ;;
    --output)
      shift
      OUTPUT="${1:-}"
      shift
      ;;
    --bundle-id)
      shift
      BUNDLE_ID="${1:-}"
      shift
      ;;
    --version)
      shift
      VERSION="${1:-}"
      shift
      ;;
    --build)
      shift
      BUILD_NUMBER="${1:-}"
      shift
      ;;
    --min-macos)
      shift
      MIN_MACOS_VERSION="${1:-}"
      shift
      ;;
    --skip-build)
      SKIP_BUILD="1"
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND="1"
      shift
      ;;
    --sign)
      shift
      SIGN_MODE="${1:-}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$APP_BUNDLE" || "$APP_BUNDLE" != *.app ]]; then
  echo "ERROR: --app-bundle must end with .app" >&2
  exit 1
fi

copy_runtime_assets() {
  local assets_dir="$RESOURCES_DIR/assets"
  local asset source dest source_sha dest_sha
  local runtime_assets=(arle_model.onnx arle_tokenizer.json)

  mkdir -p "$assets_dir"
  chmod 0755 "$assets_dir"

  for asset in "${runtime_assets[@]}"; do
    source="$ROOT_DIR/assets/$asset"
    dest="$assets_dir/$asset"
    if [[ ! -s "$source" ]]; then
      echo "ERROR: required runtime asset is missing or empty: $source" >&2
      exit 1
    fi

    cp -Xf "$source" "$dest"
    chmod 0644 "$dest"
    xattr -cr "$dest" >/dev/null 2>&1 || true

    if [[ ! -r "$dest" || ! -s "$dest" ]]; then
      echo "ERROR: packaged runtime asset is missing, unreadable, or empty: $dest" >&2
      exit 1
    fi
    if ! cmp -s "$source" "$dest"; then
      echo "ERROR: packaged runtime asset differs from source: $asset" >&2
      exit 1
    fi
    source_sha="$(shasum -a 256 "$source" | awk '{print $1}')"
    dest_sha="$(shasum -a 256 "$dest" | awk '{print $1}')"
    if [[ "$source_sha" != "$dest_sha" ]]; then
      echo "ERROR: packaged runtime asset checksum mismatch: $asset" >&2
      exit 1
    fi
  done
}

if [[ "$SKIP_BUILD" != "1" ]]; then
  BUILD_ARGS=(--build-only --output "$OUTPUT")
  if [[ "$SKIP_FRONTEND" == "1" ]]; then
    BUILD_ARGS+=(--skip-frontend)
  fi
  "$ROOT_DIR/scripts/wails3-dev-macos.sh" "${BUILD_ARGS[@]}"
elif [[ ! -x "$OUTPUT" ]]; then
  echo "ERROR: --skip-build requires an executable --output binary: $OUTPUT" >&2
  exit 1
fi

INFO_TEMPLATE="$ROOT_DIR/build/darwin/Info.wails3.plist"
if [[ ! -f "$INFO_TEMPLATE" ]]; then
  echo "ERROR: missing Info.plist template: $INFO_TEMPLATE" >&2
  exit 1
fi

rm -rf "$APP_BUNDLE"
MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$OUTPUT" "$MACOS_DIR/$APP_NAME"
chmod +x "$MACOS_DIR/$APP_NAME"

cp "$INFO_TEMPLATE" "$APP_BUNDLE/Contents/Info.plist"
export ARLE_TEMPLATE_APP_DISPLAY_NAME="$DISPLAY_NAME"
export ARLE_TEMPLATE_APP_EXECUTABLE="$APP_NAME"
export ARLE_TEMPLATE_BUNDLE_ID="$BUNDLE_ID"
export ARLE_TEMPLATE_APP_NAME="$APP_NAME"
export ARLE_TEMPLATE_APP_VERSION="$VERSION"
export ARLE_TEMPLATE_APP_BUILD="$BUILD_NUMBER"
export ARLE_TEMPLATE_MIN_MACOS_VERSION="$MIN_MACOS_VERSION"
export ARLE_TEMPLATE_COPYRIGHT_YEAR="$(date +%Y)"
perl -0pi -e '
s/__APP_DISPLAY_NAME__/$ENV{ARLE_TEMPLATE_APP_DISPLAY_NAME}/g;
s/__APP_EXECUTABLE__/$ENV{ARLE_TEMPLATE_APP_EXECUTABLE}/g;
s/__BUNDLE_ID__/$ENV{ARLE_TEMPLATE_BUNDLE_ID}/g;
s/__APP_NAME__/$ENV{ARLE_TEMPLATE_APP_NAME}/g;
s/__APP_VERSION__/$ENV{ARLE_TEMPLATE_APP_VERSION}/g;
s/__APP_BUILD__/$ENV{ARLE_TEMPLATE_APP_BUILD}/g;
s/__MIN_MACOS_VERSION__/$ENV{ARLE_TEMPLATE_MIN_MACOS_VERSION}/g;
s/__COPYRIGHT_YEAR__/$ENV{ARLE_TEMPLATE_COPYRIGHT_YEAR}/g;
' "$APP_BUNDLE/Contents/Info.plist"

cp -Xf "$ROOT_DIR/build/darwin/iconfile.icns" "$RESOURCES_DIR/iconfile.icns"
if [[ -f "$ROOT_DIR/build/darwin/Assets.car" ]]; then
  cp -Xf "$ROOT_DIR/build/darwin/Assets.car" "$RESOURCES_DIR/Assets.car"
fi
if [[ -f "$ROOT_DIR/build/darwin/appicon-light.png" ]]; then
  cp -Xf "$ROOT_DIR/build/darwin/appicon-light.png" "$RESOURCES_DIR/appicon-light.png"
fi
if [[ -f "$ROOT_DIR/build/darwin/appicon-dark.png" ]]; then
  cp -Xf "$ROOT_DIR/build/darwin/appicon-dark.png" "$RESOURCES_DIR/appicon-dark.png"
fi
copy_runtime_assets
xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true

/usr/bin/plutil -lint "$APP_BUNDLE/Contents/Info.plist" >/dev/null

if [[ "$SIGN_MODE" != "none" ]]; then
  "$ROOT_DIR/scripts/wails3-sign-macos.sh" --app-bundle "$APP_BUNDLE" --mode "$SIGN_MODE"
fi

echo "Packaged Wails v3 app bundle: $APP_BUNDLE"
