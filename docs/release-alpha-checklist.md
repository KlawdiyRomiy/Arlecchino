# Alpha Release Checklist

Status: practical release gate for the source alpha and local macOS alpha
bundle. There is still no Apple Developer ID, so this is not a trusted
notarized distribution path.

## Release Formats

- Primary path: source checkout through `git clone`, then run
  `./scripts/bootstrap-dev-macos.sh` once and `./scripts/wails-dev-macos.sh` for
  development launches.
- Convenience path: `./scripts/wails3-local-alpha-release-macos.sh` creates an
  ad-hoc signed universal `arm64+x86_64` `Arlecchino.app` for macOS Big Sur
  11.0 through Tahoe 26.x, `arlecchino-macos-universal.zip`, JSON evidence
  report, and optional `arlecchino-macos-universal.dmg` through
  `sindresorhus/create-dmg` (`create-dmg`/`npx create-dmg`).
- GitHub Releases should use split assets by platform/architecture. For macOS,
  the primary asset is `arlecchino-macos-universal.dmg`; the fallback/manual
  asset is `arlecchino-macos-universal.zip`. Version belongs to the GitHub tag
  and release metadata, not the artifact filename.
- Public product/release names must not include `v3`. Keep `wails3` only in
  internal migration script names.
- Gatekeeper rejection for ad-hoc artifacts is expected. Do not present the
  ad-hoc `.app`, ZIP, or DMG as notarized, hardened, or equivalent to an Apple
  Developer ID release.
- Intel Mac support must be checked through the release report `target.binaryArchs`
  containing `x86_64`; Apple Silicon support through `arm64`.

## Must Be Included In Release Artifacts

- `LICENSE`
- `THIRD_PARTY_NOTICES.md`
- `docs/privacy-policy.md`
- `docs/model-provenance.md`
- `docs/lsp-supply-chain.md`
- `docs/trademark-clearance.md`
- clear release notes stating that telemetry, accounts, and cloud AI providers
  are disabled by default in the current alpha.

## Manual Gates Before Public Alpha

- Confirm the gated Hugging Face terms state for
  `https://huggingface.co/datasets/bigcode/the-stack-dedup` using the
  responsible project account. If the terms were already accepted during
  training and no receipt was retained, record a current owner attestation
  instead of inventing an exact old date.
- Record the accepting account, attestation date, dataset name, training
  revision, and current access evidence in `docs/model-provenance.md`.
- Run and record a small model memorization/regurgitation check for the bundled
  ARLE model.
- Run current Go, npm, and Composer license scans and update
  `THIRD_PARTY_NOTICES.md` if any licenses changed.
- Resolve packages with missing local license metadata, including
  `codemirror-extension-inline-suggestion`.
- Review `docs/trademark-clearance.md` before broader public launch.
- Do a release dogfood pass: startup, project open, editor interaction,
  terminal command, autocomplete/ranking path, and one MCP approval flow.
- Verify in-app notifications through the neutral notification stack: save
  progress, save success/error, dispatcher result, and terminal/git errors.
  Native macOS notifications remain separate and default-off.
- Run `./scripts/wails3-release-smoke-macos.sh --report <path>` and attach the
  report to the release notes or internal release evidence.
- If the machine has been used for Wails v3 dev runs, run
  `./scripts/wails3-clean-dev-orphans-macos.sh --dry-run` first, then without
  `--dry-run` if it finds stale `/tmp/Arlecchino-wails-build/bin/Arlecchino-v3 mcp-server`
  processes.
- Run `./scripts/wails3-installed-app-smoke-macos.sh --app-bundle /Applications/Arlecchino.app --report <path>`
  after installing the DMG. This verifies the installed bundle name, codesign,
  Gatekeeper status, absence of real Arlecchino/Wails TCP listeners, process
  snapshot, MCP bridge socket presence, and stale dev-binary orphan leakage.
- Run `./scripts/wails3-window-lease-manual-smoke-macos.sh --launch --report <path>`
  and record Terminal detached PTY/focus/session behavior before enabling any
  detached helper by default.
- If using update manifests, generate them with
  `./scripts/wails3-update-manifest.mjs`; keep the Ed25519 private key outside
  the repository and publish only the manifest/artifacts/public verifier key.

## Security Gates

- MCP mutating tools must require explicit approval by default.
- Public alpha approval path should use the in-app UI prompt when the live IDE
  is available.
- `ARLECCHINO_MCP_APPROVAL_CODE` is acceptable for developer or scripted flows,
  but should not be the only public alpha approval mechanism.
- In-app direct binary downloads for LSP servers must be pinned and verified, or
  kept out of the public in-app install path until a manifest with checksums is
  added.
- For the macOS alpha, `zls`, `marksman`, and `lua-language-server` should
  install through Homebrew instead of Arlecchino-managed direct binary
  downloads.
- Auto-update install/apply remains disabled. Current updater work is limited
  to manifest read, checksum verification, detached signature verification and
  temp staging under explicit smoke flags.
