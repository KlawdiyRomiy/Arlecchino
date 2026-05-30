#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertReleaseNotesPolicy } from "./wails3-release-notes-policy.mjs";
import {
  inspectZippedAppCodeIdentity,
  isPermissionStableIdentity,
  manifestSafeCodeIdentity,
} from "./macos-code-identity.mjs";

const args = process.argv.slice(2);

const usage = () => {
  console.log(`Usage: scripts/wails3-update-manifest.mjs --artifact <path> --private-key <pem> --out <path> [options]

Options:
  --version <version>       Release version. Default: 0.0.0-beta
  --build <build>           Release build number. Optional.
  --channel <channel>       Update channel. Default: beta
  --platform <platform>     Artifact platform. Default: darwin
  --arch <arch>             arm64, amd64, universal, or empty. Default: universal
  --url <url>               Public artifact URL. Default: file:// artifact URL
  --kind <kind>             Artifact kind. Default: zip
  --release-notes <text>    Release notes text.
  --release-notes-file <p>  Release notes file.
  --mandatory               Mark update as mandatory.
  --allow-permission-unstable
                            Allow a macOS ZIP whose code identity will reset folder permissions.
                            Intended only for internal smoke artifacts.
  --public-key-out <path>   Write raw Ed25519 public key as base64 for app verifier env.

The private key must be an external Ed25519 PEM file and is never written to the manifest.`);
};

const readOption = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return "";
  if (index + 1 >= args.length) {
    throw new Error(`Missing value for ${name}`);
  }
  return args[index + 1];
};

if (args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

const artifactPath = readOption("--artifact");
const privateKeyPath = readOption("--private-key");
const outPath =
  readOption("--out") || process.env.ARLE_WAILS3_UPDATE_MANIFEST_OUT || "";
if (!artifactPath || !privateKeyPath || !outPath) {
  usage();
  throw new Error("--artifact, --private-key and --out are required");
}

const version = readOption("--version") || "0.0.0-beta";
const build = readOption("--build");
const channel = readOption("--channel") || "beta";
const platform = (readOption("--platform") || "darwin").toLowerCase();
const archInput = readOption("--arch") || "universal";
const arch = archInput === "universal" ? "universal" : archInput;
const kind = (readOption("--kind") || "zip").toLowerCase();
const url =
  readOption("--url") || pathToFileURL(path.resolve(artifactPath)).href;
const notesFile = readOption("--release-notes-file");
const releaseNotes = notesFile
  ? fs.readFileSync(notesFile, "utf8").trim()
  : (readOption("--release-notes") || "").trim();
assertReleaseNotesPolicy(releaseNotes, notesFile || "--release-notes");
const mandatory = args.includes("--mandatory");
const allowPermissionUnstable =
  args.includes("--allow-permission-unstable") ||
  process.env.ARLE_WAILS3_ALLOW_PERMISSION_UNSTABLE_UPDATES === "1";
const publicKeyOut = readOption("--public-key-out");

const artifact = fs.readFileSync(artifactPath);
let macOSCodeIdentity = null;
if (platform === "darwin" && kind === "zip") {
  macOSCodeIdentity = inspectZippedAppCodeIdentity(artifactPath);
  if (
    !allowPermissionUnstable &&
    !isPermissionStableIdentity(macOSCodeIdentity)
  ) {
    throw new Error(
      [
        "macOS updater ZIP is not permission-stable.",
        `identityKind=${macOSCodeIdentity.identityKind}`,
        `permissionStability=${macOSCodeIdentity.permissionStability}`,
        `cdhashOnly=${macOSCodeIdentity.designatedRequirementIsCdhashOnly}`,
        "Sign with ARLE_WAILS3_SIGN_MODE=local-identity or developer-id before publishing an updater manifest.",
      ].join(" "),
    );
  }
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error(
    `Private key must be Ed25519, got ${privateKey.asymmetricKeyType}`,
  );
}
const signature = crypto.sign(null, artifact, privateKey).toString("base64");
const sha256 = crypto.createHash("sha256").update(artifact).digest("hex");
const publicJwk = crypto.createPublicKey(privateKey).export({ format: "jwk" });
const publicKeyRaw = Buffer.from(publicJwk.x, "base64url").toString("base64");

const manifest = {
  channel,
  version,
  ...(build ? { build } : {}),
  releaseNotes,
  mandatory,
  ...(macOSCodeIdentity
    ? {
        metadata: {
          macOSCodeIdentity: manifestSafeCodeIdentity(macOSCodeIdentity),
        },
      }
    : {}),
  artifacts: [
    {
      platform,
      arch,
      kind,
      url,
      sha256,
      signature,
      size: artifact.length,
    },
  ],
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o644,
});
if (publicKeyOut) {
  fs.mkdirSync(path.dirname(publicKeyOut), { recursive: true });
  fs.writeFileSync(publicKeyOut, `${publicKeyRaw}\n`, { mode: 0o600 });
}

console.log(
  JSON.stringify(
    {
      manifest: outPath,
      artifact: artifactPath,
      publicKey: publicKeyOut || "",
      channel,
      version,
      build,
      platform,
      arch,
      kind,
      size: artifact.length,
      sha256,
      ...(macOSCodeIdentity
        ? { macOSCodeIdentity: manifestSafeCodeIdentity(macOSCodeIdentity) }
        : {}),
    },
    null,
    2,
  ),
);
