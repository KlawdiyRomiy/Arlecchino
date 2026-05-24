# Arlecchino Privacy

Status: beta privacy disclosure for tester artifacts.

This file describes the intended privacy behavior of the current macOS open
beta. It should be reviewed again before any Developer ID/notarization,
app-store, enterprise, or broader public binary release.

## Current Position

- Arlecchino does not include product analytics, advertising SDKs, or crash
  reporting SDKs by default.
- Arlecchino does not require an Arlecchino account.
- Project indexing, editor state, workspace state, terminal state, MCP audit
  logs, AI run metadata, provider settings, patch artifacts, and Mnemonic
  entries may be stored to support IDE features.
- Cloud AI providers and external agent runtimes are not enabled silently. They
  require provider configuration, user consent, runtime gates, account setup,
  or CLI setup depending on the provider.
- Provider-side logging, abuse monitoring, retention, training use, telemetry,
  and regional processing are controlled by the selected provider or external
  runtime, not by Arlecchino.

## Stored Data

Arlecchino may store data needed for normal IDE behavior:

- recently opened projects and workspace metadata;
- project indexes, symbols, dependency metadata, and command history;
- panel layout, tabs, search history, preview state, and UI preferences;
- terminal session metadata and terminal-assisted prediction context;
- project-scoped MCP audit logs, checkpoints, and agent memory;
- AI run metadata, chat run envelopes, patch artifacts, tool audit records,
  egress metadata, provider settings, and Mnemonic memory entries;
- browser/webview storage used by the desktop shell.

Project-scoped state may be written under the opened project, including
`.arlecchino/`. App-level state may be written to the operating system's normal
application data or browser/webview storage locations.

## External Network Activity

The beta can perform network activity when the user uses AI features, installs
optional language tooling, opens preview surfaces, or approves agent/runtime
actions:

- Language server setup may use package managers or download tools after a user
  action or approved agent action.
- Optional dependency or tool installation fetches packages from configured
  registries.
- AI provider integrations may send selected prompts, code snippets, editor
  context, terminal facts, Mnemonic summaries, and completion or chat requests
  to a configured provider.
- External agent runtimes, currently centered on Codex paths, may use
  provider-owned account or CLI processes. Arlecchino should not own or replay
  those provider credentials.

Arlecchino should pass sensitive prompt/context through controlled runtime
channels, not through process arguments.

## AI Provider Rules

For user-facing AI behavior:

1. Cloud and frontier providers must require explicit setup or consent.
2. The UI should show provider, model, endpoint class, and categories of data
   that may be sent before external use.
3. File edits, terminal commands, MCP calls, and subagent work should remain
   behind Arlecchino approval, patch-artifact, audit, and rollback surfaces
   where applicable.
4. Secrets, `.env` files, credentials, and sensitive paths should not be sent
   to providers.
5. API keys should be stored in the OS keychain or another secure secret store,
   not in project files, logs, prompts, or normal JSON settings.

## MCP And Agent Control

Arlecchino's built-in MCP server exposes IDE control tools for coding agents.
Mutating or externally sensitive operations require approval by default.

MCP audit logs are stored on the user's machine and are intended to help users
inspect agent actions.
Audit logs should continue to redact approval codes and direct secret content.

## Data Deletion

For beta builds, users can remove Arlecchino's stored data by deleting:

- project-scoped `.arlecchino/` directories in opened projects;
- Arlecchino app data under the operating system's standard application data
  directories;
- browser/webview storage associated with the Arlecchino app.

A complete in-app data clearing flow remains a release gate for broader public
binary distribution.

## No Sale Of Personal Data

Arlecchino is not intended to sell personal data or use personal data for
cross-context behavioral advertising.
