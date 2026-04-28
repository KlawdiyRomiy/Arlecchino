#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="feature/wails3-shell-spike"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-dev-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if command -v brew >/dev/null 2>&1; then
  NODE22_PREFIX="$(brew --prefix node@22 2>/dev/null || true)"
  if [[ -n "${NODE22_PREFIX:-}" && -d "$NODE22_PREFIX/bin" ]]; then
    export PATH="$NODE22_PREFIX/bin:$PATH"
  fi
fi

if ! go list -m github.com/wailsapp/wails/v3 >/dev/null 2>&1; then
  echo "ERROR: Wails v3 module was not found in go.mod." >&2
  echo "Use scripts/wails-dev-macos.sh on the Wails v2 branch." >&2
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
export GOCACHE="${ARLE_WAILS3_GOCACHE:-$BUILD_DIR/go-build-cache}"
BUILD_ONLY="0"
SKIP_FRONTEND="0"
APP_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only)
      BUILD_ONLY="1"
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND="1"
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
      APP_ARGS=("$@")
      break
      ;;
    *)
      APP_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "$SKIP_FRONTEND" != "1" ]]; then
  cd "$ROOT_DIR/frontend"
  npm run build
fi

mkdir -p "$(dirname "$OUTPUT")" "$GOCACHE"
cd "$ROOT_DIR"
go build -o "$OUTPUT" .

echo "Built Wails v3 spike binary: $OUTPUT"

if [[ "$BUILD_ONLY" = "1" ]]; then
  exit 0
fi

exec "$OUTPUT" "${APP_ARGS[@]}"
