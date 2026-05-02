#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-ui-launch-target-macos.sh is only for $EXPECTED_BRANCH." >&2
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

MODE="dev"
BUILD_DEV="1"
SKIP_FRONTEND="0"
OUTPUT="${ARLE_WAILS3_UI_OUTPUT:-$BUILD_DIR/bin/$APP_NAME-v3-ui-automation}"
PACKAGED_TARGET="${ARLE_WAILS3_PACKAGED_TARGET:-}"
METADATA_PATH="${ARLE_WAILS3_UI_BRIDGE_METADATA:-$BUILD_DIR/ui-automation/mcp-bridge.json}"
APP_ARGS=()

usage() {
  cat <<EOF
Usage: scripts/wails3-ui-launch-target-macos.sh [--dev | --packaged <app-or-executable>] [options] [-- app args...]

Prints a shell-readable Wails v3 launch target for UI automation.

Options:
  --dev                         Build/print the dev binary target (default)
  --packaged <app-or-executable> Print a packaged .app or executable target
  --output <path>                Dev binary path (default: $OUTPUT)
  --no-build                     Do not build the dev binary before printing
  --skip-frontend                Skip frontend build when building dev target
  -h, --help                     Show this help
EOF
}

quote_shell() {
  printf "%q" "$1"
}

resolve_packaged_executable() {
  local target="$1"
  if [[ -d "$target" && "$target" == *.app ]]; then
    local plist="$target/Contents/Info.plist"
    local executable
    executable="$(plutil -extract CFBundleExecutable raw -o - "$plist" 2>/dev/null || true)"
    if [[ -z "${executable:-}" ]]; then
      executable="$APP_NAME"
    fi
    printf "%s\n" "$target/Contents/MacOS/$executable"
    return 0
  fi

  printf "%s\n" "$target"
}

render_launch_command() {
  local target="$1"
  local command
  command="cd $(quote_shell "$ROOT_DIR") && ARLECCHINO_DISABLE_MCP_BOOTSTRAP=1 ARLECCHINO_MCP_BRIDGE_METADATA_PATH=$(quote_shell "$METADATA_PATH") $(quote_shell "$target")"

  local arg
  for arg in "${APP_ARGS[@]}"; do
    command="$command $(quote_shell "$arg")"
  done

  printf "%s\n" "$command"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      MODE="dev"
      shift
      ;;
    --packaged)
      MODE="packaged"
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --packaged requires a .app or executable path." >&2
        exit 1
      fi
      PACKAGED_TARGET="$1"
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
    --no-build)
      BUILD_DEV="0"
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      APP_ARGS=("$@")
      break
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  dev)
    if [[ "$BUILD_DEV" == "1" ]]; then
      build_args=(--build-only --output "$OUTPUT")
      if [[ "$SKIP_FRONTEND" == "1" ]]; then
        build_args+=(--skip-frontend)
      fi
      "$ROOT_DIR/scripts/wails3-dev-macos.sh" "${build_args[@]}"
    fi
    TARGET="$OUTPUT"
    ;;
  packaged)
    if [[ -z "${PACKAGED_TARGET:-}" ]]; then
      echo "ERROR: --packaged requires a .app or executable path." >&2
      exit 1
    fi
    TARGET="$(resolve_packaged_executable "$PACKAGED_TARGET")"
    ;;
  *)
    echo "ERROR: unsupported launch target mode: $MODE" >&2
    exit 1
    ;;
esac

if [[ ! -x "$TARGET" ]]; then
  echo "ERROR: launch target is not executable: $TARGET" >&2
  exit 1
fi

mkdir -p "$(dirname "$METADATA_PATH")"

cat <<EOF
ARLE_WAILS3_LAUNCH_MODE=$MODE
ARLE_WAILS3_LAUNCH_TARGET=$(quote_shell "$TARGET")
ARLE_WAILS3_LAUNCH_CWD=$(quote_shell "$ROOT_DIR")
ARLECCHINO_DISABLE_MCP_BOOTSTRAP=1
ARLECCHINO_MCP_BRIDGE_METADATA_PATH=$(quote_shell "$METADATA_PATH")
ARLE_WAILS3_LAUNCH_COMMAND=$(quote_shell "$(render_launch_command "$TARGET")")
EOF
