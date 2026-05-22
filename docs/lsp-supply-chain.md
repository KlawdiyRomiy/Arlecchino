# Language Server And Toolchain Supply-Chain Policy

Status: beta policy and release checklist.

Arlecchino relies on language servers and developer tools installed through the
user's machine. These tools are powerful: they can parse project source, execute
postinstall scripts through package managers, and in some cases run downloaded
binaries. Treat them as trusted local development dependencies, not passive
data files.

## Current Beta Install Paths

### `scripts/wails3-dev-macos.sh`

This script does not install language servers. It builds the current Wails v3
app through the repo-local Go module, runs the frontend build, writes the dev
binary under `/tmp/Arlecchino-wails-build`, and owns cleanup for stale dev MCP
server processes. Wails itself remains on the upstream `v3.0.0-alpha.87`
dependency, but the product release track is beta.

### `scripts/bootstrap-dev-macos.sh`

This script installs the required beta toolchain and recommended extras:

- Homebrew formulae for Go, Node.js 22, legacy Wails CLI diagnostics, carapace,
  onnxruntime, gopls, TypeScript language server, and pyright;
- npm global packages for VS Code extracted language servers, YAML, Bash, and
  Dockerfile language servers;
- Go modules via `go mod download`;
- frontend dependencies via `npm ci`.

### In-App LSP Installer

`internal/lsp/installer.go` can lazily install additional language servers when
the user or an approved MCP agent asks for a specific server. It uses package
managers such as npm, Go, pip, composer, cargo, rustup, gem, and direct binary
downloads for some servers.

## Current Beta Risks

- Package manager installs rely on each ecosystem's registry, lock behavior,
  and postinstall behavior.
- Some in-app binary installs download archives without pinned versions,
  checksums, or signatures.
- Archive extraction must protect against path traversal before it is treated
  as release-ready.
- Installing language servers can add executable tools to the user's PATH or
  user-level tool directories.
- Language servers can read project files for diagnostics, completion, hover,
  and indexing.

## Release Requirements

Before public binary distribution, every language server that Arlecchino can
install should have a manifest entry containing:

- server id and display name;
- languages and file extensions;
- installer type;
- exact package name or download URL;
- pinned version or version range policy;
- source repository;
- license;
- checksum or signature verification for direct binary downloads;
- whether installation modifies PATH, shell rc files, global package stores, or
  user-level tool directories;
- uninstall guidance.

Direct binary archive extraction must verify that every extracted path remains
inside the intended destination directory.

For the beta release, keep support for all currently wired language servers,
but treat the install channel differently:

- Homebrew, npm, Go, pip, composer, cargo, rustup, and gem installs are
  acceptable for source beta because the user intentionally runs bootstrap or
  approves an in-app install and each ecosystem handles its own package
  resolution.
- The macOS beta install path uses Homebrew for the previously direct binary
  installable servers: `zls`, `marksman`, and `lua-language-server`.
- Direct binary downloads are higher risk because Arlecchino is choosing and
  unpacking executable archives itself. Before making direct binary download
  installs a public in-app path, add pinned versions plus checksum or signature
  verification. If a server cannot be pinned and verified, keep that installer
  disabled or document manual installation for the public beta.
- Lazy LSP activation should remain unchanged: opening a language file may
  start or use an installed server, but it must not silently download a new
  executable toolchain.

## User Consent Rules

- The default bootstrap may install the documented beta toolchain after the
  user runs the script intentionally.
- In-app LSP installs must be user-initiated or MCP-approved.
- MCP-triggered LSP installs must require active MCP approval.
- Public beta MCP approval should be a UI prompt unless the developer has
  explicitly configured `ARLECCHINO_MCP_APPROVAL_CODE`.
- The UI should show the install command/source before running it.
- Optional language chains should stay optional; opening a file should not
  silently install a new toolchain.

## Distribution Notes

Unsigned macOS beta bundles or DMGs are acceptable for early testers if the
release notes state that the app is not notarized and users may need to approve
it through macOS Privacy & Security using Open Anyway.

Source builds through `git clone` and `./scripts/wails3-dev-macos.sh` remain the
lowest-friction beta path, but users should run `scripts/bootstrap-dev-macos.sh`
first and understand that it installs local development tools.
