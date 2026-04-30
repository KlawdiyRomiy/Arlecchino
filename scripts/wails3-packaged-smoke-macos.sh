#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="feature/wails3-shell-spike"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-packaged-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
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

OUTPUT="${ARLE_WAILS3_OUTPUT:-$BUILD_DIR/bin/$APP_NAME-v3}"
BUILD_ONLY="0"
SMOKE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only)
      BUILD_ONLY="1"
      shift
      ;;
    --output)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --output requires a path." >&2
        exit 1
      fi
      OUTPUT="$1"
      shift
      ;;
    --)
      shift
      SMOKE_ARGS=("$@")
      break
      ;;
    *)
      SMOKE_ARGS+=("$1")
      shift
      ;;
  esac
done

ARLE_WAILS3_OUTPUT="$OUTPUT" "$ROOT_DIR/scripts/wails3-dev-macos.sh" --build-only

if [[ "$BUILD_ONLY" == "1" ]]; then
  exit 0
fi

export ARLECCHINO_PACKAGED_BUILD="${ARLECCHINO_PACKAGED_BUILD:-1}"
export ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE="${ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE:-1}"
export ARLECCHINO_WAILS3_SMOKE_BUILD_TARGET="$OUTPUT"

"$OUTPUT" wails3-packaged-smoke --pretty --working-dir "$ROOT_DIR" -- "${SMOKE_ARGS[@]}"
