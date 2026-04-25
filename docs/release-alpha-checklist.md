# Alpha Release Checklist

Status: practical release gate for the source alpha and unsigned macOS
convenience bundle.

## Release Formats

- Primary path: source checkout through `git clone`, then run
  `./scripts/bootstrap-dev-macos.sh` once and `./scripts/wails-dev-macos.sh` for
  development launches.
- Convenience path: unsigned DMG or app bundle for testers who accept macOS
  Gatekeeper warnings and approve the app through Privacy & Security / Open
  Anyway.
- Do not present the unsigned DMG as notarized, hardened, or equivalent to an
  Apple Developer ID release.

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
