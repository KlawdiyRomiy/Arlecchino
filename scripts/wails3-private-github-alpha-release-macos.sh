#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-private-github-alpha-release-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

OWNER="${ARLE_WAILS3_GITHUB_RELEASE_OWNER:-KlawdiyRomiy}"
REPO="${ARLE_WAILS3_GITHUB_RELEASE_REPO:-Arlecchino}"
VERSION="${ARLE_WAILS3_APP_VERSION:-0.0.0-alpha}"
BUILD_NUMBER="${ARLE_WAILS3_APP_BUILD:-1}"
TAG="${ARLE_WAILS3_GITHUB_RELEASE_TAG:-}"
TITLE="${ARLE_WAILS3_GITHUB_RELEASE_TITLE:-}"
CHANNEL="${ARLE_WAILS3_UPDATE_CHANNEL:-${ARLECCHINO_AUTO_UPDATE_CHANNEL:-alpha}}"
UPDATE_PRIVATE_KEY="${ARLE_WAILS3_UPDATE_SIGNING_KEY:-}"
OUTPUT_DIR="${ARLE_WAILS3_RELEASE_OUTPUT:-}"
CREATE_DMG="${ARLE_WAILS3_RELEASE_CREATE_DMG:-1}"
PUBLISH="0"
DRAFT="0"
PRERELEASE="1"
NOTES_FILE="${ARLE_WAILS3_GITHUB_RELEASE_NOTES:-}"
RELEASE_DIR=""
RELEASE_REPORT=""
DRY_RUN_REPORT=""

derive_git_release_tag() {
  local exact_tag latest_tag
  exact_tag="$(git -C "$ROOT_DIR" tag --points-at HEAD --list 'v*-alpha.*' --sort=-creatordate | head -1)"
  if [[ -n "$exact_tag" ]]; then
    echo "$exact_tag"
    return 0
  fi

  latest_tag="$(git -C "$ROOT_DIR" describe --tags --match 'v*-alpha.*' --abbrev=0 2>/dev/null || true)"
  if [[ -n "$latest_tag" ]]; then
    echo "$latest_tag"
  fi
}

apply_git_release_tag_defaults() {
  local release_tag="$1"
  local tag_body="${release_tag#v}"

  if [[ ! "$tag_body" =~ '^(.+-alpha)\.([0-9]+)$' ]]; then
    return 0
  fi

  if [[ "$VERSION" == "0.0.0-alpha" ]]; then
    VERSION="${match[1]}"
  fi
  if [[ "$BUILD_NUMBER" == "1" ]]; then
    BUILD_NUMBER="${match[2]}"
  fi
  if [[ -z "$TAG" ]]; then
    TAG="$release_tag"
  fi
}

usage() {
  cat <<'EOF'
Usage: scripts/wails3-private-github-alpha-release-macos.sh [options]

By default this script is a dry-run and prints the private GitHub release plan.
Use --publish to build artifacts and upload them through gh CLI.

Options:
  --publish                 Build and upload release assets. Default: dry-run.
  --owner <owner>           GitHub owner. Default: KlawdiyRomiy.
  --repo <repo>             GitHub repo. Default: Arlecchino.
  --tag <tag>               Release tag. Default: current git tag or v<version>-alpha.<build>.
  --title <title>           Release title. Default: Arlecchino <tag>.
  --version <version>       App version. Default: current git tag version or 0.0.0-alpha.
  --build <number>          App build number. Default: current git tag build or 1.
  --channel <channel>       Update channel. Default: alpha.
  --update-private-key <p>  External Ed25519 PEM private key.
  --output-dir <path>       Release output root.
  --create-dmg              Create and upload DMG. Default.
  --skip-dmg                Upload ZIP/update assets only.
  --draft                   Create release as draft.
  --final                   Mark release as non-prerelease.
  --notes-file <path>       Release notes file for GitHub release and manifest.
  --dry-run-report <path>   Optional JSON plan output for dry-run.

The app updater stores GitHub access in macOS Keychain at runtime. This script
uses gh CLI only for developer-side private release publishing.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)
      PUBLISH="1"
      shift
      ;;
    --owner)
      shift
      OWNER="${1:-}"
      shift
      ;;
    --repo)
      shift
      REPO="${1:-}"
      shift
      ;;
    --tag)
      shift
      TAG="${1:-}"
      shift
      ;;
    --title)
      shift
      TITLE="${1:-}"
      shift
      ;;
    --version)
      shift
      VERSION="${1:-}"
      shift
      ;;
    --build)
      shift
      BUILD_NUMBER="${1:-}"
      shift
      ;;
    --channel)
      shift
      CHANNEL="${1:-}"
      shift
      ;;
    --update-private-key)
      shift
      UPDATE_PRIVATE_KEY="${1:-}"
      shift
      ;;
    --output-dir)
      shift
      OUTPUT_DIR="${1:-}"
      shift
      ;;
    --create-dmg)
      CREATE_DMG="1"
      shift
      ;;
    --skip-dmg)
      CREATE_DMG="0"
      shift
      ;;
    --draft)
      DRAFT="1"
      shift
      ;;
    --final)
      PRERELEASE="0"
      shift
      ;;
    --notes-file)
      shift
      NOTES_FILE="${1:-}"
      shift
      ;;
    --dry-run-report)
      shift
      DRY_RUN_REPORT="${1:-}"
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

GIT_RELEASE_TAG="$(derive_git_release_tag)"
RELEASE_TAG_FOR_DEFAULTS="${TAG:-$GIT_RELEASE_TAG}"
if [[ -n "$RELEASE_TAG_FOR_DEFAULTS" ]]; then
  apply_git_release_tag_defaults "$RELEASE_TAG_FOR_DEFAULTS"
fi

if [[ -z "$TAG" ]]; then
  if [[ "$VERSION" == *alpha* ]]; then
    TAG="v$VERSION.$BUILD_NUMBER"
  else
    TAG="v$VERSION-alpha.$BUILD_NUMBER"
  fi
fi
if [[ -z "$TITLE" ]]; then
  TITLE="Arlecchino $TAG"
fi
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
MANIFEST_SOURCE="github-release://$OWNER/$REPO/latest/arlecchino-update-manifest.json"
if [[ "$OWNER" != "KlawdiyRomiy" || "$REPO" != "Arlecchino" ]]; then
  echo "ERROR: updater private provider currently allows only KlawdiyRomiy/Arlecchino." >&2
  exit 1
fi
if [[ -n "$NOTES_FILE" ]]; then
  node "$ROOT_DIR/scripts/wails3-release-notes-policy.mjs" --validate "$NOTES_FILE"
fi

write_dry_run_report() {
  local out="$1"
  node - "$out" "$OWNER" "$REPO" "$TAG" "$TITLE" "$VERSION" "$BUILD_NUMBER" "$CHANNEL" "$MANIFEST_SOURCE" "$CREATE_DMG" "$PUBLISH" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  out,
  owner,
  repo,
  tag,
  title,
  version,
  build,
  channel,
  manifestSource,
  createDmg,
  publish,
] = process.argv.slice(2);
const report = {
  generatedAt: new Date().toISOString(),
  mode: publish === "1" ? "publish" : "dry-run",
  repository: `${owner}/${repo}`,
  tag,
  title,
  version,
  build,
  channel,
  manifestSource,
  assets: [
    "arlecchino-macos-universal.zip",
    ...(createDmg === "1" ? ["arlecchino-macos-universal.dmg"] : []),
    "arlecchino-update-manifest.json",
    "arlecchino-update-public-key.txt",
    "checksums.sha256",
    "release-evidence.json",
  ],
  tokenPolicy: "runtime token is stored in macOS Keychain; publishing uses gh CLI only",
};
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
NODE
}

if [[ "$PUBLISH" != "1" ]]; then
  write_dry_run_report "$DRY_RUN_REPORT"
  exit 0
fi

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=no)" ]]; then
  echo "ERROR: tracked worktree must be clean before private release publish." >&2
  git -C "$ROOT_DIR" status --short --untracked-files=no >&2
  exit 1
fi
if [[ -z "$UPDATE_PRIVATE_KEY" ]]; then
  echo "ERROR: --update-private-key is required for private updater release publish." >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required for private GitHub release publish." >&2
  exit 1
fi
gh auth status >/dev/null

LOCAL_ARGS=(
  --version "$VERSION"
  --build "$BUILD_NUMBER"
  --update-channel "$CHANNEL"
  --update-private-key "$UPDATE_PRIVATE_KEY"
)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="${TMPDIR:-/tmp}/arlecchino-private-github-alpha"
fi
RELEASE_DIR="$OUTPUT_DIR/$VERSION-$BUILD_NUMBER-$TAG-$RUN_ID"
LOCAL_ARGS+=(--output-dir "$RELEASE_DIR")
if [[ "$CREATE_DMG" == "1" ]]; then
  LOCAL_ARGS+=(--create-dmg)
else
  LOCAL_ARGS+=(--skip-dmg)
fi

ARLE_WAILS3_UPDATE_MANIFEST_URL="$MANIFEST_SOURCE" "$ROOT_DIR/scripts/wails3-local-alpha-release-macos.sh" "${LOCAL_ARGS[@]}"
RELEASE_REPORT="$RELEASE_DIR/release-evidence.json"
if [[ -z "$RELEASE_REPORT" || ! -f "$RELEASE_REPORT" ]]; then
  echo "ERROR: release evidence report was not found." >&2
  exit 1
fi
ARTIFACT_DIR="$RELEASE_DIR/artifacts"
ZIP_PATH="$ARTIFACT_DIR/arlecchino-macos-universal.zip"
DMG_PATH="$ARTIFACT_DIR/arlecchino-macos-universal.dmg"
MANIFEST_PATH="$ARTIFACT_DIR/arlecchino-update-manifest.json"
PUBLIC_KEY_PATH="$ARTIFACT_DIR/arlecchino-update-public-key.txt"
CHECKSUMS_PATH="$ARTIFACT_DIR/checksums.sha256"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "ERROR: updater ZIP not found: $ZIP_PATH" >&2
  exit 1
fi

RELEASE_ARGS=(--repo "$OWNER/$REPO" --title "$TITLE")
if [[ "$PRERELEASE" == "1" ]]; then
  RELEASE_ARGS+=(--prerelease)
fi
if [[ "$DRAFT" == "1" ]]; then
  RELEASE_ARGS+=(--draft)
fi
if [[ -n "$NOTES_FILE" ]]; then
  RELEASE_ARGS+=(--notes-file "$NOTES_FILE")
else
  RELEASE_ARGS+=(--notes "Private local-alpha release for Arlecchino.")
fi

if ! gh release view "$TAG" --repo "$OWNER/$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" "${RELEASE_ARGS[@]}"
fi

UPLOADS=("$ZIP_PATH")
if [[ "$CREATE_DMG" == "1" && -f "$DMG_PATH" ]]; then
  UPLOADS+=("$DMG_PATH")
fi
gh release upload "$TAG" "${UPLOADS[@]}" --repo "$OWNER/$REPO" --clobber

ZIP_ASSET_API_URL="$(gh api "repos/$OWNER/$REPO/releases/tags/$TAG" --jq '.assets[] | select(.name == "arlecchino-macos-universal.zip") | .url')"
if [[ -z "$ZIP_ASSET_API_URL" ]]; then
  echo "ERROR: uploaded ZIP asset API URL was not found." >&2
  exit 1
fi

MANIFEST_ARGS=(
  --artifact "$ZIP_PATH"
  --private-key "$UPDATE_PRIVATE_KEY"
  --out "$MANIFEST_PATH"
  --version "$VERSION"
  --build "$BUILD_NUMBER"
  --channel "$CHANNEL"
  --platform darwin
  --arch universal
  --kind zip
  --public-key-out "$PUBLIC_KEY_PATH"
  --url "$ZIP_ASSET_API_URL"
)
if [[ -n "$NOTES_FILE" ]]; then
  MANIFEST_ARGS+=(--release-notes-file "$NOTES_FILE")
fi
node "$ROOT_DIR/scripts/wails3-update-manifest.mjs" "${MANIFEST_ARGS[@]}" > "$RELEASE_DIR/logs/private-update-manifest.json"

(
  cd "$ARTIFACT_DIR"
  checksum_inputs=(arlecchino-macos-universal.zip arlecchino-update-manifest.json arlecchino-update-public-key.txt)
  if [[ -f arlecchino-macos-universal.dmg ]]; then
    checksum_inputs+=(arlecchino-macos-universal.dmg)
  fi
  shasum -a 256 "${checksum_inputs[@]}" > "$CHECKSUMS_PATH"
)

gh release upload "$TAG" "$MANIFEST_PATH" "$PUBLIC_KEY_PATH" "$CHECKSUMS_PATH" "$RELEASE_REPORT" --repo "$OWNER/$REPO" --clobber
MANIFEST_ASSET_API_URL="$(gh api "repos/$OWNER/$REPO/releases/tags/$TAG" --jq '.assets[] | select(.name == "arlecchino-update-manifest.json") | .url')"
PRIVATE_REPORT="$RELEASE_DIR/private-github-release-report.json"
node - "$PRIVATE_REPORT" "$OWNER" "$REPO" "$TAG" "$TITLE" "$VERSION" "$BUILD_NUMBER" "$CHANNEL" "$MANIFEST_SOURCE" "$ZIP_ASSET_API_URL" "$MANIFEST_ASSET_API_URL" "$RELEASE_REPORT" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  out,
  owner,
  repo,
  tag,
  title,
  version,
  build,
  channel,
  manifestSource,
  zipAssetApiUrl,
  manifestAssetApiUrl,
  releaseEvidence,
] = process.argv.slice(2);
const report = {
  generatedAt: new Date().toISOString(),
  mode: "publish",
  repository: `${owner}/${repo}`,
  tag,
  title,
  version,
  build,
  channel,
  manifestSource,
  privateProvider: {
    kind: "github-release",
    zipAssetApiUrl,
    manifestAssetApiUrl,
    auth: "runtime Keychain token, never embedded in artifact",
  },
  artifacts: {
    zip: "arlecchino-macos-universal.zip",
    dmg: "arlecchino-macos-universal.dmg",
    manifest: "arlecchino-update-manifest.json",
    publicKey: "arlecchino-update-public-key.txt",
    checksums: "checksums.sha256",
    releaseEvidence,
  },
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
NODE
gh release upload "$TAG" "$PRIVATE_REPORT" --repo "$OWNER/$REPO" --clobber
