#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v brew >/dev/null 2>&1; then
  NODE22_PREFIX="$(brew --prefix node@22 2>/dev/null || true)"
  if [[ -n "${NODE22_PREFIX:-}" && -d "$NODE22_PREFIX/bin" ]]; then
    export PATH="$NODE22_PREFIX/bin:$PATH"
  fi
fi
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
APP_NAME="$(plutil -extract outputfilename raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi
APP_BUNDLE="$BUILD_DIR/bin/$APP_NAME.app"
SYNC_SCRIPT="$ROOT_DIR/scripts/macos-sync-icon-assets.sh"
WATCH_INTERVAL="${ARLE_ICON_WATCH_INTERVAL:-1}"

watch_pid=""

cleanup() {
  if [[ -n "$watch_pid" ]] && kill -0 "$watch_pid" >/dev/null 2>&1; then
    kill "$watch_pid" >/dev/null 2>&1 || true
    wait "$watch_pid" 2>/dev/null || true
  fi
}

seed_wails_build_assets() {
  local source_build_dir="$ROOT_DIR/build"
  local target_build_dir="$BUILD_DIR"

  mkdir -p "$target_build_dir/darwin"
  cp -Xf "$source_build_dir/appicon.png" "$target_build_dir/appicon.png"
  cp -Xf "$source_build_dir/darwin/Info.dev.plist" "$target_build_dir/darwin/Info.dev.plist"
  cp -Xf "$source_build_dir/darwin/Info.plist" "$target_build_dir/darwin/Info.plist"
  cp -Xf "$source_build_dir/darwin/iconfile.icns" "$target_build_dir/darwin/iconfile.icns"
  xattr -cr "$target_build_dir/appicon.png" "$target_build_dir/darwin" >/dev/null 2>&1 || true
}

prepare_dev_assets() {
  seed_wails_build_assets
  "$SYNC_SCRIPT" >/dev/null 2>&1 || true
}

sync_bundle() {
  if [[ -d "$APP_BUNDLE" ]]; then
    xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true
    "$SYNC_SCRIPT" "$APP_BUNDLE" >/dev/null 2>&1 || true
    xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true
  fi
}

watch_bundle() {
  local last_info_mtime=""

  while true; do
    if [[ -f "$APP_BUNDLE/Contents/Info.plist" ]]; then
      local info_plist="$APP_BUNDLE/Contents/Info.plist"
      local info_mtime
      info_mtime="$(stat -f '%m' "$info_plist" 2>/dev/null || echo 0)"

      if [[ "$info_mtime" != "$last_info_mtime" ]]; then
        local icon_file
        local icon_name
        icon_file="$(plutil -extract CFBundleIconFile raw -o - "$info_plist" 2>/dev/null || echo "")"
        icon_name="$(plutil -extract CFBundleIconName raw -o - "$info_plist" 2>/dev/null || echo "")"

        if [[ "$icon_file" != "appicon" || "$icon_name" != "appicon" || ! -f "$APP_BUNDLE/Contents/Resources/Assets.car" || ! -f "$APP_BUNDLE/Contents/Resources/appicon.icns" || ! -f "$APP_BUNDLE/Contents/Resources/appicon-light.png" || ! -f "$APP_BUNDLE/Contents/Resources/appicon-dark.png" ]]; then
          sync_bundle
          info_mtime="$(stat -f '%m' "$info_plist" 2>/dev/null || echo "$info_mtime")"
        fi

        last_info_mtime="$info_mtime"
      fi
    fi

    sleep "$WATCH_INTERVAL"
  done
}

trap cleanup EXIT INT TERM

prepare_dev_assets
watch_bundle >/dev/null 2>&1 &
watch_pid="$!"

cd "$ROOT_DIR"
wails dev "$@"
