#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const identityKinds = {
  adhoc: "adhoc",
  developerID: "developer-id",
  invalid: "invalid",
  localCertificate: "local-certificate",
  unsigned: "unsigned",
  unknown: "unknown",
};

export const permissionStabilities = {
  invalid: "invalid",
  localMachineStable: "local-machine-stable",
  publicStable: "public-stable",
  unstableAfterUpdate: "unstable-after-update",
};

const runCommand = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
};

export const parseCodesignDisplay = (output) => {
  const lineValues = (key) =>
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${key}=`))
      .map((line) => line.slice(key.length + 1).trim());
  const first = (key) => lineValues(key)[0] || "";
  const teamIdentifier = first("TeamIdentifier");
  return {
    codeIdentifier: first("Identifier"),
    signature: first("Signature"),
    cdHash: first("CDHash"),
    teamIdentifier:
      teamIdentifier.toLowerCase() === "not set" ? "" : teamIdentifier,
    authorities: lineValues("Authority"),
    raw: output.trim(),
  };
};

export const extractDesignatedRequirement = (output) => {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.includes("designated =>"));
  return line || output.trim();
};

export const isCDHashOnlyDesignatedRequirement = (requirement) => {
  const normalized = requirement.trim().replace(/^#\s*/, "");
  return normalized.startsWith("designated => cdhash ");
};

export const permissionStabilityForIdentityKind = (identityKind) => {
  switch (identityKind) {
    case identityKinds.developerID:
      return permissionStabilities.publicStable;
    case identityKinds.localCertificate:
      return permissionStabilities.localMachineStable;
    case identityKinds.invalid:
      return permissionStabilities.invalid;
    default:
      return permissionStabilities.unstableAfterUpdate;
  }
};

export const inferIdentityKind = ({
  verified,
  verifyOutput,
  display,
  designatedRequirement,
}) => {
  if (!verified) {
    if (
      /not signed/i.test(verifyOutput) ||
      /not signed/i.test(display.raw || "") ||
      /not signed/i.test(designatedRequirement)
    ) {
      return identityKinds.unsigned;
    }
    return identityKinds.invalid;
  }
  if (
    display.signature.toLowerCase() === "adhoc" ||
    isCDHashOnlyDesignatedRequirement(designatedRequirement)
  ) {
    return identityKinds.adhoc;
  }
  if (
    display.authorities.some((authority) =>
      authority.includes("Developer ID Application:"),
    )
  ) {
    return identityKinds.developerID;
  }
  if (display.authorities.length > 0) {
    return identityKinds.localCertificate;
  }
  return display.signature ? identityKinds.unknown : identityKinds.unsigned;
};

export const stableRequirementFingerprint = (designatedRequirement) => {
  const normalized = designatedRequirement.trim();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
};

export const isPermissionStableIdentity = (identity) =>
  !identity.designatedRequirementIsCdhashOnly &&
  Boolean(identity.stableRequirementFingerprint) &&
  (identity.identityKind === identityKinds.developerID ||
    identity.identityKind === identityKinds.localCertificate);

export const inspectAppBundleCodeIdentity = (appBundle) => {
  const verify = runCommand("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appBundle,
  ]);
  const displayResult = runCommand("/usr/bin/codesign", ["-dv", appBundle]);
  const requirementResult = runCommand("/usr/bin/codesign", [
    "-d",
    "-r-",
    appBundle,
  ]);
  const display = parseCodesignDisplay(displayResult.output);
  const designatedRequirement = extractDesignatedRequirement(
    requirementResult.output,
  );
  const identityKind = inferIdentityKind({
    verified: verify.status === 0,
    verifyOutput: verify.output,
    display,
    designatedRequirement,
  });
  const identity = {
    bundleId: readBundleIdentifier(appBundle) || display.codeIdentifier,
    codeIdentifier: display.codeIdentifier,
    signature: display.signature,
    cdHash: display.cdHash,
    teamIdentifier: display.teamIdentifier,
    authorities: display.authorities,
    identityKind,
    permissionStability: permissionStabilityForIdentityKind(identityKind),
    designatedRequirement,
    designatedRequirementIsCdhashOnly: isCDHashOnlyDesignatedRequirement(
      designatedRequirement,
    ),
    stableRequirementFingerprint: stableRequirementFingerprint(
      designatedRequirement,
    ),
    codesignVerifyPassed: verify.status === 0,
  };
  if (
    verify.status !== 0 ||
    displayResult.status !== 0 ||
    requirementResult.status !== 0
  ) {
    const reason = [
      verify.output,
      displayResult.output,
      requirementResult.output,
    ]
      .filter(Boolean)
      .join("\n");
    const error = new Error(
      `codesign identity inspection failed for ${appBundle}: ${reason}`,
    );
    error.identity = identity;
    throw error;
  }
  return identity;
};

export const inspectZippedAppCodeIdentity = (
  zipPath,
  appName = "Arlecchino.app",
) => {
  if (process.platform !== "darwin") {
    throw new Error("macOS updater ZIP code identity checks require macOS");
  }
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arlecchino-update-identity-"),
  );
  try {
    const extract = runCommand("/usr/bin/ditto", [
      "-x",
      "-k",
      zipPath,
      tempDir,
    ]);
    if (extract.status !== 0) {
      throw new Error(`could not extract updater ZIP: ${extract.output}`);
    }
    const appBundle = findAppBundle(tempDir, appName);
    if (!appBundle) {
      throw new Error(`updater ZIP does not contain ${appName}`);
    }
    return inspectAppBundleCodeIdentity(appBundle);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

export const manifestSafeCodeIdentity = (identity) => ({
  bundleId: identity.bundleId,
  codeIdentifier: identity.codeIdentifier,
  signature: identity.signature,
  cdHash: identity.cdHash,
  teamIdentifier: identity.teamIdentifier,
  authorities: identity.authorities,
  identityKind: identity.identityKind,
  permissionStability: identity.permissionStability,
  designatedRequirementIsCdhashOnly: identity.designatedRequirementIsCdhashOnly,
  stableRequirementFingerprint: identity.stableRequirementFingerprint,
});

const readBundleIdentifier = (appBundle) => {
  const infoPlist = path.join(appBundle, "Contents", "Info.plist");
  const result = runCommand("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    infoPlist,
  ]);
  return result.status === 0 ? result.stdout.trim() : "";
};

const findAppBundle = (root, appName) => {
  const direct = path.join(root, appName);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "__MACOSX") continue;
    const candidate = path.join(root, entry.name);
    if (entry.name === appName) {
      return candidate;
    }
    const nested = findAppBundle(candidate, appName);
    if (nested) return nested;
  }
  return "";
};

const invokedAsMain = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedAsMain) {
  const target = process.argv[2] || "";
  if (!target) {
    console.error(
      "Usage: scripts/macos-code-identity.mjs <Arlecchino.app|zip>",
    );
    process.exit(2);
  }
  const identity = target.endsWith(".zip")
    ? inspectZippedAppCodeIdentity(target)
    : inspectAppBundleCodeIdentity(target);
  process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
}
