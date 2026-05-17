#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
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
FRONTEND_DEV_SERVER="0"
FRONTEND_DEV_HOST="${ARLE_WAILS3_FRONTEND_DEV_HOST:-127.0.0.1}"
FRONTEND_DEV_PORT="${ARLE_WAILS3_FRONTEND_DEV_PORT:-5173}"
WEB_ONLY="0"
KEEP_STALE_MCP="${ARLE_WAILS3_KEEP_STALE_MCP:-0}"
APP_ARGS=()
app_pid=""
frontend_pid=""

usage() {
  cat <<EOF
Usage: scripts/wails3-dev-macos.sh [options] [-- app args...]

Options:
  --build-only                 Build the Wails v3 binary and exit
  --skip-frontend              Skip the production frontend build
  --output <path>              Binary output path
  --frontend-dev-server        Run Vite on 5173 and point the Wails WebView at it
  --frontend-dev-host <host>   Frontend dev server host (default: $FRONTEND_DEV_HOST)
  --frontend-dev-port <port>   Frontend dev server port (default: $FRONTEND_DEV_PORT)
  --web-only                   Run browser-friendly Vite only with the Wails runtime stub
  -h, --help                   Show this help
EOF
}

find_mcp_server_pids_for_output() {
  local target="$1"
  if [[ -z "${target:-}" ]]; then
    return 0
  fi

  ps -axo pid=,command= | awk -v target="$target" -v self="$$" '
    {
      pid = $1
      command = $0
      sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", command)
      if (pid != self && index(command, target) > 0 && index(command, " mcp-server") > 0) {
        print pid
      }
    }
  '
}

terminate_pid() {
  local pid="$1"
  if [[ -z "${pid:-}" || "$pid" == "$$" ]]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true

  local attempt
  for attempt in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done

  kill -KILL "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
}

cleanup_stale_mcp_servers() {
  if [[ "$KEEP_STALE_MCP" == "1" ]]; then
    return 0
  fi

  local raw_pids
  raw_pids="$(find_mcp_server_pids_for_output "$OUTPUT" | sed '/^[[:space:]]*$/d')"
  if [[ -z "${raw_pids:-}" ]]; then
    return 0
  fi

  local pids
  pids=("${(@f)raw_pids}")
  if [[ ${#pids[@]} -eq 0 ]]; then
    return 0
  fi

  echo "Stopping stale Wails v3 MCP server processes for $OUTPUT: ${pids[*]}" >&2
  local pid
  for pid in "${pids[@]}"; do
    terminate_pid "$pid"
  done
}

cleanup() {
  local exit_code="${1:-$?}"
  trap - EXIT INT TERM

  if [[ -n "${app_pid:-}" ]]; then
    terminate_pid "$app_pid"
    app_pid=""
  fi

  if [[ -n "${frontend_pid:-}" ]]; then
    terminate_pid "$frontend_pid"
    frontend_pid=""
  fi

  cleanup_stale_mcp_servers
  exit "$exit_code"
}

frontend_dev_url() {
  printf "http://%s:%s\n" "$FRONTEND_DEV_HOST" "$FRONTEND_DEV_PORT"
}

start_frontend_dev_server() {
  local use_runtime_stub="$1"
  local url
  url="$(frontend_dev_url)"

  echo "Starting frontend dev server: $url" >&2
  (
    cd "$ROOT_DIR/frontend"
    if [[ "$use_runtime_stub" == "1" ]]; then
      ARLECCHINO_TEST_WAILS_RUNTIME=1 npm run dev -- --host "$FRONTEND_DEV_HOST" --port "$FRONTEND_DEV_PORT" --strictPort
    else
      npm run dev -- --host "$FRONTEND_DEV_HOST" --port "$FRONTEND_DEV_PORT" --strictPort
    fi
  ) &
  frontend_pid="$!"
}

wait_for_frontend_dev_server() {
  local url
  url="$(frontend_dev_url)"

  local attempt=1
  while [[ "$attempt" -le 80 ]]; do
    if ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
      echo "ERROR: frontend dev server exited before becoming ready." >&2
      return 1
    fi

    if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then
      return 0
    fi

    sleep 0.25
    attempt=$((attempt + 1))
  done

  echo "ERROR: frontend dev server did not become ready: $url" >&2
  return 1
}

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
    --frontend-dev-server)
      FRONTEND_DEV_SERVER="1"
      shift
      ;;
    --frontend-dev-host)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --frontend-dev-host requires a host." >&2
        exit 1
      fi
      FRONTEND_DEV_HOST="$1"
      shift
      ;;
    --frontend-dev-port)
      shift
      if [[ $# -eq 0 ]]; then
        echo "ERROR: --frontend-dev-port requires a port." >&2
        exit 1
      fi
      FRONTEND_DEV_PORT="$1"
      shift
      ;;
    --web-only)
      WEB_ONLY="1"
      FRONTEND_DEV_SERVER="1"
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
      APP_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "$BUILD_ONLY" == "1" && "$FRONTEND_DEV_SERVER" == "1" ]]; then
  echo "ERROR: --build-only cannot be combined with --frontend-dev-server or --web-only." >&2
  exit 1
fi

trap 'cleanup 130' INT
trap 'cleanup 143' TERM
trap 'cleanup $?' EXIT

cleanup_stale_mcp_servers

if [[ "$FRONTEND_DEV_SERVER" == "1" ]]; then
  export WAILS_VITE_PORT="$FRONTEND_DEV_PORT"
  export FRONTEND_DEVSERVER_URL
  FRONTEND_DEVSERVER_URL="$(frontend_dev_url)"
  start_frontend_dev_server "$WEB_ONLY"
  wait_for_frontend_dev_server
fi

if [[ "$WEB_ONLY" == "1" ]]; then
  echo "Browser preview ready: $(frontend_dev_url)"
  wait "$frontend_pid"
  exit "$?"
fi

if [[ "$SKIP_FRONTEND" != "1" && "$FRONTEND_DEV_SERVER" != "1" ]]; then
  cd "$ROOT_DIR/frontend"
  npm run build
fi

mkdir -p "$(dirname "$OUTPUT")" "$GOCACHE"
cd "$ROOT_DIR"
GO_BUILD_ARGS=(-o "$OUTPUT")
if [[ -n "${ARLE_WAILS3_LDFLAGS:-}" ]]; then
  GO_BUILD_ARGS+=(-ldflags "$ARLE_WAILS3_LDFLAGS")
fi
go build "${GO_BUILD_ARGS[@]}" .

echo "Built Wails v3 spike binary: $OUTPUT"

if [[ "$BUILD_ONLY" = "1" ]]; then
  exit 0
fi

"$OUTPUT" "${APP_ARGS[@]}" &
app_pid="$!"
set +e
wait "$app_pid"
exit_code="$?"
set -e
app_pid=""
exit "$exit_code"
