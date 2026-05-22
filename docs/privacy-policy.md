# Arlecchino Privacy Policy

Status: beta policy draft for source builds and local tester bundles.

This document describes the privacy behavior Arlecchino is intended to follow.
It should be reviewed before any public binary release, app store release, or
new provider/runtime integration.

## Current Beta Position

- Arlecchino does not include product analytics, advertising SDKs, or crash
  reporting SDKs.
- Arlecchino does not require an account.
- Arlecchino includes an AI Chat surface, optional editor AI predictions,
  provider/model selection, context preview, consent gates, approval-gated tool
  review, patch artifacts, local egress records, Mnemonic memory, and a
  Codex-backed external agent runtime path.
- Cloud AI providers and external agent runtimes are not enabled silently. They
  require explicit provider configuration, consent, runtime gating, or
  account/CLI setup depending on the provider.
- Project indexing, editor state, terminal state, and MCP audit data are local
  to the user's machine unless the user explicitly enables a feature that talks
  to an external service.

## Local Data Arlecchino May Store

Arlecchino may store local data needed to behave like an IDE:

- recently opened projects and workspace metadata;
- project indexes, symbols, dependency metadata, and command history;
- panel layout, tabs, search history, preview state, and UI preferences;
- terminal session metadata and terminal-assisted prediction context;
- project-local MCP audit logs, checkpoints, and agent memory;
- AI run metadata, AI chat history/envelopes, patch artifacts, tool audit
  records, run timelines, egress metadata, provider settings, and Mnemonic
  entries;
- browser webview storage used by the desktop shell.

Project-local state may be written under the opened project, including
`.arlecchino/`. App-level state may be written to the operating system's
standard application data or browser/webview storage locations.

## External Network Activity

The current source beta can perform network activity for development and IDE
features:

- `scripts/bootstrap-dev-macos.sh` uses Homebrew, Go modules, npm, and npm
  global installs to install development dependencies and recommended language
  tooling.
- `go mod download` and `npm ci` fetch dependencies from their configured
  registries.
- Language server installation flows may run package managers or download
  language server binaries after a user action or an agent action with MCP
  approval.
- Documentation enrichment code contains clients for Context7 and GitHub code
  search. These flows must remain opt-in before release if they send package,
  symbol, version, or repository context to external services.
- AI provider integrations may send selected editor context, prompts, code
  snippets, terminal facts, Mnemonic summaries, and completion or chat requests
  to a configured provider. These integrations are gated by provider setup,
  consent, and runtime policy. Provider-side logging, abuse monitoring,
  retention, training use, telemetry, and regional processing are controlled by
  that provider's terms and data processing documentation, not by Arlecchino.
- External agent CLI runtimes, currently centered on Codex, may use the
  provider-owned account/CLI process. Arlecchino should pass prompt/context
  through safe runtime channels, not through process arguments, and should keep
  provider credentials owned by the provider runtime.

## AI Provider Rules

When enabling or using any external AI provider in a user-facing release:

1. Keep cloud AI disabled by default.
2. Show the provider name, endpoint, model, and categories of data that may be
   sent before enabling it.
3. Require explicit opt-in per provider.
4. Provide a way to disable the provider and clear local AI-related state.
5. Do not send secrets, `.env` files, credentials, or sensitive paths.
6. Document provider retention and data-use behavior with links to the
   provider's current terms or data processing documentation.
7. Keep API keys in the OS keychain or another secure local secret store, not
   in project files, logs, or prompts.
8. Do not describe provider telemetry as Arlecchino telemetry. The UI and docs
   must distinguish local app telemetry from provider-side processing.
9. Keep file edits, terminal commands, MCP calls, and subagent work behind
   Arlecchino's approval, patch-artifact, audit, and rollback surfaces where
   applicable.

## MCP And Agent Control

Arlecchino's built-in MCP server exposes IDE control tools for coding agents.
MCP approvals are required by default for mutating or externally sensitive
operations. If no `ARLECCHINO_MCP_APPROVAL_CODE` is configured, the live app
must show an explicit approval prompt before granting a temporary MCP control
session. Users may disable the general gate for local development by setting
`ARLECCHINO_MCP_REQUIRE_APPROVAL=false`; sensitive and boundary-crossing actions
must still keep an approval path.

MCP audit logs are local and are intended to help users inspect agent actions.
Audit logs must continue to redact approval codes and direct file content.

## Data Deletion

For local beta builds, users can remove Arlecchino's stored data by deleting:

- project-local `.arlecchino/` directories in opened projects;
- Arlecchino app data under the operating system's standard application data
  directories;
- browser/webview local storage associated with the Arlecchino app.

Arlecchino has backend support for clearing project-scoped AI state, but the
release gate remains a comprehensive in-app data clearing flow for project
indexes, MCP logs, chat/provider state, Mnemonic state, and local webview
storage.

## No Sale Of Personal Data

Arlecchino is not intended to sell personal data or use personal data for
cross-context behavioral advertising.

## Release Gate

Before public distribution, update this policy to match the shipped behavior,
including any telemetry, update checks, cloud AI, external agent runtimes,
documentation enrichment, crash reporting, or marketplace integrations.
