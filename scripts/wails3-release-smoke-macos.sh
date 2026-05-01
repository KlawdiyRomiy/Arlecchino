#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="feature/wails3-shell-spike"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-release-smoke-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

"$ROOT_DIR/scripts/wails3-packaged-app-smoke-macos.sh" --sign "${ARLE_WAILS3_RELEASE_SMOKE_SIGN_MODE:-adhoc}" -- Arlecchino-v3 >/dev/null
"$ROOT_DIR/scripts/wails3-real-os-smoke-macos.sh" >/dev/null
"$ROOT_DIR/scripts/wails3-native-delivery-live-smoke-macos.sh" --sign "${ARLE_WAILS3_RELEASE_SMOKE_SIGN_MODE:-adhoc}" >/dev/null

echo "Wails v3 release smoke passed."
