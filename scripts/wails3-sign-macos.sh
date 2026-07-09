#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-sign-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

APP_BUNDLE=""
MODE="${ARLE_WAILS3_SIGN_MODE:-adhoc}"
IDENTITY="${ARLE_WAILS3_DEVELOPER_ID_IDENTITY:-}"
LOCAL_IDENTITY="${ARLE_WAILS3_LOCAL_CODESIGN_IDENTITY:-Arlecchino Local Code Signing}"
NOTARIZE="${ARLE_WAILS3_NOTARIZE:-0}"
KEYCHAIN_PROFILE="${ARLE_WAILS3_NOTARY_KEYCHAIN_PROFILE:-}"
TEAM_ID="${ARLE_WAILS3_NOTARY_TEAM_ID:-}"

usage() {
  cat <<'EOF'
Usage: scripts/wails3-sign-macos.sh --app-bundle <path> [--mode adhoc|local-identity|developer-id] [--notarize]

Environment for developer-id mode:
  ARLE_WAILS3_DEVELOPER_ID_IDENTITY
  ARLE_WAILS3_NOTARY_KEYCHAIN_PROFILE
  ARLE_WAILS3_NOTARY_TEAM_ID

Environment for local-identity mode:
  ARLE_WAILS3_LOCAL_CODESIGN_IDENTITY

Default mode is ad-hoc signing for local beta smoke. local-identity uses an
explicit local code-signing certificate and never creates or trusts one for you.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-bundle)
      shift
      APP_BUNDLE="${1:-}"
      shift
      ;;
    --mode)
      shift
      MODE="${1:-}"
      shift
      ;;
    --notarize)
      NOTARIZE="1"
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

if [[ -z "$APP_BUNDLE" || ! -d "$APP_BUNDLE" ]]; then
  echo "ERROR: --app-bundle must point to an existing .app directory." >&2
  exit 1
fi

case "$MODE" in
  adhoc)
    SIGN_IDENTITY="-"
    ;;
  local-identity)
    if [[ -z "$LOCAL_IDENTITY" ]]; then
      echo "ERROR: local-identity mode requires ARLE_WAILS3_LOCAL_CODESIGN_IDENTITY." >&2
      exit 1
    fi
    if ! /usr/bin/security find-identity -p codesigning -v 2>/dev/null | grep -F -- "$LOCAL_IDENTITY" >/dev/null; then
      echo "ERROR: local-identity mode requires a valid local code-signing identity named or matching: $LOCAL_IDENTITY" >&2
      echo "Create and trust that identity explicitly in Keychain Access, then rerun this script." >&2
      exit 1
    fi
    SIGN_IDENTITY="$LOCAL_IDENTITY"
    ;;
  developer-id)
    if [[ -z "$IDENTITY" ]]; then
      echo "ERROR: developer-id mode requires ARLE_WAILS3_DEVELOPER_ID_IDENTITY." >&2
      exit 1
    fi
    SIGN_IDENTITY="$IDENTITY"
    ;;
  *)
    echo "ERROR: unsupported signing mode: $MODE" >&2
    exit 1
    ;;
esac

sign_nested_framework_dylibs() {
  local frameworks_dir="$APP_BUNDLE/Contents/Frameworks"
  if [[ ! -d "$frameworks_dir" ]]; then
    return 0
  fi

  local dylib
  while IFS= read -r -d '' dylib; do
    /usr/bin/codesign --force --options runtime --timestamp=none --sign "$SIGN_IDENTITY" "$dylib"
  done < <(/usr/bin/find "$frameworks_dir" -type f -name '*.dylib' -print0)
}

sign_nested_framework_dylibs
/usr/bin/codesign --force --options runtime --timestamp=none --sign "$SIGN_IDENTITY" "$APP_BUNDLE"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

if [[ "$MODE" == "developer-id" && "$NOTARIZE" == "1" ]]; then
  if [[ -z "$KEYCHAIN_PROFILE" ]]; then
    echo "ERROR: notarization requires ARLE_WAILS3_NOTARY_KEYCHAIN_PROFILE." >&2
    exit 1
  fi
  NOTARY_ARGS=(--keychain-profile "$KEYCHAIN_PROFILE" --wait)
  if [[ -n "$TEAM_ID" ]]; then
    NOTARY_ARGS+=(--team-id "$TEAM_ID")
  fi
  /usr/bin/xcrun notarytool submit "$APP_BUNDLE" "${NOTARY_ARGS[@]}"
  /usr/bin/xcrun stapler staple "$APP_BUNDLE"
fi

echo "Signed Wails v3 app bundle: $APP_BUNDLE ($MODE)"
