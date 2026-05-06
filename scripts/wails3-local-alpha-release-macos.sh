#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true
unsetopt XTRACE 2>/dev/null || true
unsetopt VERBOSE 2>/dev/null || true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BRANCH="main"
CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: scripts/wails3-local-alpha-release-macos.sh is only for $EXPECTED_BRANCH." >&2
  echo "Current branch: ${CURRENT_BRANCH:-unknown}" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: local alpha release packaging is macOS-only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to write the release evidence report." >&2
  exit 1
fi

APP_NAME="$(plutil -extract outputfilename raw -o - "$ROOT_DIR/wails.json")"
BUILD_DIR_RAW="$(plutil -extract 'build:dir' raw -o - "$ROOT_DIR/wails.json")"
if [[ "$BUILD_DIR_RAW" = /* ]]; then
  BUILD_DIR="$BUILD_DIR_RAW"
else
  BUILD_DIR="$ROOT_DIR/$BUILD_DIR_RAW"
fi

PROFILE="${ARLE_WAILS3_RELEASE_PROFILE:-local-alpha}"
VERSION="${ARLE_WAILS3_APP_VERSION:-0.0.0-alpha}"
BUILD_NUMBER="${ARLE_WAILS3_APP_BUILD:-1}"
BUNDLE_ID="${ARLE_WAILS3_BUNDLE_ID:-io.arlecchino.ide.local-alpha}"
MIN_MACOS_VERSION="${ARLE_WAILS3_MIN_MACOS:-11.0}"
ARCH_TARGET="${ARLE_WAILS3_RELEASE_ARCH:-universal}"
SIGN_MODE="${ARLE_WAILS3_SIGN_MODE:-adhoc}"
CREATE_DMG="${ARLE_WAILS3_RELEASE_CREATE_DMG:-0}"
RUN_SMOKE="${ARLE_WAILS3_RELEASE_RUN_SMOKE:-1}"
UPDATE_CHANNEL="${ARLE_WAILS3_UPDATE_CHANNEL:-${ARLECCHINO_AUTO_UPDATE_CHANNEL:-alpha}}"
UPDATE_MANIFEST_URL="${ARLE_WAILS3_UPDATE_MANIFEST_URL:-${ARLECCHINO_AUTO_UPDATE_MANIFEST_URL:-}}"
UPDATE_PRIVATE_KEY="${ARLE_WAILS3_UPDATE_SIGNING_KEY:-}"
UPDATE_MANIFEST_PATH="${ARLE_WAILS3_UPDATE_MANIFEST_OUT:-}"
UPDATE_ARTIFACT_URL="${ARLE_WAILS3_UPDATE_ARTIFACT_URL:-}"
UPDATE_PUBLIC_KEY="${ARLECCHINO_AUTO_UPDATE_PUBLIC_KEY:-}"
UPDATE_PUBLIC_KEY_OUT="${ARLE_WAILS3_UPDATE_PUBLIC_KEY_OUT:-}"
SKIP_FRONTEND="0"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_ROOT="${ARLE_WAILS3_RELEASE_OUTPUT:-$BUILD_DIR/releases/local-alpha}"
RELEASE_DIR=""
REPORT_PATH=""

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
}

usage() {
  cat <<'EOF'
Usage: scripts/wails3-local-alpha-release-macos.sh [options]

Options:
  --profile <name>      Release profile. Only local-alpha is supported.
  --output-dir <path>   Release output directory.
  --version <version>   CFBundleShortVersionString. Default: current git tag version.
  --build <number>      CFBundleVersion. Default: current git tag build.
  --bundle-id <id>      CFBundleIdentifier.
  --min-macos <version> Minimum macOS version. Default: 11.0.
  --arch <target>       arm64, amd64, or universal. Default: universal.
  --sign <mode>         adhoc, developer-id, or none. Default: adhoc.
  --create-dmg          Create arlecchino-macos-<arch>.dmg through create-dmg or npx create-dmg.
  --skip-dmg            Do not create a DMG.
  --run-smoke           Run the existing Wails v3 release smoke suite.
  --skip-smoke          Skip release smoke suite and mark it skipped in report.
  --skip-frontend       Reuse current frontend build for secondary arch builds.
  --update-private-key <path>
                         External Ed25519 PEM private key for signed updater manifest.
  --update-manifest <path>
                         Output manifest path. Default: artifacts/arlecchino-update-manifest.json.
  --update-artifact-url <url>
                         Public updater ZIP URL. Default: file:// URL for local candidate.
  --update-channel <ch> Update channel. Default: alpha.
  --update-public-key <base64>
                         Embed/configure the Ed25519 public key for the app verifier.
  --update-public-key-out <path>
                         Output derived public key path.
  --report <path>       JSON evidence report path.

This profile is for local alpha smoke without Apple Developer ID trust.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      shift
      PROFILE="${1:-}"
      shift
      ;;
    --output-dir)
      shift
      RELEASE_DIR="${1:-}"
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
    --bundle-id)
      shift
      BUNDLE_ID="${1:-}"
      shift
      ;;
    --min-macos)
      shift
      MIN_MACOS_VERSION="${1:-}"
      shift
      ;;
    --arch)
      shift
      ARCH_TARGET="${1:-}"
      shift
      ;;
    --sign)
      shift
      SIGN_MODE="${1:-}"
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
    --run-smoke)
      RUN_SMOKE="1"
      shift
      ;;
    --skip-smoke)
      RUN_SMOKE="0"
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND="1"
      shift
      ;;
    --update-private-key)
      shift
      UPDATE_PRIVATE_KEY="${1:-}"
      shift
      ;;
    --update-manifest)
      shift
      UPDATE_MANIFEST_PATH="${1:-}"
      shift
      ;;
    --update-artifact-url)
      shift
      UPDATE_ARTIFACT_URL="${1:-}"
      shift
      ;;
    --update-channel)
      shift
      UPDATE_CHANNEL="${1:-}"
      shift
      ;;
    --update-public-key)
      shift
      UPDATE_PUBLIC_KEY="${1:-}"
      shift
      ;;
    --update-public-key-out)
      shift
      UPDATE_PUBLIC_KEY_OUT="${1:-}"
      shift
      ;;
    --report)
      shift
      REPORT_PATH="${1:-}"
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
if [[ -n "$GIT_RELEASE_TAG" ]]; then
  apply_git_release_tag_defaults "$GIT_RELEASE_TAG"
fi

if [[ "$PROFILE" != "local-alpha" ]]; then
  echo "ERROR: unsupported release profile: $PROFILE" >&2
  echo "Only local-alpha is available without Apple Developer ID." >&2
  exit 1
fi

case "$ARCH_TARGET" in
  arm64|amd64|universal)
    ;;
  *)
    echo "ERROR: --arch must be arm64, amd64, or universal." >&2
    exit 1
    ;;
esac

case "$SIGN_MODE" in
  none|adhoc|developer-id)
    ;;
  *)
    echo "ERROR: --sign must be none, adhoc, or developer-id." >&2
    exit 1
    ;;
esac

if [[ -z "$RELEASE_DIR" ]]; then
  RELEASE_DIR="$OUTPUT_ROOT/$VERSION-$BUILD_NUMBER-$RUN_ID"
fi
mkdir -p "$RELEASE_DIR/bin" "$RELEASE_DIR/artifacts" "$RELEASE_DIR/logs"
if [[ -z "$REPORT_PATH" ]]; then
  REPORT_PATH="$RELEASE_DIR/release-evidence.json"
fi
if [[ -z "$UPDATE_MANIFEST_PATH" && -n "$UPDATE_PRIVATE_KEY" ]]; then
  UPDATE_MANIFEST_PATH="$RELEASE_DIR/artifacts/arlecchino-update-manifest.json"
fi
if [[ -z "$UPDATE_PUBLIC_KEY_OUT" && -n "$UPDATE_PRIVATE_KEY" ]]; then
  UPDATE_PUBLIC_KEY_OUT="$RELEASE_DIR/artifacts/arlecchino-update-public-key.txt"
fi

case "$ARCH_TARGET" in
  amd64)
    PUBLIC_ARCH_LABEL="x86_64"
    ;;
  *)
    PUBLIC_ARCH_LABEL="$ARCH_TARGET"
    ;;
esac
PUBLIC_ASSET_STEM="arlecchino-macos-$PUBLIC_ARCH_LABEL"
PUBLIC_ZIP_NAME="$PUBLIC_ASSET_STEM.zip"
PUBLIC_DMG_NAME="$PUBLIC_ASSET_STEM.dmg"
SUPPORTED_MACOS_RANGE="Big Sur 11.0 through Tahoe 26.x"
BUILD_COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo dev)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

APP_BUNDLE="$RELEASE_DIR/$APP_NAME.app"
UNIVERSAL_BINARY="$RELEASE_DIR/bin/$APP_NAME-universal"
ZIP_PATH="$RELEASE_DIR/artifacts/$PUBLIC_ZIP_NAME"
DMG_PATH=""
SMOKE_STATUS="skipped"
SMOKE_EXIT="0"
SMOKE_LOG="$RELEASE_DIR/logs/release-smoke.log"
SMOKE_REPORT="$RELEASE_DIR/release-smoke-report.json"

if [[ -n "$UPDATE_PRIVATE_KEY" && -z "$UPDATE_PUBLIC_KEY" ]]; then
  UPDATE_PUBLIC_KEY="$(node - "$UPDATE_PRIVATE_KEY" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const privateKey = crypto.createPrivateKey(fs.readFileSync(process.argv[2]));
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error(`Private key must be Ed25519, got ${privateKey.asymmetricKeyType}`);
}
const publicJwk = crypto.createPublicKey(privateKey).export({ format: "jwk" });
process.stdout.write(Buffer.from(publicJwk.x, "base64url").toString("base64"));
NODE
)"
fi

build_ldflags() {
  local flags=(
    "-X" "main.buildVersion=$VERSION"
    "-X" "main.buildNumber=$BUILD_NUMBER"
    "-X" "main.buildCommit=$BUILD_COMMIT"
    "-X" "main.buildTime=$BUILD_TIME"
    "-X" "main.buildChannel=$UPDATE_CHANNEL"
    "-X" "main.buildManifestURL=$UPDATE_MANIFEST_URL"
    "-X" "main.buildUpdatePubKey=$UPDATE_PUBLIC_KEY"
  )
  echo "${flags[*]}"
}

build_arch_binary() {
  local arch="$1"
  local output="$2"
  local skip_frontend="$3"
  local args=(--build-only --output "$output")
  if [[ "$skip_frontend" == "1" ]]; then
    args+=(--skip-frontend)
  fi

  echo "Building Wails v3 $arch binary: $output" >&2
  env \
    GOOS=darwin \
    GOARCH="$arch" \
    CGO_ENABLED=1 \
    MACOSX_DEPLOYMENT_TARGET="$MIN_MACOS_VERSION" \
    CGO_CFLAGS="${CGO_CFLAGS:-} -mmacosx-version-min=$MIN_MACOS_VERSION" \
    CGO_CXXFLAGS="${CGO_CXXFLAGS:-} -mmacosx-version-min=$MIN_MACOS_VERSION" \
    CGO_LDFLAGS="${CGO_LDFLAGS:-} -mmacosx-version-min=$MIN_MACOS_VERSION" \
    ARLE_WAILS3_GOCACHE="$RELEASE_DIR/go-build-cache-$arch" \
    ARLE_WAILS3_LDFLAGS="$(build_ldflags)" \
    "$ROOT_DIR/scripts/wails3-dev-macos.sh" "${args[@]}"
}

run_create_dmg() {
  local destination="$1"
  local tmp_dir="$RELEASE_DIR/dmg-tmp"
  local canonical_path="$destination/$PUBLIC_DMG_NAME"
  local generated_path=""
  mkdir -p "$destination"
  rm -rf "$tmp_dir"
  mkdir -p "$tmp_dir"
  if command -v create-dmg >/dev/null 2>&1; then
    create-dmg --overwrite --no-code-sign --no-version-in-filename --dmg-title "$APP_NAME" "$APP_BUNDLE" "$tmp_dir" >&2
  elif command -v npx >/dev/null 2>&1; then
    npx --yes create-dmg --overwrite --no-code-sign --no-version-in-filename --dmg-title "$APP_NAME" "$APP_BUNDLE" "$tmp_dir" >&2
  else
    echo "ERROR: create-dmg or npx is required for --create-dmg." >&2
    return 1
  fi
  generated_path="$(find "$tmp_dir" -maxdepth 1 -name '*.dmg' -print | sort | tail -1)"
  if [[ -z "$generated_path" || ! -f "$generated_path" ]]; then
    echo "ERROR: create-dmg did not produce a DMG in $tmp_dir." >&2
    return 1
  fi
  rm -f "$canonical_path"
  mv "$generated_path" "$canonical_path"
  rm -rf "$tmp_dir"
  echo "$canonical_path"
}

if [[ "$ARCH_TARGET" == "universal" ]]; then
  ARM64_BINARY="$RELEASE_DIR/bin/$APP_NAME-arm64"
  AMD64_BINARY="$RELEASE_DIR/bin/$APP_NAME-x86_64"
  build_arch_binary "arm64" "$ARM64_BINARY" "$SKIP_FRONTEND"
  build_arch_binary "amd64" "$AMD64_BINARY" "1"
  lipo -create -output "$UNIVERSAL_BINARY" "$ARM64_BINARY" "$AMD64_BINARY"
  chmod +x "$UNIVERSAL_BINARY"
  PACKAGE_BINARY="$UNIVERSAL_BINARY"
else
  PACKAGE_BINARY="$RELEASE_DIR/bin/$APP_NAME-$PUBLIC_ARCH_LABEL"
  build_arch_binary "$ARCH_TARGET" "$PACKAGE_BINARY" "$SKIP_FRONTEND"
fi

env ARLE_WAILS3_MIN_MACOS="$MIN_MACOS_VERSION" \
  "$ROOT_DIR/scripts/wails3-package-macos.sh" \
  --skip-build \
  --output "$PACKAGE_BINARY" \
  --app-bundle "$APP_BUNDLE" \
  --bundle-id "$BUNDLE_ID" \
  --version "$VERSION" \
  --build "$BUILD_NUMBER" \
  --min-macos "$MIN_MACOS_VERSION" \
  --sign "$SIGN_MODE"

COPYFILE_DISABLE=1 ditto --norsrc --noextattr --noqtn --noacl -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"

if [[ -n "$UPDATE_PRIVATE_KEY" ]]; then
  UPDATE_MANIFEST_ARCH="$ARCH_TARGET"
  if [[ "$ARCH_TARGET" == "universal" ]]; then
    UPDATE_MANIFEST_ARCH="universal"
  fi
  UPDATE_MANIFEST_URL_ARG=()
  if [[ -n "$UPDATE_ARTIFACT_URL" ]]; then
    UPDATE_MANIFEST_URL_ARG=(--url "$UPDATE_ARTIFACT_URL")
  fi
  node "$ROOT_DIR/scripts/wails3-update-manifest.mjs" \
    --artifact "$ZIP_PATH" \
    --private-key "$UPDATE_PRIVATE_KEY" \
    --out "$UPDATE_MANIFEST_PATH" \
    --version "$VERSION" \
    --build "$BUILD_NUMBER" \
    --channel "$UPDATE_CHANNEL" \
    --platform darwin \
    --arch "$UPDATE_MANIFEST_ARCH" \
    --kind zip \
    --public-key-out "$UPDATE_PUBLIC_KEY_OUT" \
    "${UPDATE_MANIFEST_URL_ARG[@]}" > "$RELEASE_DIR/logs/update-manifest.json"
fi

if [[ "$CREATE_DMG" == "1" ]]; then
  DMG_PATH="$(run_create_dmg "$RELEASE_DIR/artifacts")"
fi

if [[ "$RUN_SMOKE" == "1" ]]; then
  set +e
  ARLE_WAILS3_RELEASE_SMOKE_SIGN_MODE="$SIGN_MODE" "$ROOT_DIR/scripts/wails3-release-smoke-macos.sh" --report "$SMOKE_REPORT" >"$SMOKE_LOG" 2>&1
  SMOKE_EXIT="$?"
  set -e
  if [[ "$SMOKE_EXIT" == "0" ]]; then
    SMOKE_STATUS="passed"
  else
    SMOKE_STATUS="failed"
  fi
fi

set +e
CODESIGN_OUTPUT="$(/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE" 2>&1)"
CODESIGN_EXIT="$?"
SPCTL_OUTPUT="$(/usr/sbin/spctl -a -vv --type execute "$APP_BUNDLE" 2>&1)"
SPCTL_EXIT="$?"
LIPO_INFO="$(lipo -info "$APP_BUNDLE/Contents/MacOS/$APP_NAME" 2>&1)"
FILE_INFO="$(file "$APP_BUNDLE/Contents/MacOS/$APP_NAME" 2>&1)"
set -e

export ARLE_RELEASE_REPORT_PATH="$REPORT_PATH"
export ARLE_RELEASE_PROFILE="$PROFILE"
export ARLE_RELEASE_VERSION="$VERSION"
export ARLE_RELEASE_BUILD="$BUILD_NUMBER"
export ARLE_RELEASE_BUNDLE_ID="$BUNDLE_ID"
export ARLE_RELEASE_MIN_MACOS="$MIN_MACOS_VERSION"
export ARLE_RELEASE_ARCH_TARGET="$ARCH_TARGET"
export ARLE_RELEASE_PUBLIC_ARCH_LABEL="$PUBLIC_ARCH_LABEL"
export ARLE_RELEASE_SIGN_MODE="$SIGN_MODE"
export ARLE_RELEASE_APP_BUNDLE_NAME="$APP_NAME.app"
export ARLE_RELEASE_PUBLIC_ASSET_STEM="$PUBLIC_ASSET_STEM"
export ARLE_RELEASE_PUBLIC_ZIP_NAME="$PUBLIC_ZIP_NAME"
export ARLE_RELEASE_PUBLIC_DMG_NAME="$PUBLIC_DMG_NAME"
export ARLE_RELEASE_SUPPORTED_MACOS_RANGE="$SUPPORTED_MACOS_RANGE"
export ARLE_RELEASE_BUILD_COMMIT="$BUILD_COMMIT"
export ARLE_RELEASE_BUILD_TIME="$BUILD_TIME"
export ARLE_RELEASE_APP_BUNDLE="$APP_BUNDLE"
export ARLE_RELEASE_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/$APP_NAME"
export ARLE_RELEASE_ZIP_PATH="$ZIP_PATH"
export ARLE_RELEASE_DMG_PATH="$DMG_PATH"
export ARLE_RELEASE_CREATE_DMG="$CREATE_DMG"
export ARLE_RELEASE_RUN_SMOKE="$RUN_SMOKE"
export ARLE_RELEASE_SMOKE_STATUS="$SMOKE_STATUS"
export ARLE_RELEASE_SMOKE_EXIT="$SMOKE_EXIT"
export ARLE_RELEASE_SMOKE_LOG="$SMOKE_LOG"
export ARLE_RELEASE_SMOKE_REPORT="$SMOKE_REPORT"
export ARLE_RELEASE_CODESIGN_OUTPUT="$CODESIGN_OUTPUT"
export ARLE_RELEASE_CODESIGN_EXIT="$CODESIGN_EXIT"
export ARLE_RELEASE_SPCTL_OUTPUT="$SPCTL_OUTPUT"
export ARLE_RELEASE_SPCTL_EXIT="$SPCTL_EXIT"
export ARLE_RELEASE_LIPO_INFO="$LIPO_INFO"
export ARLE_RELEASE_FILE_INFO="$FILE_INFO"
export ARLE_RELEASE_UPDATE_CHANNEL="$UPDATE_CHANNEL"
export ARLE_RELEASE_UPDATE_MANIFEST_URL="$UPDATE_MANIFEST_URL"
export ARLE_RELEASE_UPDATE_MANIFEST_PATH="$UPDATE_MANIFEST_PATH"
export ARLE_RELEASE_UPDATE_PRIVATE_KEY_CONFIGURED="$([[ -n "$UPDATE_PRIVATE_KEY" ]] && echo true || echo false)"
export ARLE_RELEASE_UPDATE_PUBLIC_KEY_OUT="$UPDATE_PUBLIC_KEY_OUT"
export ARLE_RELEASE_UPDATE_ARTIFACT_URL="$UPDATE_ARTIFACT_URL"
node <<'NODE'
const fs = require("fs");
const { spawnSync } = require("child_process");

const env = process.env;
const readPlist = (appBundle) => {
  const infoPath = `${appBundle}/Contents/Info.plist`;
  const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", infoPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return { path: infoPath, error: (result.stderr || result.stdout || "").trim() };
  }
  return { path: infoPath, ...JSON.parse(result.stdout) };
};
const exists = (path) => Boolean(path && fs.existsSync(path));
const statSize = (path) => exists(path) ? fs.statSync(path).size : 0;
const basename = (path) => path ? require("path").basename(path) : "";
const parseArchs = (lipoInfo) => {
  const archs = new Set();
  const matches = [...lipoInfo.matchAll(/architecture(?:s)?:? ([A-Za-z0-9_ ]+)/g)];
  for (const match of matches) {
    for (const arch of match[1].split(/\s+/).filter(Boolean)) {
      if (arch !== "are" && arch !== "in" && arch !== "the" && arch !== "fat" && arch !== "file") {
        archs.add(arch);
      }
    }
  }
  if (/x86_64/.test(lipoInfo)) archs.add("x86_64");
  if (/arm64/.test(lipoInfo)) archs.add("arm64");
  return [...archs].sort();
};
const signMode = env.ARLE_RELEASE_SIGN_MODE;
const spctlExit = Number(env.ARLE_RELEASE_SPCTL_EXIT || "0");
const spctlStatus = spctlExit === 0
  ? "accepted"
  : signMode === "adhoc"
    ? "expected-rejected"
    : "rejected";
const report = {
  runtime: "wails",
  platform: "darwin",
  generatedAt: new Date().toISOString(),
  profile: env.ARLE_RELEASE_PROFILE,
  publicAssetPolicy: {
    appBundleName: env.ARLE_RELEASE_APP_BUNDLE_NAME,
    supportedMacOSRange: env.ARLE_RELEASE_SUPPORTED_MACOS_RANGE,
    githubAssetNames: {
      macOSPrimaryDMG: env.ARLE_RELEASE_PUBLIC_DMG_NAME,
      macOSFallbackZip: env.ARLE_RELEASE_PUBLIC_ZIP_NAME,
    },
    versionSource: "git tag and release metadata",
    publicNameContainsV3: /v3/i.test([
      env.ARLE_RELEASE_APP_BUNDLE_NAME,
      env.ARLE_RELEASE_PUBLIC_DMG_NAME,
      env.ARLE_RELEASE_PUBLIC_ZIP_NAME,
    ].filter(Boolean).join(" ")),
  },
  trustModel: {
    appleDeveloperAvailable: false,
    publicTrustedDistribution: false,
    localAlphaOnly: true,
    developerId: {
      status: signMode === "developer-id" ? "configured" : "skipped-no-developer-id",
    },
    notarization: {
      status: "skipped-no-developer-id",
    },
  },
  target: {
    arch: env.ARLE_RELEASE_ARCH_TARGET,
    publicArch: env.ARLE_RELEASE_PUBLIC_ARCH_LABEL,
    binaryArchs: parseArchs(env.ARLE_RELEASE_LIPO_INFO || ""),
    minMacOS: env.ARLE_RELEASE_MIN_MACOS,
    supportedMacOSRange: env.ARLE_RELEASE_SUPPORTED_MACOS_RANGE,
    intelSupported: parseArchs(env.ARLE_RELEASE_LIPO_INFO || "").includes("x86_64"),
    appleSiliconSupported: parseArchs(env.ARLE_RELEASE_LIPO_INFO || "").includes("arm64"),
  },
  app: {
    bundleId: env.ARLE_RELEASE_BUNDLE_ID,
    version: env.ARLE_RELEASE_VERSION,
    build: env.ARLE_RELEASE_BUILD,
    gitSha: env.ARLE_RELEASE_BUILD_COMMIT,
    builtAt: env.ARLE_RELEASE_BUILD_TIME,
    bundlePath: env.ARLE_RELEASE_APP_BUNDLE,
    executablePath: env.ARLE_RELEASE_EXECUTABLE,
    infoPlist: readPlist(env.ARLE_RELEASE_APP_BUNDLE),
  },
  signing: {
    mode: signMode,
    codesignVerify: {
      exitCode: Number(env.ARLE_RELEASE_CODESIGN_EXIT || "0"),
      passed: env.ARLE_RELEASE_CODESIGN_EXIT === "0",
      output: env.ARLE_RELEASE_CODESIGN_OUTPUT || "",
    },
    gatekeeper: {
      exitCode: spctlExit,
      status: spctlStatus,
      expectedWarning: signMode === "adhoc" && spctlExit !== 0,
      output: env.ARLE_RELEASE_SPCTL_OUTPUT || "",
    },
  },
  artifacts: {
    app: {
      path: env.ARLE_RELEASE_APP_BUNDLE,
      name: basename(env.ARLE_RELEASE_APP_BUNDLE),
      exists: exists(env.ARLE_RELEASE_APP_BUNDLE),
    },
    zip: {
      path: env.ARLE_RELEASE_ZIP_PATH,
      name: basename(env.ARLE_RELEASE_ZIP_PATH),
      exists: exists(env.ARLE_RELEASE_ZIP_PATH),
      size: statSize(env.ARLE_RELEASE_ZIP_PATH),
    },
    dmg: {
      requested: env.ARLE_RELEASE_CREATE_DMG === "1",
      path: env.ARLE_RELEASE_DMG_PATH || "",
      name: basename(env.ARLE_RELEASE_DMG_PATH) || env.ARLE_RELEASE_PUBLIC_DMG_NAME,
      exists: exists(env.ARLE_RELEASE_DMG_PATH),
      size: statSize(env.ARLE_RELEASE_DMG_PATH),
      tool: env.ARLE_RELEASE_CREATE_DMG === "1" ? "sindresorhus/create-dmg" : "",
    },
  },
  autoUpdate: {
    channel: env.ARLE_RELEASE_UPDATE_CHANNEL,
    manifestUrl: env.ARLE_RELEASE_UPDATE_MANIFEST_URL || "",
    manifestPath: env.ARLE_RELEASE_UPDATE_MANIFEST_PATH || "",
    manifestExists: exists(env.ARLE_RELEASE_UPDATE_MANIFEST_PATH),
    updaterArtifact: {
      path: env.ARLE_RELEASE_ZIP_PATH,
      name: basename(env.ARLE_RELEASE_ZIP_PATH),
      kind: "zip",
    },
    publicInstaller: {
      path: env.ARLE_RELEASE_DMG_PATH || "",
      name: basename(env.ARLE_RELEASE_DMG_PATH) || env.ARLE_RELEASE_PUBLIC_DMG_NAME,
      kind: "dmg",
    },
    signingKeyConfigured: env.ARLE_RELEASE_UPDATE_PRIVATE_KEY_CONFIGURED === "true",
    publicKeyOut: env.ARLE_RELEASE_UPDATE_PUBLIC_KEY_OUT || "",
    publicKeyOutExists: exists(env.ARLE_RELEASE_UPDATE_PUBLIC_KEY_OUT),
    applyPolicy: "user-confirmed-relaunch-no-sudo",
    trustRoot: "HTTPS plus pinned Ed25519 public key plus SHA256",
  },
  smoke: {
    requested: env.ARLE_RELEASE_RUN_SMOKE === "1",
    status: env.ARLE_RELEASE_SMOKE_STATUS,
    exitCode: Number(env.ARLE_RELEASE_SMOKE_EXIT || "0"),
    logPath: env.ARLE_RELEASE_SMOKE_LOG,
    reportPath: env.ARLE_RELEASE_SMOKE_REPORT,
    reportExists: exists(env.ARLE_RELEASE_SMOKE_REPORT),
  },
  binary: {
    lipoInfo: env.ARLE_RELEASE_LIPO_INFO || "",
    fileInfo: env.ARLE_RELEASE_FILE_INFO || "",
  },
};
fs.mkdirSync(require("path").dirname(env.ARLE_RELEASE_REPORT_PATH), { recursive: true });
fs.writeFileSync(env.ARLE_RELEASE_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
if (report.smoke.requested && report.smoke.status !== "passed") {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
NODE

cat "$REPORT_PATH"
echo "Wails v3 local-alpha release artifacts: $RELEASE_DIR" >&2
