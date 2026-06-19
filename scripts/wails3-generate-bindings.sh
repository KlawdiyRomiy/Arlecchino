#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"
WAILS3_VERSION="${ARLE_WAILS3_VERSION:-v3.0.0-alpha2.103}"
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
MODULE_VERSION="$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v3)"
if [[ "$MODULE_VERSION" != "$WAILS3_VERSION" ]]; then
  echo "ERROR: go.mod pins github.com/wailsapp/wails/v3@$MODULE_VERSION, expected $WAILS3_VERSION." >&2
  echo "Update go.mod or set ARLE_WAILS3_VERSION to match the pinned module." >&2
  exit 1
fi

TOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-tool.XXXXXX")"
trap 'rm -rf "$TOOL_DIR"' EXIT

(
  cd "$TOOL_DIR"
  go mod init arlecchino-wails3-tool >/dev/null
  go mod edit -require "github.com/wailsapp/wails/v3@$WAILS3_VERSION"
  go build -mod=mod -o "$TOOL_DIR/wails3" github.com/wailsapp/wails/v3/cmd/wails3
)

"$TOOL_DIR/wails3" generate bindings "${FLAGS[@]}" "${EXTRA_ARGS[@]}" .
