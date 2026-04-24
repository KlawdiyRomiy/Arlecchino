#!/bin/zsh

set -euo pipefail
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ICON_DOC="$ROOT_DIR/build/appicon.icon"
DARWIN_DIR="$ROOT_DIR/build/darwin"
LEGACY_ICNS="$DARWIN_DIR/iconfile.icns"
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
  xattr -cr "$RESOURCES_DIR/Assets.car" "$RESOURCES_DIR/iconfile.icns" "$RESOURCES_DIR/appicon.icns" >/dev/null 2>&1 || true

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
