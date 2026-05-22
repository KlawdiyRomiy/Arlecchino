#!/bin/zsh

set -euo pipefail
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ICON_DOC="$ROOT_DIR/build/appicon.icon"
DARWIN_DIR="$ROOT_DIR/build/darwin"
LEGACY_ICNS="$DARWIN_DIR/iconfile.icns"
APPICON_LIGHT_PNG="$DARWIN_DIR/appicon-light.png"
APPICON_DARK_PNG="$DARWIN_DIR/appicon-dark.png"
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
APP_NAME="$(plutil -extract outputfilename raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi
APP_BUNDLE="${1:-$BUILD_DIR/bin/$APP_NAME.app}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/arle-icon.XXXXXX")"
MACOS_MAJOR_VERSION="$(sw_vers -productVersion | cut -d . -f 1)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
BUNDLE_IDENTIFIER="io.arlecchino.ide"
ICON_COMPOSER_TOOL="${ICON_COMPOSER_TOOL:-}"

find_icon_composer_tool() {
  if [[ -n "$ICON_COMPOSER_TOOL" && -x "$ICON_COMPOSER_TOOL" ]]; then
    return 0
  fi

  local developer_dir
  developer_dir="$(xcode-select -p 2>/dev/null || true)"
  local candidates=(
    "$developer_dir/../Applications/Icon Composer.app/Contents/Executables/ictool"
    "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
    "/Applications/Icon Composer.app/Contents/Executables/ictool"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      ICON_COMPOSER_TOOL="$candidate"
      return 0
    fi
  done

  return 1
}

have_composer_icon_pngs() {
  [[ -f "$APPICON_LIGHT_PNG" && -f "$APPICON_DARK_PNG" ]]
}

export_composer_icon_png() {
  local rendition="$1"
  local output_path="$2"

  "$ICON_COMPOSER_TOOL" "$ICON_DOC" \
    --export-image \
    --output-file "$output_path" \
    --platform macOS \
    --rendition "$rendition" \
    --width 1024 \
    --height 1024 \
    --scale 1 >/dev/null
  xattr -cr "$output_path" >/dev/null 2>&1 || true
}

ensure_composer_icon_pngs() {
  if find_icon_composer_tool; then
    export_composer_icon_png "Default" "$APPICON_LIGHT_PNG"
    export_composer_icon_png "Dark" "$APPICON_DARK_PNG"
    return 0
  fi

  if have_composer_icon_pngs; then
    echo "Icon Composer ictool unavailable; reusing checked-in appicon-light.png and appicon-dark.png" >&2
    return 0
  fi

  echo "Missing appicon-light.png/appicon-dark.png and Icon Composer ictool is unavailable; install Xcode with Icon Composer or set ICON_COMPOSER_TOOL." >&2
  return 1
}

set_icon_keys() {
  local plist_path="$1"

  [[ -f "$plist_path" ]] || return 0

  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$plist_path" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconName string appicon" "$plist_path" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconName appicon" "$plist_path" >/dev/null 2>&1 || true

  if [[ "$MACOS_MAJOR_VERSION" -ge 26 ]]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile appicon" "$plist_path" >/dev/null 2>&1 || true
  else
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile iconfile" "$plist_path" >/dev/null 2>&1 || true
  fi
}

set_bundle_identifier() {
  local plist_path="$1"

  [[ -f "$plist_path" ]] || return 0

  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_IDENTIFIER" "$plist_path" >/dev/null 2>&1 || true
}

if [[ ! -d "$ICON_DOC" ]]; then
  echo "Missing Icon Composer document: $ICON_DOC" >&2
  exit 1
fi

if [[ ! -f "$LEGACY_ICNS" ]]; then
  echo "Missing legacy fallback icon: $LEGACY_ICNS" >&2
  exit 1
fi

ensure_composer_icon_pngs

xcrun actool \
  --compile "$TMP_DIR" \
  --platform macosx \
  --target-device mac \
  --minimum-deployment-target 10.13 \
  --app-icon appicon \
  --output-format human-readable-text \
  --warnings \
  --errors \
  --notices \
  --output-partial-info-plist "$TMP_DIR/partial.plist" \
  "$ICON_DOC" >/dev/null

cp -Xf "$TMP_DIR/Assets.car" "$DARWIN_DIR/Assets.car"
xattr -cr "$DARWIN_DIR/Assets.car" >/dev/null 2>&1 || true
set_icon_keys "$DARWIN_DIR/Info.dev.plist"
set_icon_keys "$DARWIN_DIR/Info.plist"
set_bundle_identifier "$DARWIN_DIR/Info.dev.plist"
set_bundle_identifier "$DARWIN_DIR/Info.plist"
xattr -cr "$DARWIN_DIR/Info.dev.plist" "$DARWIN_DIR/Info.plist" >/dev/null 2>&1 || true

if [[ -d "$APP_BUNDLE" ]]; then
  RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
  INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"

  mkdir -p "$RESOURCES_DIR"
  xattr -cr "$APP_BUNDLE" >/dev/null 2>&1 || true
  cp -Xf "$DARWIN_DIR/Assets.car" "$RESOURCES_DIR/Assets.car"
  cp -Xf "$LEGACY_ICNS" "$RESOURCES_DIR/iconfile.icns"
  cp -Xf "$TMP_DIR/appicon.icns" "$RESOURCES_DIR/appicon.icns"
  cp -Xf "$APPICON_LIGHT_PNG" "$RESOURCES_DIR/appicon-light.png"
  cp -Xf "$APPICON_DARK_PNG" "$RESOURCES_DIR/appicon-dark.png"
  xattr -cr "$RESOURCES_DIR/Assets.car" "$RESOURCES_DIR/iconfile.icns" "$RESOURCES_DIR/appicon.icns" "$RESOURCES_DIR/appicon-light.png" "$RESOURCES_DIR/appicon-dark.png" >/dev/null 2>&1 || true

  set_icon_keys "$INFO_PLIST"
  set_bundle_identifier "$INFO_PLIST"
  xattr -cr "$INFO_PLIST" "$RESOURCES_DIR" "$APP_BUNDLE" >/dev/null 2>&1 || true

  touch "$APP_BUNDLE" "$INFO_PLIST" "$RESOURCES_DIR"
  if [[ -x "$LSREGISTER" ]]; then
    "$LSREGISTER" -f "$APP_BUNDLE" >/dev/null 2>&1 || true
  fi
  echo "Updated bundle icon assets: $APP_BUNDLE"
else
  echo "Compiled Assets.car to $DARWIN_DIR/Assets.car"
  echo "Bundle not found, skipped live sync: $APP_BUNDLE"
fi
