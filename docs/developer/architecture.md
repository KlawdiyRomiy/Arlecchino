# Developer Architecture

Status: developer-facing architecture map for the current Arlecchino beta.

Arlecchino is a desktop IDE with a Go/Wails backend, a React/TypeScript
frontend, and project-scoped runtime services for editor, terminal, indexing,
MCP, AI, and packaged macOS behavior.

## Runtime Shape

- `internal/app` owns the Wails app service, project sessions, bindings,
  packaged app integration, open intents, updater runtime, shell menu, native
  macOS bridges, and MCP bridge entrypoints.
- `frontend/src` owns the React shell, panels, editor, terminal UI, AI Chat,
  settings, notifications, preview surfaces, and runtime event handling.
- `internal/indexer` owns the project index, symbol/dependency storage,
  adapters, completion data, and LSP manager integration.
- `internal/terminal` owns PTY sessions, command parsing, command prediction,
  shell history import, semantic events, and agent guide/state reporting.
- `internal/mcp` owns the stdio MCP server, bridge tools, approval settings,
  audit/flight records, skill/memory tools, and layout profiles.
- `internal/ai` owns provider discovery, provider settings, consent and
  approval policy, chat runs, run envelopes, context preview, tool gateway,
  patch artifacts, Mnemonic, external agent runtimes, and background-agent
  previews.

## Project Sessions

The app can manage project-scoped sessions rather than treating the whole app as
one global project. Project session state binds frontend windows, current
project roots, AI sessions, LSP/indexer runtime, workspace state, and open
intent routing.

Demo and docs should describe multi-project behavior as beta behavior and avoid
overstating native multi-window production readiness.

## Frontend Surfaces

The frontend presents project work through a surface runtime:

- main center;
- floating panel;
- snapped panel;
- fullscreen panel;
- detached-capable host.

Core applets include Explorer, Terminal, AI Chat, Git, Problems, Code, Markdown
Preview, and preview windows. The shell is designed for dense IDE work, not a
landing-page experience.

## Editor And Indexer

Editor intelligence combines:

- CodeMirror 6 editor state;
- language-server diagnostics, hover, signature help, definition, completion,
  and code action paths;
- project index symbols and dependency metadata;
- deterministic completion sources;
- local autocomplete ranking;
- optional AI-assisted passive prediction when enabled and provider-ready.

Important limits:

- the scanner respects ignore rules and skips heavy service directories;
- LSP coverage depends on installed servers and language capability;
- workspace edits are constrained and should not be marketed as universal
  refactoring support;
- search may still be a linear fallback, depending on runtime status.

## Terminal

Terminal behavior is PTY-backed. The runtime emits terminal data, shell, mode,
semantic, and exit events. Command prediction can combine terminal history,
project context, carapace completion, and local command usage.

Docs should describe this as terminal assistance, not as a managed CI/job
orchestration system.

## MCP

Arlecchino includes two MCP paths:

- `mcp-server` for stdio tool access;
- live IDE bridge calls that can interact with backend state or frontend UI.

Mutating, bridge-control, external-side-effect, and sensitive operations require
approval by default. Frontend-bound UI actions may require acknowledgement before
the tool can claim the UI handled the request.

## AI Runtime

AI Chat supports the visible actions:

- Chat;
- Plan;
- Debug;
- Build;
- Review.

Each action has a different tool and approval boundary. Build can produce patch
artifacts and approval-gated tool calls. Review is read-only. Debug can use
diagnostic context and approval-gated terminal checks. Plan is read-only.

External agent runtimes, currently including Codex-oriented paths, must keep
provider credentials with the provider/runtime and expose evidence through run
artifacts rather than unverified assistant prose.

## Packaged macOS Runtime

Packaged macOS behavior includes open intents, menu integration, native bridge
work, build identity, optional update manifests, and smoke scripts.

Current beta builds are not Developer ID signed or notarized yet. Developer ID
signing and notarization will be added soon, with no date committed. Local
identity signing can be used by owner/local testers for same-machine permission
stability, but it is not public trust.

## Documentation Boundaries

Public docs should link to:

- root `README.md`;
- root `FEATURES.md`;
- `docs/features-and-demos.md`;
- `docs/demo-video-scenarios.md`;
- `docs/open-beta.md`;
- `docs/install-update-macos.md`;
- root `PRIVACY.md`;
- `docs/privacy-ai.md`;
- root `MODEL_PROVENANCE.md`;
- current release notes.

Internal planning docs, private updater evidence, release prep notes, and
machine-local smoke reports should stay out of public navigation until the
runtime behavior and release contract are verified.
