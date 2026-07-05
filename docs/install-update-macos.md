# macOS Install And Update

Status: beta install and update guide for macOS tester builds.

There are two supported beta paths today: run from a source checkout, or install
the macOS DMG tester artifact. Current builds are not Apple Developer ID signed
and are not notarized.

## DMG Tester Path

1. Download the macOS beta DMG from the release artifacts.
2. Open the DMG.
3. Copy `Arlecchino.app` to `/Applications`.
4. Launch `/Applications/Arlecchino.app`.

macOS may block the first launch because the app is not Developer ID signed or
notarized yet.

To launch a trusted beta artifact:

1. Open **System Settings -> Privacy & Security**.
2. Find the blocked Arlecchino warning.
3. Choose **Open Anyway**.
4. Confirm the launch.

This is a user override for a trusted beta artifact. It is not notarization,
Developer ID trust, hardened runtime trust, or an Apple-approved install path.

## Source Checkout Path

For local development launches:

```bash
./scripts/bootstrap-dev-macos.sh
./scripts/wails3-dev-macos.sh
```

Bootstrap and dev scripts are task-specific setup helpers, not default
verification commands for every documentation change.

## Local Tester Signing

Owner/local-tester builds may use a local code-signing certificate through
`--sign local-identity` or `ARLE_WAILS3_SIGN_MODE=local-identity`. The default
identity name is `Arlecchino Local Code Signing`.

This mode can make macOS permission prompts more stable on the same Mac across
app replacement. It is not public trust, not Developer ID signing, and not
notarization.

Developer ID signing and notarization will be added soon, with no date
committed yet.

## Update Model

The updater trust model is:

1. Read an update manifest.
2. Check channel, version, build, and sequence.
3. Download the update asset.
4. Verify SHA256.
5. Verify Ed25519 signature.
6. Stage `Arlecchino.app`.
7. Ask the user to install and relaunch.

Current update evidence still includes private GitHub release access paths while
the repository remains private. Use that as internal/tester evidence, not as
public no-auth updater copy.

If no manifest is embedded or configured, users update manually by replacing the
app from a new DMG.

## Verification Commands

Use narrow checks when preparing a demo or release artifact:

```bash
./scripts/wails3-installed-app-smoke-macos.sh --app-bundle /Applications/Arlecchino.app --report /tmp/arlecchino-installed-smoke.json
go test -run 'Test.*AutoUpdate' ./internal/app
```

Use full release smoke only for release-candidate validation:

```bash
./scripts/wails3-release-smoke-macos.sh --report /tmp/arlecchino-release-smoke.json
```

Keep reports outside the repository unless a release process explicitly asks for
them.
