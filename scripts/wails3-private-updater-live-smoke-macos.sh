#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_BUNDLE="/Applications/Arlecchino.app"
OWNER="${ARLE_WAILS3_GITHUB_RELEASE_OWNER:-KlawdiyRomiy}"
REPO="${ARLE_WAILS3_GITHUB_RELEASE_REPO:-Arlecchino}"
TAG="${ARLE_WAILS3_GITHUB_RELEASE_TAG:-}"
REPORT_PATH=""
EXPECTED_VERSION=""
EXPECTED_BUILD=""
RUN_INSTALLED_SMOKE=1

usage() {
  cat <<'EOF'
Usage: scripts/wails3-private-updater-live-smoke-macos.sh [options]

Captures local-alpha updater evidence for an installed Arlecchino.app and a
private GitHub release. The script does not publish, mutate releases, or store
tokens. It uses gh CLI auth to download release assets into a temp directory.

Options:
  --app-bundle <path>       Installed app bundle. Default: /Applications/Arlecchino.app
  --owner <owner>           GitHub owner. Default: KlawdiyRomiy
  --repo <repo>             GitHub repo. Default: Arlecchino
  --tag <tag>               Release tag to inspect. Default: newest non-draft release.
  --expected-version <v>    Require installed app CFBundleShortVersionString.
  --expected-build <n>      Require installed app CFBundleVersion.
  --report <path>           JSON evidence path. Default: temp file.
  --skip-installed-smoke    Do not run wails3-installed-app-smoke-macos.sh.
  --help                    Show this help.

Typical old-to-new apply evidence:
  1. Run this before the UI update to record current app + release assets.
  2. In Arlecchino, Check for Updates -> Download update -> Install and relaunch.
  3. Run this again with --expected-version/--expected-build to prove relaunch.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-bundle)
      APP_BUNDLE="${2:-}"
      shift 2
      ;;
    --owner)
      OWNER="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --expected-version)
      EXPECTED_VERSION="${2:-}"
      shift 2
      ;;
    --expected-build)
      EXPECTED_BUILD="${2:-}"
      shift 2
      ;;
    --report)
      REPORT_PATH="${2:-}"
      shift 2
      ;;
    --skip-installed-smoke)
      RUN_INSTALLED_SMOKE=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "wails3-private-updater-live-smoke-macos.sh only supports macOS" >&2
  exit 1
fi

if [[ -z "$APP_BUNDLE" || ! -d "$APP_BUNDLE" ]]; then
  echo "app bundle not found: ${APP_BUNDLE:-<empty>}" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required for private GitHub release asset smoke" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required to write JSON evidence" >&2
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required to inspect the updater ZIP" >&2
  exit 1
fi

if [[ -z "$REPORT_PATH" ]]; then
  REPORT_PATH="$(mktemp -t arlecchino-private-updater-smoke.XXXXXX.json)"
fi

TMP_DIR="$(mktemp -d -t arlecchino-private-updater-smoke.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

RELEASE_JSON="$TMP_DIR/release.json"
INSTALLED_SMOKE_REPORT="$TMP_DIR/installed-app-smoke.json"
MANIFEST_PATH="$TMP_DIR/arlecchino-update-manifest.json"
ZIP_PATH="$TMP_DIR/arlecchino-macos-universal.zip"
ZIP_LIST="$TMP_DIR/zip-list.txt"
ZIP_APPLEDOUBLE="$TMP_DIR/zip-appledouble.txt"
ZIP_RUNTIME_ASSETS="$TMP_DIR/zip-runtime-assets.tsv"

if [[ -z "$TAG" ]]; then
  TAG="$(gh release list --repo "$OWNER/$REPO" --limit 20 --json tagName,isDraft,publishedAt \
    | node -e '
const fs = require("fs");
const releases = JSON.parse(fs.readFileSync(0, "utf8"));
const release = releases.find((item) => item && item.isDraft !== true);
if (!release) {
  process.exit(1);
}
process.stdout.write(release.tagName);
    ')"
fi

gh release view "$TAG" --repo "$OWNER/$REPO" \
  --json tagName,name,isDraft,isPrerelease,publishedAt,url,assets \
  > "$RELEASE_JSON"

gh release download "$TAG" --repo "$OWNER/$REPO" \
  --pattern "arlecchino-update-manifest.json" \
  --dir "$TMP_DIR" >/dev/null
gh release download "$TAG" --repo "$OWNER/$REPO" \
  --pattern "arlecchino-macos-universal.zip" \
  --dir "$TMP_DIR" >/dev/null

unzip -Z1 "$ZIP_PATH" > "$ZIP_LIST"
rg '(^__MACOSX/|(^|/)\._)' "$ZIP_LIST" > "$ZIP_APPLEDOUBLE" || true
: > "$ZIP_RUNTIME_ASSETS"
for entry in \
  "Arlecchino.app/Contents/Resources/assets/arle_model.onnx" \
  "Arlecchino.app/Contents/Resources/assets/arle_tokenizer.json"; do
  asset_tmp="$TMP_DIR/$(basename "$entry")"
  if unzip -p "$ZIP_PATH" "$entry" > "$asset_tmp" 2>/dev/null; then
    size="$(wc -c < "$asset_tmp" | tr -d '[:space:]')"
    sha="$(shasum -a 256 "$asset_tmp" | awk '{print $1}')"
    printf '%s\t%s\t%s\n' "$entry" "$size" "$sha" >> "$ZIP_RUNTIME_ASSETS"
  else
    printf '%s\t0\t\n' "$entry" >> "$ZIP_RUNTIME_ASSETS"
  fi
  rm -f "$asset_tmp"
done

if [[ "$RUN_INSTALLED_SMOKE" == "1" ]]; then
  ./scripts/wails3-installed-app-smoke-macos.sh \
    --app-bundle "$APP_BUNDLE" \
    --report "$INSTALLED_SMOKE_REPORT" \
    --allow-dev-orphans >/dev/null
else
  printf '{}\n' > "$INSTALLED_SMOKE_REPORT"
fi

INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || true)"
APP_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO_PLIST" 2>/dev/null || true)"

REPORT_PATH="$REPORT_PATH" \
APP_BUNDLE="$APP_BUNDLE" \
APP_VERSION="$APP_VERSION" \
APP_BUILD="$APP_BUILD" \
EXPECTED_VERSION="$EXPECTED_VERSION" \
EXPECTED_BUILD="$EXPECTED_BUILD" \
OWNER="$OWNER" \
REPO="$REPO" \
TAG="$TAG" \
RELEASE_JSON="$RELEASE_JSON" \
MANIFEST_PATH="$MANIFEST_PATH" \
ZIP_PATH="$ZIP_PATH" \
ZIP_LIST="$ZIP_LIST" \
ZIP_APPLEDOUBLE="$ZIP_APPLEDOUBLE" \
ZIP_RUNTIME_ASSETS="$ZIP_RUNTIME_ASSETS" \
INSTALLED_SMOKE_REPORT="$INSTALLED_SMOKE_REPORT" \
node <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
const readJSON = (file) => {
  try {
    return JSON.parse(readText(file));
  } catch {
    return {};
  }
};
const fileSha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const lines = (file) =>
  readText(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const runtimeAssetRows = (file) =>
  lines(file).map((line) => {
    const [entry, size, sha256] = line.split("\t");
    return {
      entry,
      size: Number(size || 0),
      sha256: sha256 || "",
      present: Number(size || 0) > 0 && Boolean(sha256),
    };
  });

const manifest = readJSON(process.env.MANIFEST_PATH);
const release = readJSON(process.env.RELEASE_JSON);
const installedSmoke = readJSON(process.env.INSTALLED_SMOKE_REPORT);
const zipEntries = lines(process.env.ZIP_LIST);
const appleDoubleEntries = lines(process.env.ZIP_APPLEDOUBLE);
const zipRuntimeAssets = runtimeAssetRows(process.env.ZIP_RUNTIME_ASSETS);
const artifact = Array.isArray(manifest.artifacts)
  ? manifest.artifacts.find((item) => item && item.kind === "zip")
  : undefined;

const expectedVersion = process.env.EXPECTED_VERSION || "";
const expectedBuild = process.env.EXPECTED_BUILD || "";
const appVersion = process.env.APP_VERSION || "";
const appBuild = process.env.APP_BUILD || "";
const zipSha256 = fs.existsSync(process.env.ZIP_PATH)
  ? fileSha256(process.env.ZIP_PATH)
  : "";
const requiredRuntimeAssetEntries = [
  "Arlecchino.app/Contents/Resources/assets/arle_model.onnx",
  "Arlecchino.app/Contents/Resources/assets/arle_tokenizer.json",
];
const checks = {
  appBundleName: path.basename(process.env.APP_BUNDLE) === "Arlecchino.app",
  appVersionMatches:
    !expectedVersion || (appVersion && appVersion === expectedVersion),
  appBuildMatches: !expectedBuild || (appBuild && appBuild === expectedBuild),
  manifestHasVersion: typeof manifest.version === "string" && manifest.version.length > 0,
  manifestHasSignature:
    Boolean(artifact && artifact.signature) || typeof manifest.signature === "string",
  manifestHasSha256:
    Boolean(artifact && artifact.sha256) || typeof manifest.sha256 === "string",
  zipContainsOnlyAppRoot: zipEntries.every((entry) => entry.startsWith("Arlecchino.app/")),
  zipHasNoAppleDoubleEntries: appleDoubleEntries.length === 0,
  zipHasRuntimeAssets:
    requiredRuntimeAssetEntries.every((entry) => zipEntries.includes(entry)) &&
    requiredRuntimeAssetEntries.every((entry) =>
      zipRuntimeAssets.some((asset) => asset.entry === entry && asset.present),
    ),
  zipSha256MatchesManifest:
    !artifact || !artifact.sha256 || artifact.sha256.toLowerCase() === zipSha256,
  installedSmokePassed:
    !installedSmoke.summary || installedSmoke.summary.passed !== false,
};

const report = {
  generatedAt: new Date().toISOString(),
  app: {
    bundlePath: process.env.APP_BUNDLE,
    version: appVersion,
    build: appBuild,
    expectedVersion: expectedVersion || undefined,
    expectedBuild: expectedBuild || undefined,
  },
  github: {
    repository: `${process.env.OWNER}/${process.env.REPO}`,
    tag: process.env.TAG,
    releaseUrl: release.url,
    prerelease: release.isPrerelease,
    draft: release.isDraft,
  },
  manifest: {
    version: manifest.version,
    channel: manifest.channel,
    mandatory: manifest.mandatory,
    artifactURL: artifact && artifact.url,
    artifactSha256: artifact && artifact.sha256,
    artifactSignaturePresent: Boolean(artifact && artifact.signature),
  },
  zip: {
    path: process.env.ZIP_PATH,
    sha256: zipSha256,
    entryCount: zipEntries.length,
    requiredRuntimeAssetEntries,
    runtimeAssets: zipRuntimeAssets,
    appleDoubleEntries,
  },
  installedSmokeReport:
    Object.keys(installedSmoke).length > 0
      ? process.env.INSTALLED_SMOKE_REPORT
      : undefined,
  checks,
  summary: {
    passed: Object.values(checks).every(Boolean),
    applyObserved: Boolean(
      expectedVersion &&
        expectedBuild &&
        appVersion === expectedVersion &&
        appBuild === expectedBuild,
    ),
    note:
      "Use this report before and after the in-app Install and relaunch step to record old-to-new updater evidence.",
  },
};

fs.mkdirSync(path.dirname(process.env.REPORT_PATH), { recursive: true });
fs.writeFileSync(process.env.REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
process.stdout.write(`report: ${process.env.REPORT_PATH}\n`);
if (!report.summary.passed) {
  process.exit(1);
}
NODE
