#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v brew >/dev/null 2>&1; then
  NODE22_PREFIX="$(brew --prefix node@22 2>/dev/null || true)"
  if [[ -n "${NODE22_PREFIX:-}" && -d "$NODE22_PREFIX/bin" ]]; then
    export PATH="$NODE22_PREFIX/bin:$PATH"
  fi
fi
APP_NAME="$(plutil -extract outputfilename raw -o - "$ROOT_DIR/wails.json")"
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi
SYNC_SCRIPT="$ROOT_DIR/scripts/macos-sync-icon-assets.sh"

seed_wails_build_assets() {
  local source_build_dir="$ROOT_DIR/build"
  local target_build_dir="$BUILD_DIR"
  local asset

  mkdir -p "$target_build_dir/darwin"
  cp -Xf "$source_build_dir/appicon.png" "$target_build_dir/appicon.png"
  cp -Xf "$source_build_dir/darwin/Info.dev.plist" "$target_build_dir/darwin/Info.dev.plist"
  cp -Xf "$source_build_dir/darwin/Info.plist" "$target_build_dir/darwin/Info.plist"
  for asset in iconfile.icns Assets.car appicon-light.png appicon-dark.png; do
    if [[ -f "$source_build_dir/darwin/$asset" ]]; then
      cp -Xf "$source_build_dir/darwin/$asset" "$target_build_dir/darwin/$asset"
    fi
  done
  xattr -cr "$target_build_dir/appicon.png" "$target_build_dir/darwin" >/dev/null 2>&1 || true
}

cd "$ROOT_DIR"
seed_wails_build_assets
wails build "$@"

if [[ -d "$BUILD_DIR/bin/$APP_NAME.app" ]]; then
  "$SYNC_SCRIPT" "$BUILD_DIR/bin/$APP_NAME.app"
  exit 0
fi

"$SYNC_SCRIPT"
