#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-window-lease-manual-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Window Lease manual smoke is macOS-only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to write the manual smoke report." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-wails3-window-lease-manual.XXXXXX")"
OUTPUT="$TMP_ROOT/bin/Arlecchino-v3"
APP_BUNDLE="$TMP_ROOT/Arlecchino-v3.app"
REPORT="$TMP_ROOT/window-lease-manual-report.json"
BUNDLE_ID="${ARLE_WAILS3_WINDOW_LEASE_MANUAL_BUNDLE_ID:-dev.arlecchino.v3windowleasemanual}"
SIGN_MODE="${ARLE_WAILS3_WINDOW_LEASE_MANUAL_SIGN_MODE:-adhoc}"
LAUNCH="0"

cleanup() {
  if [[ "${ARLE_WAILS3_KEEP_WINDOW_LEASE_MANUAL_REPORTS:-0}" == "1" ]]; then
    echo "Keeping Wails v3 Window Lease manual smoke files at $TMP_ROOT" >&2
    return 0
  fi
  if [[ "$LAUNCH" != "1" ]]; then
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Usage: scripts/wails3-window-lease-manual-smoke-macos.sh [options]

Options:
  --launch             Build and launch a gated packaged app for manual IDE smoke.
  --output <path>      Intermediate Wails v3 binary path.
  --app-bundle <path>  Temporary .app path.
  --report <path>      JSON manual report path.
  --bundle-id <id>     Temporary bundle id.
  --sign <mode>        none, adhoc, or developer-id.

Manual focus: Terminal detached PTY/focus/session continuity.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --launch)
      LAUNCH="1"
      shift
      ;;
    --output)
      shift
      OUTPUT="${1:-}"
      shift
      ;;
    --app-bundle)
      shift
      APP_BUNDLE="${1:-}"
      shift
      ;;
    --report)
      shift
      REPORT="${1:-}"
      shift
      ;;
    --bundle-id)
      shift
      BUNDLE_ID="${1:-}"
      shift
      ;;
    --sign)
      shift
      SIGN_MODE="${1:-}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

mkdir -p "$(dirname "$OUTPUT")" "$(dirname "$REPORT")"

if [[ "$LAUNCH" == "1" ]]; then
  "$ROOT_DIR/scripts/wails3-package-macos.sh" \
    --output "$OUTPUT" \
    --app-bundle "$APP_BUNDLE" \
    --bundle-id "$BUNDLE_ID" \
    --version "0.0.0-window-lease-manual" \
    --build "1" \
    --sign "$SIGN_MODE" >&2

  open -n \
    --env "ARLECCHINO_PACKAGED_BUILD=1" \
    --env "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1" \
    "$APP_BUNDLE"
fi

export ARLE_WINDOW_LEASE_MANUAL_REPORT="$REPORT"
export ARLE_WINDOW_LEASE_MANUAL_APP_BUNDLE="$APP_BUNDLE"
export ARLE_WINDOW_LEASE_MANUAL_BUNDLE_ID="$BUNDLE_ID"
export ARLE_WINDOW_LEASE_MANUAL_LAUNCHED="$LAUNCH"
node <<'NODE'
const fs = require("fs");
const path = require("path");

const report = {
  runtime: "wails-v3",
  platform: "darwin",
  generatedAt: new Date().toISOString(),
  manual: true,
  launched: process.env.ARLE_WINDOW_LEASE_MANUAL_LAUNCHED === "1",
  appBundle: process.env.ARLE_WINDOW_LEASE_MANUAL_APP_BUNDLE,
  bundleId: process.env.ARLE_WINDOW_LEASE_MANUAL_BUNDLE_ID,
  gate: {
    windowLeaseSpikeEnv: "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1",
    defaultOn: false,
  },
  checks: [
    {
      id: "terminal-detach-session-continuity",
      status: "manual-required",
      instruction: "Open Terminal panel, run a visible command, detach Terminal helper, verify output and PTY session remain intact.",
    },
    {
      id: "terminal-detached-focus",
      status: "manual-required",
      instruction: "Focus detached Terminal window, type into the active session, switch back to main window, then focus detached Terminal again.",
    },
    {
      id: "terminal-close-return",
      status: "manual-required",
      instruction: "Close detached Terminal window and verify the main shell receives focusSurface return without stale detached lease state.",
    },
    {
      id: "preview-git-problems-regression",
      status: "manual-required",
      instruction: "Spot-check Preview, Git and Problems detach/close/return still behave after Terminal helper smoke.",
    },
  ],
};
fs.mkdirSync(path.dirname(process.env.ARLE_WINDOW_LEASE_MANUAL_REPORT), { recursive: true });
fs.writeFileSync(process.env.ARLE_WINDOW_LEASE_MANUAL_REPORT, `${JSON.stringify(report, null, 2)}\n`);
NODE

cat "$REPORT"
echo "Window Lease manual smoke report: $REPORT" >&2
if [[ "$LAUNCH" == "1" ]]; then
  echo "Manual app left running for IDE smoke: $APP_BUNDLE" >&2
fi
