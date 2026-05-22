import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReleaseNotesPolicy,
  looksLikeRawCommitDigest,
} from "./wails3-release-notes-policy.mjs";

test("release notes policy accepts curated notes", () => {
  const notes = `Improved
- Faster update notifications while downloading packages.
- Wails updated to v3.0.0-alpha.95.

Fixed
- Update cards no longer show raw commit logs.`;

  assert.equal(looksLikeRawCommitDigest(notes), false);
  assert.doesNotThrow(() => assertReleaseNotesPolicy(notes));
});

test("release notes policy rejects raw commit digests", () => {
  const notes = `Includes changes since v0.1.3-alpha.103:

4032b7f Add grouped auto-import edits
2629e24 Add autocomplete language resolver
a21fc1d Route autocomplete sources through resolver
654a39e Expose autocomplete language capabilities`;

  assert.equal(looksLikeRawCommitDigest(notes), true);
  assert.throws(
    () => assertReleaseNotesPolicy(notes, "fixture"),
    /raw git commit digest/,
  );
});

test("release notes policy allows empty notes for fallback UX", () => {
  assert.equal(looksLikeRawCommitDigest(""), false);
  assert.doesNotThrow(() => assertReleaseNotesPolicy(""));
});
