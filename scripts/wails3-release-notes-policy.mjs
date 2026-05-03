#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const rawCommitLinePattern = /^\s*(?:[-*]\s*)?[0-9a-f]{7,40}\s+[A-Z][^\n]*$/i;

export function looksLikeRawCommitDigest(notes) {
  const lines = String(notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  const rawCommitLines = lines.filter((line) =>
    rawCommitLinePattern.test(line),
  ).length;
  const hasDigestHeader = lines.some((line) =>
    /^includes changes since\b/i.test(line),
  );

  return (
    hasDigestHeader ||
    rawCommitLines >= 4 ||
    (rawCommitLines >= 2 && rawCommitLines / lines.length >= 0.45)
  );
}

export function assertReleaseNotesPolicy(notes, source = "release notes") {
  if (!String(notes ?? "").trim()) {
    return;
  }
  if (looksLikeRawCommitDigest(notes)) {
    throw new Error(
      `${source} look like a raw git commit digest. Write curated release notes with short Improved/Fixed/Changed/Security sections instead.`,
    );
  }
}

const usage = () => {
  console.log(`Usage: scripts/wails3-release-notes-policy.mjs --validate <path>

Validates that release notes are curated user-facing notes, not raw git log output.`);
};

const readOption = (args, name) => {
  const index = args.indexOf(name);
  if (index === -1) return "";
  if (index + 1 >= args.length) {
    throw new Error(`Missing value for ${name}`);
  }
  return args[index + 1];
};

const isMain = () =>
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(0);
  }

  const validatePath = readOption(args, "--validate");
  if (!validatePath) {
    usage();
    throw new Error("--validate is required");
  }

  assertReleaseNotesPolicy(fs.readFileSync(validatePath, "utf8"), validatePath);
}
