# AI And Provider Privacy

Status: beta AI, provider, MCP, and local-data privacy notes.

This document explains the AI-specific privacy behavior that supports
`PRIVACY.md`. It is not a provider policy and does not replace provider terms.

## Local By Default

Arlecchino does not require an Arlecchino account and does not include product
analytics, advertising SDKs, or crash reporting SDKs by default.

Project indexing, editor state, workspace metadata, terminal state, MCP audit
records, AI run metadata, patch artifacts, provider settings, and Mnemonic
entries may be stored locally to support IDE behavior.

Project-scoped state may be written under the opened project, including
`.arlecchino/`. App-level state may be written to operating-system application
data or webview storage.

## External Providers And Runtimes

Cloud AI providers and external agent runtimes are not enabled silently. They
require provider configuration, consent, runtime gates, OAuth/account setup,
API-key setup, or CLI setup depending on the provider.

Provider-side logging, retention, telemetry, abuse monitoring, training use,
and regional processing are controlled by the selected provider or runtime, not
by Arlecchino.

Arlecchino must distinguish:

- local app state;
- selected context sent to a provider;
- provider-owned account or CLI state;
- MCP bridge actions;
- external agent runtime output.

## Consent And Context

User-facing AI flows should show provider/model/runtime state and categories of
context before external use. Context preview, egress metadata, and run artifacts
exist so users can inspect what a run is using.

Do not send secrets, `.env` files, credentials, private tokens, cookies,
Keychain values, or sensitive paths to providers.

## Tool Review And Patch Artifacts

File edits, terminal commands, MCP calls, and subagent work should remain behind
approval, audit, patch-artifact, checkpoint, or rollback surfaces where
applicable.

Patch artifacts are the user-facing write boundary for AI Build flows. A patch
should be previewed before apply, and rollback/checkpoint evidence should stay
available when the patch path supports it.

## Mnemonic Memory

Mnemonic is project-scoped memory. Direct Mnemonic save, update, or delete
bindings are not the public write path; trusted changes should go through
proposal-approved review.

Demo recordings should show Mnemonic as optional project-local context, not as a
global account memory system.

## MCP Bridge

The built-in MCP bridge exposes IDE control tools for coding agents. Mutating or
externally sensitive operations require approval by default. The frontend MCP
approval dialog grants temporary access for the requested tool/risk scope.

Confirmed UI bridge actions should wait for frontend acknowledgement before
being treated as handled.

## Data Deletion

For beta builds, users can remove Arlecchino's stored data by deleting:

- project-scoped `.arlecchino/` directories in opened projects;
- Arlecchino app data under normal operating-system application data
  directories;
- browser/webview storage associated with the Arlecchino app.

A complete in-app data clearing flow remains a broader-release gate.
