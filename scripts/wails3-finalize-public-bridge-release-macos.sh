#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="${ARLE_WAILS3_GITHUB_RELEASE_OWNER:-KlawdiyRomiy}"
REPO="${ARLE_WAILS3_GITHUB_RELEASE_REPO:-Arlecchino}"
TAG=""
VERSION=""
BUILD_NUMBER=""
NOTES_FILE=""
UPDATE_PRIVATE_KEY="${ARLE_WAILS3_UPDATE_SIGNING_KEY:-}"
PRIMARY_MANIFEST_ASSET="${ARLE_WAILS3_UPDATE_MANIFEST_ASSET:-arlecchino-beta-update-manifest.json}"
LEGACY_MANIFEST_ASSET="${ARLE_WAILS3_LEGACY_UPDATE_MANIFEST_ASSET:-arlecchino-update-manifest.json}"
LEGACY_MANIFEST_CHANNEL="${ARLE_WAILS3_LEGACY_UPDATE_CHANNEL:-alpha}"

usage() {
  cat <<'EOF'
Usage: scripts/wails3-finalize-public-bridge-release-macos.sh [options]

Re-signs a published private-to-public bridge release so both updater manifests
contain direct, tokenless GitHub download URLs. Run this only after GitHub
repository visibility has been changed to public and before launching the
bridge build for the first time.

Options:
  --tag <tag>               Required bridge tag, e.g. v0.2.28-beta.149.
  --version <version>       Required app version, e.g. 0.2.28-beta.
  --build <number>          Required numeric build.
  --notes-file <path>       Required release notes used in both manifests.
  --update-private-key <p>  External Ed25519 PEM private key.
  --owner <owner>           GitHub owner. Default: KlawdiyRomiy.
  --repo <repo>             GitHub repo. Default: Arlecchino.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --build)
      BUILD_NUMBER="${2:-}"
      shift 2
      ;;
    --notes-file)
      NOTES_FILE="${2:-}"
      shift 2
      ;;
    --update-private-key)
      UPDATE_PRIVATE_KEY="${2:-}"
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
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "ERROR: $name is required." >&2
    usage >&2
    exit 2
  fi
}

require_value "--tag" "$TAG"
require_value "--version" "$VERSION"
require_value "--build" "$BUILD_NUMBER"
require_value "--notes-file" "$NOTES_FILE"
require_value "--update-private-key" "$UPDATE_PRIVATE_KEY"
if [[ ! "$BUILD_NUMBER" =~ '^[0-9]+$' ]]; then
  echo "ERROR: --build must be numeric." >&2
  exit 2
fi
if [[ "$TAG" != "v$VERSION.$BUILD_NUMBER" ]]; then
  echo "ERROR: --tag must exactly match v<version>.<build>; expected v$VERSION.$BUILD_NUMBER." >&2
  exit 2
fi
if [[ ! -f "$NOTES_FILE" || ! -f "$UPDATE_PRIVATE_KEY" ]]; then
  echo "ERROR: release notes or update private key file is missing." >&2
  exit 2
fi
for command in curl gh node shasum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: $command is required." >&2
    exit 2
  fi
done

visibility="$(gh api "repos/$OWNER/$REPO" --jq '.visibility')"
if [[ "$visibility" != "public" ]]; then
  echo "ERROR: $OWNER/$REPO is still $visibility; open the repository before finalizing the bridge." >&2
  exit 1
fi
if ! gh release view "$TAG" --repo "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "ERROR: bridge release $TAG was not found." >&2
  exit 1
fi

release_base="https://github.com/$OWNER/$REPO/releases"
zip_url="$release_base/download/$TAG/arlecchino-macos-universal.zip"
legacy_url="$release_base/download/$TAG/$LEGACY_MANIFEST_ASSET"
manifest_url="$release_base/latest/download/$PRIMARY_MANIFEST_ASSET"
has_dmg="$(gh release view "$TAG" --repo "$OWNER/$REPO" --json assets --jq '.assets | any(.name == "arlecchino-macos-universal.dmg")')"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/arlecchino-public-bridge.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
zip_path="$tmp_dir/arlecchino-macos-universal.zip"
dmg_path="$tmp_dir/arlecchino-macos-universal.dmg"
primary_path="$tmp_dir/$PRIMARY_MANIFEST_ASSET"
legacy_path="$tmp_dir/$LEGACY_MANIFEST_ASSET"
public_key_path="$tmp_dir/arlecchino-update-public-key.txt"
checksums_path="$tmp_dir/checksums.sha256"

curl --fail --location --retry 3 --output "$zip_path" "$zip_url"
if [[ "$has_dmg" == "true" ]]; then
  curl --fail --location --retry 3 --output "$dmg_path" "$release_base/download/$TAG/arlecchino-macos-universal.dmg"
fi
generate_manifest() {
  local output_path="$1"
  local channel="$2"
  ARLE_WAILS3_UPDATE_SIGNING_KEY="$UPDATE_PRIVATE_KEY" node "$ROOT_DIR/scripts/wails3-update-manifest.mjs" \
    --artifact "$zip_path" \
    --out "$output_path" \
    --version "$VERSION" \
    --build "$BUILD_NUMBER" \
    --channel "$channel" \
    --platform darwin \
    --arch universal \
    --kind zip \
    --public-key-out "$public_key_path" \
    --url "$zip_url" \
    --release-notes-file "$NOTES_FILE" >/dev/null
}

generate_manifest "$primary_path" beta
generate_manifest "$legacy_path" "$LEGACY_MANIFEST_CHANNEL"
(
  cd "$tmp_dir"
  checksum_inputs=(
    arlecchino-macos-universal.zip
    "$PRIMARY_MANIFEST_ASSET"
    "$LEGACY_MANIFEST_ASSET"
    arlecchino-update-public-key.txt
  )
  if [[ "$has_dmg" == "true" ]]; then
    checksum_inputs+=(arlecchino-macos-universal.dmg)
  fi
  shasum -a 256 "${checksum_inputs[@]}" > "$checksums_path"
)
gh release upload "$TAG" \
  "$primary_path" \
  "$legacy_path" \
  "$public_key_path" \
  "$checksums_path" \
  --repo "$OWNER/$REPO" \
  --clobber

downloaded_manifest="$tmp_dir/downloaded-$PRIMARY_MANIFEST_ASSET"
downloaded_legacy="$tmp_dir/downloaded-$LEGACY_MANIFEST_ASSET"
curl --fail --location --retry 3 --output "$downloaded_manifest" "$manifest_url"
curl --fail --location --retry 3 --output "$downloaded_legacy" "$legacy_url"
node - "$downloaded_manifest" "$downloaded_legacy" "$public_key_path" "$zip_path" "$zip_url" "$VERSION" "$BUILD_NUMBER" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const [primaryPath, legacyPath, publicKeyPath, zipPath, expectedURL, version, build] = process.argv.slice(2);
const zip = fs.readFileSync(zipPath);
const publicKeyRaw = Buffer.from(fs.readFileSync(publicKeyPath, "utf8").trim(), "base64");
const publicKey = crypto.createPublicKey({ key: Buffer.concat([
  Buffer.from("302a300506032b6570032100", "hex"),
  publicKeyRaw,
]), format: "der", type: "spki" });
for (const [path, channel] of [[primaryPath, "beta"], [legacyPath, "alpha"]]) {
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  const artifact = manifest.artifacts?.[0];
  if (manifest.channel !== channel || manifest.version !== version || String(manifest.build) !== build) {
    throw new Error(`${path}: manifest identity mismatch`);
  }
  if (!artifact || artifact.url !== expectedURL || artifact.sha256 !== crypto.createHash("sha256").update(zip).digest("hex")) {
    throw new Error(`${path}: public artifact mismatch`);
  }
  if (!crypto.verify(null, zip, publicKey, Buffer.from(artifact.signature, "base64"))) {
    throw new Error(`${path}: Ed25519 signature verification failed`);
  }
}
NODE

echo "PASS public bridge finalized: $TAG"
