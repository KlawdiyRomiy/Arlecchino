#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-github-release-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

OWNER="${ARLE_WAILS3_GITHUB_RELEASE_OWNER:-KlawdiyRomiy}"
REPO="${ARLE_WAILS3_GITHUB_RELEASE_REPO:-Arlecchino}"
VERSION="${ARLE_WAILS3_APP_VERSION:-}"
BUILD_NUMBER="${ARLE_WAILS3_APP_BUILD:-}"
TAG="${ARLE_WAILS3_GITHUB_RELEASE_TAG:-}"
TITLE="${ARLE_WAILS3_GITHUB_RELEASE_TITLE:-}"
CHANNEL="${ARLE_WAILS3_UPDATE_CHANNEL:-${ARLECCHINO_AUTO_UPDATE_CHANNEL:-}}"
PRIMARY_MANIFEST_ASSET="${ARLE_WAILS3_UPDATE_MANIFEST_ASSET:-arlecchino-beta-update-manifest.json}"
LEGACY_MANIFEST_ASSET="${ARLE_WAILS3_LEGACY_UPDATE_MANIFEST_ASSET:-arlecchino-update-manifest.json}"
LEGACY_MANIFEST_CHANNEL="${ARLE_WAILS3_LEGACY_UPDATE_CHANNEL:-alpha}"
LEGACY_MANIFEST_ENABLED="${ARLE_WAILS3_LEGACY_UPDATE_MANIFEST:-1}"
UPDATE_PRIVATE_KEY="${ARLE_WAILS3_UPDATE_SIGNING_KEY:-}"
OUTPUT_DIR="${ARLE_WAILS3_RELEASE_OUTPUT:-}"
CREATE_DMG="${ARLE_WAILS3_RELEASE_CREATE_DMG:-1}"
PUBLISH="0"
DRAFT="0"
PRERELEASE="0"
NOTES_FILE="${ARLE_WAILS3_GITHUB_RELEASE_NOTES:-}"
RELEASE_DIR=""
RELEASE_REPORT=""
DRY_RUN_REPORT=""

usage() {
  cat <<'EOF'
Usage: scripts/wails3-github-release-macos.sh [options]

By default this script is a dry-run and prints the GitHub release plan.
Use --publish to build artifacts and upload them through gh CLI.

Options:
  --publish                 Build and upload release assets. Default: dry-run.
  --owner <owner>           GitHub owner. Default: KlawdiyRomiy.
  --repo <repo>             GitHub repo. Default: Arlecchino.
  --tag <tag>               Required release tag, e.g. v0.2.0-beta.112.
  --title <title>           Release title. Default: Arlecchino <tag>.
  --version <version>       Required app version, e.g. 0.2.0-beta.
  --build <number>          Required app build number, e.g. 112.
  --channel <channel>       Required primary update channel, e.g. beta.
  --manifest-asset <name>   Primary manifest asset. Default: arlecchino-beta-update-manifest.json.
  --legacy-manifest-asset <name>
                             Legacy manifest asset. Default: arlecchino-update-manifest.json.
  --legacy-channel <ch>     Legacy manifest channel. Default: alpha.
  --skip-legacy-manifest    Do not generate/upload the legacy manifest.
  --update-private-key <p>  External Ed25519 PEM private key.
  --output-dir <path>       Release output root.
  --create-dmg              Create and upload DMG. Default.
  --skip-dmg                Upload ZIP/update assets only.
  --draft                   Create release as draft.
  --prerelease              Mark GitHub release as prerelease.
  --final                   Mark release as non-prerelease. Default.
  --notes-file <path>       Required release notes file for GitHub release and manifest.
  --dry-run-report <path>   Optional JSON plan output for dry-run.

The app updater stores GitHub access in macOS Keychain at runtime. This script
uses gh CLI only for developer-side release publishing.
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
    --manifest-asset)
      shift
      PRIMARY_MANIFEST_ASSET="${1:-}"
      shift
      ;;
    --legacy-manifest-asset)
      shift
      LEGACY_MANIFEST_ASSET="${1:-}"
      shift
      ;;
    --legacy-channel)
      shift
      LEGACY_MANIFEST_CHANNEL="${1:-}"
      shift
      ;;
    --skip-legacy-manifest)
      LEGACY_MANIFEST_ENABLED="0"
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
    --prerelease)
      PRERELEASE="1"
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

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "ERROR: $name is required." >&2
    usage >&2
    exit 1
  fi
}

require_value "--tag" "$TAG"
require_value "--version" "$VERSION"
require_value "--build" "$BUILD_NUMBER"
require_value "--channel" "$CHANNEL"
require_value "--notes-file" "$NOTES_FILE"
require_value "--manifest-asset" "$PRIMARY_MANIFEST_ASSET"
if [[ "$LEGACY_MANIFEST_ENABLED" != "0" && "$LEGACY_MANIFEST_ENABLED" != "1" ]]; then
  echo "ERROR: ARLE_WAILS3_LEGACY_UPDATE_MANIFEST must be 0 or 1." >&2
  exit 1
fi
if [[ "$LEGACY_MANIFEST_ENABLED" == "1" ]]; then
  require_value "--legacy-manifest-asset" "$LEGACY_MANIFEST_ASSET"
  require_value "--legacy-channel" "$LEGACY_MANIFEST_CHANNEL"
fi
if [[ ! "$BUILD_NUMBER" =~ '^[0-9]+$' ]]; then
  echo "ERROR: --build must be numeric." >&2
  exit 1
fi
if [[ "$TAG" != "v$VERSION.$BUILD_NUMBER" ]]; then
  echo "ERROR: --tag must exactly match v<version>.<build>; expected v$VERSION.$BUILD_NUMBER." >&2
  exit 1
fi
if [[ "$PRIMARY_MANIFEST_ASSET" == "$LEGACY_MANIFEST_ASSET" && "$LEGACY_MANIFEST_ENABLED" == "1" ]]; then
  echo "ERROR: primary and legacy manifest assets must be distinct." >&2
  exit 1
fi
format_release_title() {
  local version="$1"
  if [[ "$version" == *-beta ]]; then
    echo "Arlecchino ${version%-beta} Beta"
    return 0
  fi
  if [[ "$version" == *-alpha ]]; then
    echo "Arlecchino ${version%-alpha} Alpha"
    return 0
  fi
  echo "Arlecchino $version"
}
if [[ -z "$TITLE" ]]; then
  TITLE="$(format_release_title "$VERSION")"
fi
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
MANIFEST_SOURCE="github-release://$OWNER/$REPO/latest/$PRIMARY_MANIFEST_ASSET"
if [[ "$OWNER" != "KlawdiyRomiy" || "$REPO" != "Arlecchino" ]]; then
  echo "ERROR: updater GitHub release provider currently allows only KlawdiyRomiy/Arlecchino." >&2
  exit 1
fi
node "$ROOT_DIR/scripts/wails3-release-notes-policy.mjs" --validate "$NOTES_FILE"

write_dry_run_report() {
  local out="$1"
  node - "$out" "$OWNER" "$REPO" "$TAG" "$TITLE" "$VERSION" "$BUILD_NUMBER" "$CHANNEL" "$MANIFEST_SOURCE" "$CREATE_DMG" "$PUBLISH" "$DRAFT" "$PRERELEASE" "$PRIMARY_MANIFEST_ASSET" "$LEGACY_MANIFEST_ENABLED" "$LEGACY_MANIFEST_ASSET" "$LEGACY_MANIFEST_CHANNEL" <<'NODE'
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
  draft,
  prerelease,
  primaryManifestAsset,
  legacyManifestEnabled,
  legacyManifestAsset,
  legacyManifestChannel,
] = process.argv.slice(2);
const manifestAssets = [
  primaryManifestAsset,
  ...(legacyManifestEnabled === "1" ? [legacyManifestAsset] : []),
];
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
  githubRelease: {
    draft: draft === "1",
    prerelease: prerelease === "1",
  },
  primaryManifest: {
    asset: primaryManifestAsset,
    channel,
  },
  legacyManifest: legacyManifestEnabled === "1" ? {
    asset: legacyManifestAsset,
    channel: legacyManifestChannel,
    purpose: "compatibility for already-published alpha updater clients",
  } : null,
  assets: [
    "arlecchino-macos-universal.zip",
    ...(createDmg === "1" ? ["arlecchino-macos-universal.dmg"] : []),
    ...manifestAssets,
    "arlecchino-update-public-key.txt",
    "checksums.sha256",
    "release-evidence.json",
    "github-release-evidence.json",
  ],
  publishGuards: [
    "tracked tree is clean",
    "HEAD equals origin/main",
    "remote tag exists",
    "remote tag points at HEAD",
    "macOS updater ZIP must have permission-stable code identity before manifest upload",
    "gh release create uses --verify-tag",
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
  echo "ERROR: tracked worktree must be clean before GitHub release publish." >&2
  git -C "$ROOT_DIR" status --short --untracked-files=no >&2
  exit 1
fi
if [[ -z "$UPDATE_PRIVATE_KEY" ]]; then
  echo "ERROR: --update-private-key is required for updater release publish." >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required for GitHub release publish." >&2
  exit 1
fi
gh auth status >/dev/null
LOCAL_HEAD="$(git -C "$ROOT_DIR" rev-parse HEAD)"
REMOTE_MAIN_HEAD="$(git -C "$ROOT_DIR" ls-remote origin "refs/heads/$EXPECTED_BRANCH" | awk '{print $1}')"
if [[ -z "$REMOTE_MAIN_HEAD" ]]; then
  echo "ERROR: could not resolve origin/$EXPECTED_BRANCH." >&2
  exit 1
fi
if [[ "$LOCAL_HEAD" != "$REMOTE_MAIN_HEAD" ]]; then
  echo "ERROR: HEAD must equal origin/$EXPECTED_BRANCH before release publish." >&2
  echo "HEAD: $LOCAL_HEAD" >&2
  echo "origin/$EXPECTED_BRANCH: $REMOTE_MAIN_HEAD" >&2
  exit 1
fi
REMOTE_TAG_HEAD="$(git -C "$ROOT_DIR" ls-remote origin "refs/tags/$TAG^{}" | awk '{print $1}' | head -1)"
if [[ -z "$REMOTE_TAG_HEAD" ]]; then
  REMOTE_TAG_HEAD="$(git -C "$ROOT_DIR" ls-remote origin "refs/tags/$TAG" | awk '{print $1}' | head -1)"
fi
if [[ -z "$REMOTE_TAG_HEAD" ]]; then
  echo "ERROR: remote tag $TAG must already exist before release publish." >&2
  exit 1
fi
if [[ "$LOCAL_HEAD" != "$REMOTE_TAG_HEAD" ]]; then
  echo "ERROR: remote tag $TAG must point at HEAD." >&2
  echo "HEAD: $LOCAL_HEAD" >&2
  echo "$TAG: $REMOTE_TAG_HEAD" >&2
  exit 1
fi

LOCAL_ARGS=(
  --version "$VERSION"
  --build "$BUILD_NUMBER"
  --update-channel "$CHANNEL"
)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="${TMPDIR:-/tmp}/arlecchino-github-release"
fi
RELEASE_DIR="$OUTPUT_DIR/$VERSION-$BUILD_NUMBER-$TAG-$RUN_ID"
LOCAL_ARGS+=(--output-dir "$RELEASE_DIR")
LOCAL_ARGS+=(--update-manifest "$RELEASE_DIR/artifacts/$PRIMARY_MANIFEST_ASSET")
if [[ "$CREATE_DMG" == "1" ]]; then
  LOCAL_ARGS+=(--create-dmg)
else
  LOCAL_ARGS+=(--skip-dmg)
fi

ARLE_WAILS3_UPDATE_MANIFEST_URL="$MANIFEST_SOURCE" ARLE_WAILS3_UPDATE_SIGNING_KEY="$UPDATE_PRIVATE_KEY" "$ROOT_DIR/scripts/wails3-local-release-macos.sh" "${LOCAL_ARGS[@]}"
RELEASE_REPORT="$RELEASE_DIR/release-evidence.json"
if [[ -z "$RELEASE_REPORT" || ! -f "$RELEASE_REPORT" ]]; then
  echo "ERROR: release evidence report was not found." >&2
  exit 1
fi
ARTIFACT_DIR="$RELEASE_DIR/artifacts"
ZIP_PATH="$ARTIFACT_DIR/arlecchino-macos-universal.zip"
DMG_PATH="$ARTIFACT_DIR/arlecchino-macos-universal.dmg"
PRIMARY_MANIFEST_PATH="$ARTIFACT_DIR/$PRIMARY_MANIFEST_ASSET"
LEGACY_MANIFEST_PATH="$ARTIFACT_DIR/$LEGACY_MANIFEST_ASSET"
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
RELEASE_ARGS+=(--notes-file "$NOTES_FILE")

if ! gh release view "$TAG" --repo "$OWNER/$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" "${RELEASE_ARGS[@]}" --verify-tag
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

generate_update_manifest() {
  local manifest_path="$1"
  local manifest_channel="$2"
  local log_path="$3"
  ARLE_WAILS3_UPDATE_SIGNING_KEY="$UPDATE_PRIVATE_KEY" node "$ROOT_DIR/scripts/wails3-update-manifest.mjs" \
    --artifact "$ZIP_PATH" \
    --out "$manifest_path" \
    --version "$VERSION" \
    --build "$BUILD_NUMBER" \
    --channel "$manifest_channel" \
    --platform darwin \
    --arch universal \
    --kind zip \
    --public-key-out "$PUBLIC_KEY_PATH" \
    --url "$ZIP_ASSET_API_URL" \
    --release-notes-file "$NOTES_FILE" > "$log_path"
}

generate_update_manifest "$PRIMARY_MANIFEST_PATH" "$CHANNEL" "$RELEASE_DIR/logs/primary-update-manifest.json"
if [[ "$LEGACY_MANIFEST_ENABLED" == "1" ]]; then
  generate_update_manifest "$LEGACY_MANIFEST_PATH" "$LEGACY_MANIFEST_CHANNEL" "$RELEASE_DIR/logs/legacy-update-manifest.json"
fi

(
  cd "$ARTIFACT_DIR"
  checksum_inputs=(arlecchino-macos-universal.zip "$PRIMARY_MANIFEST_ASSET" arlecchino-update-public-key.txt)
  if [[ "$LEGACY_MANIFEST_ENABLED" == "1" ]]; then
    checksum_inputs+=("$LEGACY_MANIFEST_ASSET")
  fi
  if [[ -f arlecchino-macos-universal.dmg ]]; then
    checksum_inputs+=(arlecchino-macos-universal.dmg)
  fi
  shasum -a 256 "${checksum_inputs[@]}" > "$CHECKSUMS_PATH"
)

MANIFEST_UPLOADS=("$PRIMARY_MANIFEST_PATH")
if [[ "$LEGACY_MANIFEST_ENABLED" == "1" ]]; then
  MANIFEST_UPLOADS+=("$LEGACY_MANIFEST_PATH")
fi
gh release upload "$TAG" "${MANIFEST_UPLOADS[@]}" "$PUBLIC_KEY_PATH" "$CHECKSUMS_PATH" "$RELEASE_REPORT" --repo "$OWNER/$REPO" --clobber
PRIMARY_MANIFEST_ASSET_API_URL="$(gh api "repos/$OWNER/$REPO/releases/tags/$TAG" --jq ".assets[] | select(.name == \"$PRIMARY_MANIFEST_ASSET\") | .url")"
if [[ -z "$PRIMARY_MANIFEST_ASSET_API_URL" ]]; then
  echo "ERROR: uploaded primary manifest asset API URL was not found." >&2
  exit 1
fi
LEGACY_MANIFEST_ASSET_API_URL=""
if [[ "$LEGACY_MANIFEST_ENABLED" == "1" ]]; then
  LEGACY_MANIFEST_ASSET_API_URL="$(gh api "repos/$OWNER/$REPO/releases/tags/$TAG" --jq ".assets[] | select(.name == \"$LEGACY_MANIFEST_ASSET\") | .url")"
  if [[ -z "$LEGACY_MANIFEST_ASSET_API_URL" ]]; then
    echo "ERROR: uploaded legacy manifest asset API URL was not found." >&2
    exit 1
  fi
fi
PRIVATE_REPORT="$RELEASE_DIR/github-release-evidence.json"
node - "$PRIVATE_REPORT" "$OWNER" "$REPO" "$TAG" "$TITLE" "$VERSION" "$BUILD_NUMBER" "$CHANNEL" "$MANIFEST_SOURCE" "$ZIP_ASSET_API_URL" "$PRIMARY_MANIFEST_ASSET_API_URL" "$LEGACY_MANIFEST_ENABLED" "$LEGACY_MANIFEST_ASSET_API_URL" "$RELEASE_REPORT" "$PRIMARY_MANIFEST_ASSET" "$LEGACY_MANIFEST_ASSET" "$LEGACY_MANIFEST_CHANNEL" <<'NODE'
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
  primaryManifestAssetApiUrl,
  legacyManifestEnabled,
  legacyManifestAssetApiUrl,
  releaseEvidence,
  primaryManifestAsset,
  legacyManifestAsset,
  legacyManifestChannel,
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
    primaryManifestAssetApiUrl,
    legacyManifestAssetApiUrl: legacyManifestEnabled === "1" ? legacyManifestAssetApiUrl : "",
    auth: "runtime Keychain token, never embedded in artifact",
  },
  primaryManifest: {
    asset: primaryManifestAsset,
    channel,
  },
  legacyManifest: legacyManifestEnabled === "1" ? {
    asset: legacyManifestAsset,
    channel: legacyManifestChannel,
    purpose: "compatibility for already-published alpha updater clients",
    sameZipAssetApiUrl: zipAssetApiUrl,
  } : null,
  artifacts: {
    zip: "arlecchino-macos-universal.zip",
    dmg: "arlecchino-macos-universal.dmg",
    primaryManifest: primaryManifestAsset,
    legacyManifest: legacyManifestEnabled === "1" ? legacyManifestAsset : "",
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
