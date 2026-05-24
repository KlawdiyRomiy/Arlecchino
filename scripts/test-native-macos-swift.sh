#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi
NATIVE_SWIFT_DIR="${ARLE_NATIVE_MACOS_BUILD_DIR:-$BUILD_DIR/native/macos}"

"$ROOT_DIR/scripts/build-native-macos-swift.sh"

cd "$ROOT_DIR"
export CGO_LDFLAGS="-L$NATIVE_SWIFT_DIR ${CGO_LDFLAGS:-}"
go test -tags arle_swift_bridge -run 'Test(ShouldRestoreWindowForMacReopen|ShouldFocusWindowForMacReopen|BuildOpenIntentFromLaunchArgs|DispatchOpenIntentFromOSTarget|Wails3InfoPlist|ApplicationMenu|ShellMenu|PackagedOSNative|Credential)' ./internal/app
