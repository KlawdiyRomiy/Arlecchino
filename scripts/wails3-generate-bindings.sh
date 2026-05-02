#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"
WAILS3_VERSION="${ARLE_WAILS3_VERSION:-v3.0.0-alpha.78}"
OUTPUT_DIR="${ARLE_WAILS3_BINDINGS_DIR:-frontend/bindings}"
OUTPUT_DIR_SET="0"
WRITE="0"
EXTRA_ARGS=()

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-generate-bindings.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write)
      WRITE="1"
      shift
      ;;
    --dry-run)
      WRITE="0"
      shift
      ;;
    --output-dir)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --output-dir requires a path." >&2
        exit 1
      fi
      OUTPUT_DIR="$1"
      OUTPUT_DIR_SET="1"
      shift
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "$WRITE" != "1" && "$OUTPUT_DIR_SET" != "1" ]]; then
  OUTPUT_DIR="${TMPDIR:-/tmp}/arlecchino-wails3-bindings-dry"
fi

FLAGS=(-b -ts -d "$OUTPUT_DIR")
if [[ "$WRITE" != "1" ]]; then
  FLAGS=(-dry "${FLAGS[@]}")
fi

cd "$ROOT_DIR"
go run "github.com/wailsapp/wails/v3/cmd/wails3@$WAILS3_VERSION" generate bindings "${FLAGS[@]}" "${EXTRA_ARGS[@]}" .
