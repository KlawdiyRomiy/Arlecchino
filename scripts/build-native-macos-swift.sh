#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="$(plutil -extract outputfilename raw -o - "$ROOT_DIR/wails.json")"
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi

OUTPUT_DIR="${ARLE_NATIVE_MACOS_BUILD_DIR:-$BUILD_DIR/native/macos}"
LIB_NAME="libarlecchino_native.a"
MODULE_NAME="ArlecchinoNativeBridge"
SWIFT_SOURCES=("$ROOT_DIR"/native/macos/*.swift)

if [[ ${#SWIFT_SOURCES[@]} -eq 0 || ! -f "${SWIFT_SOURCES[1]:-${SWIFT_SOURCES[0]}}" ]]; then
  echo "ERROR: no Swift native bridge sources found in native/macos" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

swiftc \
  -emit-library \
  -static \
  -parse-as-library \
  -module-name "$MODULE_NAME" \
  -framework AppKit \
  -framework Foundation \
  -framework Security \
  -framework UserNotifications \
  "${SWIFT_SOURCES[@]}" \
  -o "$OUTPUT_DIR/$LIB_NAME"

echo "Built macOS Swift native bridge for $APP_NAME: $OUTPUT_DIR/$LIB_NAME"
