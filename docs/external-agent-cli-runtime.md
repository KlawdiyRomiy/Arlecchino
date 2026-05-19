# External Agent Runtime Layer

Status: planning reference.
Date: 2026-05-19.

This document defines the implementation contract for external coding-agent
runtimes inside Arlecchino AI Chat. It supersedes the earlier "GUI over TUI as
primary runtime" wording.

The target is not a terminal window in the chat panel. The target is an
OpenCode-like agent experience inside the existing AI Chat panel, backed by
structured agent transports whenever they exist. PTY/TUI remains available for
login, trust prompts, compatibility fallback, and raw evidence, but it is not
the primary protocol for normal chat turns.

## Decision

Arlecchino may integrate an official or provider-sanctioned external coding
agent when all of the following are true:

- the user installs, enables, or launches an explicitly documented
  first-party/partner runtime;
- authentication is completed by the user through the runtime's own supported
  login flow;
- Arlecchino does not read, copy, transform, export, or replay tokens from the
  runtime credential store;
- provider billing, quota, model availability, retention, and abuse monitoring
  remain governed by that provider's terms;
- all project context sent to the runtime is visible through Arlecchino's
  context, consent, egress, approval, artifact, and audit surfaces;
- normal agent turns use structured transports before PTY/TUI rendering.

For Codex, the preferred production integration is the official structured
surface: `codex app-server` for rich clients, or `codex exec --json` for
bounded non-interactive tasks. Launching the interactive `codex` TUI through a
PTY is a fallback, not the main runtime path.

This is different from adding a generic OpenAI API provider. OpenAI Platform
API/BYOK remains a valid model-provider route. ChatGPT-managed Codex account
access should be used only through official Codex surfaces, not by copying
private ChatGPT backend endpoints from third-party experiments.

## Core Rule

Do not create a parallel agent stack.

The external runtime layer must sit under the current AI Chat contract:

`AIChatRunRequest -> AIContextSnapshot -> AIEgressRecord -> AIChatRunEnvelope -> artifacts -> review/apply/audit`

The sources of truth remain:

- `AIChatRunEnvelope` and AI Chat run state;
- context composer and context disclosure;
- consent and egress ledger;
- approval policy and tool approval UX;
- patch artifacts and review/apply/rollback;
- Mnemonic rules;
- MCP metadata policy;
- run timeline and audit events.

If the current contract cannot express an external-agent case, extend the
contract minimally and compatibly. Do not bypass it with a separate history,
terminal runtime, approval model, patch path, memory path, or provider store.

## Corrected Strategy

The product strategy is provider-neutral GUI over external agent runtime, not
GUI over a raw terminal.

The earlier phrase "GUI over TUI" is useful only as a compatibility metaphor:
Arlecchino may mirror a terminal agent when that is the only supported surface.
But the primary implementation must prefer a structured protocol with stable
messages, streamed events, approvals, diffs, and lifecycle state.

Transport priority:

1. `structured_app_server`: long-lived local agent server or SDK protocol.
2. `structured_jsonl_exec`: non-interactive JSONL/event stream.
3. `provider_model_api`: direct model/provider API for providers that are not
   external agent processes.
4. `pty_interactive_fallback`: raw TUI for login, trust prompts, unsupported
   approvals, and last-resort compatibility.

A selected external agent runtime must handle every Arlecchino mode through the
same run lifecycle. Do not special-case `Ask` into a canned local response or
silently reroute it away from the selected agent just because the prompt is
simple.

What changes per mode is the task profile, not the runtime identity:

- `Ask`: same selected runtime, read-only task profile, minimal context by
  default, no write approvals, no patch requirement unless the agent attempts a
  file change.
- `Plan`: same selected runtime, planning profile, read-only repository access,
  plan/risk artifacts, no file writes.
- `Build`: same selected runtime, workspace-write profile after consent and
  approvals, baseline and captured diff artifacts required.
- `Debug`: same selected runtime, diagnostic profile, command/test evidence,
  write access only if explicitly allowed by the mode policy.
- `Review`: same selected runtime, diff/repository review profile, findings and
  optional patch artifacts.

A simple `Ask` such as "Привет" should therefore still be a real runtime call
when an external agent provider is selected. It should be fast because the
runtime uses a warm structured session with a read-only/minimal profile, not
because Arlecchino fakes the answer or falls back to templates.

## OpenCode Lessons

OpenCode Desktop is not a proof that an app should parse a terminal TUI as its
main protocol. Its desktop app launches a local sidecar/server and renders
structured session state: messages, parts, diffs, permissions, questions,
status, and model/provider choices. The terminal panel in OpenCode is a
separate terminal surface, not the core session renderer.

The key transferable lessons are:

- keep the GUI session model independent from the raw terminal;
- maintain a provider/plugin layer with auth, model metadata, request lowering,
  response parsing, permissions, and diffs;
- render permissions and questions as GUI controls when structured events exist;
- keep a terminal available, but do not make terminal scraping the normal API.

The `numman-ali/opencode-openai-codex-auth` plugin worked before official
OpenCode support because it did not simulate the Codex TUI. It implemented an
OpenCode provider/auth bridge: OAuth login, ChatGPT account metadata, request
transformation, Codex backend routing, SSE parsing, prompt-cache forwarding,
and a bridge prompt that maps Codex expectations to OpenCode tools.

That architecture explains why it avoided Codex TUI startup prompts, MCP
startup noise, update prompts, and PTY race conditions. It is a useful
engineering reference, but it is not a legal production target for Arlecchino:
the plugin itself frames the ChatGPT subscription path as personal development
use and points production or multi-user applications to the OpenAI Platform API.
Arlecchino must not copy private ChatGPT backend routing as its production
integration without explicit provider support.

## Official Evidence

- Codex App Server is documented as the interface for embedding Codex into rich
  clients. It exposes authentication, conversation history, approvals, and
  streamed agent events over JSON-RPC/JSONL or local WebSocket transports:
  https://developers.openai.com/codex/app-server
- Codex non-interactive mode supports `codex exec`, including machine-readable
  event streams through `--json`:
  https://developers.openai.com/codex/noninteractive
- Local CLI help in this environment confirms `codex app-server`,
  `codex remote-control`, `codex exec --json`, `codex exec-server`, and
  `codex mcp-server` are present in `codex-cli 0.130.0`.
- OpenCode Desktop uses a sidecar/server and structured session UI; OpenCode's
  public repo documents desktop app availability and built-in `build`/`plan`
  agents:
  https://github.com/anomalyco/opencode
- `opencode-openai-codex-auth` documents a personal-use ChatGPT OAuth bridge
  and explicitly says production or multi-user applications should use OpenAI
  Platform API:
  https://github.com/numman-ali/opencode-openai-codex-auth

This evidence does not create blanket legal approval for every integration. It
classifies safe routes:

- first-party or provider-sanctioned structured runtimes are acceptable;
- official CLI login and app-server/exec protocols are acceptable;
- private token reuse, web automation, copied credential stores, and hidden
  backend replay are not acceptable.

## Hard Deny

Do not implement these routes:

- Reading `~/.codex/auth.json`, OpenCode auth storage, GitHub/Cursor/Gemini
  token files, browser cookies, keychain items, or any other provider
  credential to replay requests from Arlecchino.
- ChatGPT, Claude, Gemini, Cursor, Copilot, or other web UI automation to
  simulate API calls.
- Copying unofficial private ChatGPT backend endpoint flows into Arlecchino
  production.
- Monkey-patching provider packages to expose hidden subscription endpoints.
- Shipping bundled credentials, shared OAuth client secrets, copied device
  codes, or undocumented provider tokens.
- Auto-answering CLI approvals, update prompts, trust prompts, or login prompts.
- Treating terminal transcript text as a successful tool/edit result.
- Writing Mnemonic facts from raw external-agent terminal output without
  reviewed, redacted, trusted extraction.
- Offering Claude consumer-subscription routes through unofficial plugins;
  Claude Code should use supported API/account routes only.

## Runtime Families

Arlecchino exposes runtime families under one AI Chat surface.

### `external_agent_runtime`

A provider-owned or local coding agent with process/session lifecycle,
structured events where available, optional PTY fallback, approvals, tools, and
file-change artifacts.

Examples: Codex App Server, Codex `exec --json`, OpenCode server/CLI, Gemini
CLI if a stable machine protocol exists, Cursor Agent if supported.

### `model_api_runtime`

A direct model provider or OpenAI-compatible endpoint. It still uses the same
AI Chat modes and artifact contracts, but it does not own an external agent
process.

Examples: Ollama, LM Studio, llama.cpp, Hugging Face TGI, OpenAI-compatible
endpoints, OpenAI Platform BYOK, enterprise gateways.

These runtime families are peers. The selected provider determines transport;
the selected mode determines task policy. No mode may silently fake success.

## Descriptor Model

Add or evolve descriptors toward this shape:

```go
type ExternalAgentRuntimeDescriptor struct {
    ID             string
    Name           string
    RuntimeFamily  string // external_agent_runtime
    Binary         string
    EndpointClass  string // local_process, local_jsonl, local_ws, local_unix, remote_ws
    Transport      string // app_server, jsonl_exec, pty_fallback, sdk, model_api
    AuthMode       string // cli_managed, api_key, oauth_via_cli, account_via_cli
    AuthStatus     string // unknown, missing, logged_in, needs_login, error
    BillingMode    string // subscription, provider_account, api_key, local, unknown
    LegalBasis     string // first_party_cli, formal_partner, provider_docs, local
    Capabilities   []ExternalAgentCapability
    SupportedModes []ExternalAgentMode
    RiskTier       string
    SourceLinks    []string
}
```

Core capabilities:

- structured streamed events;
- persistent conversation/thread;
- non-interactive JSONL task run;
- PTY/TUI fallback;
- model selection;
- reasoning effort selection;
- thinking/activity summaries;
- tool call and command approvals;
- patch/diff preview;
- local shell execution;
- MCP;
- resume/fork;
- subagents;
- review mode;
- image input;
- web search;
- cloud handoff.

## Transport Contracts

### App Server Transport

Use for rich GUI integration when available.

Requirements:

- long-lived process/session keyed by project and provider;
- JSON-RPC request/response correlation;
- notifications mapped into run timeline events;
- structured approvals/questions mapped into existing approval cards;
- thread/turn IDs stored in `AIExternalAgentRunSummary` or compatible metadata;
- process health, restart, overload, and cancellation handling;
- no raw auth tokens in argv, logs, artifacts, or envelopes.

For Codex this maps to `codex app-server` using stdio JSONL first. WebSocket may
be added later only with local binding and explicit auth, because OpenAI marks
WebSocket transport experimental/unsupported.

### JSONL Exec Transport

Use for bounded task runs and early implementation.

Requirements:

- pass the prompt through stdin or safe process input, not argv when it may
  contain project context;
- use `--json` or equivalent structured event mode;
- parse events into text, activity, tool, command, file-change, MCP, plan,
  error, and usage artifacts;
- support cancel by process group termination;
- preserve final message and bounded transcript artifacts;
- support `resume` when the runtime exposes it.

For Codex this maps to `codex exec --json` with `--sandbox read-only` for
`Ask`/`Plan`, `--sandbox workspace-write` only when the mode policy allows
writes, and `--ignore-user-config`/`--ignore-rules` only for explicitly
controlled automation profiles.

### PTY Interactive Fallback

Use only when structured transport cannot express the current interaction:

- official login/auth flows;
- project trust prompts;
- TUI-only approvals;
- update prompts;
- degraded compatibility mode;
- raw evidence/debugging.

Rules:

- never treat TUI parsing as authoritative state when structured events exist;
- never send prompt/context through argv;
- never auto-answer prompts;
- surface TUI prompts as blocking GUI cards where safely identifiable;
- keep transcript bounded and redacted;
- deduplicate noisy startup notices and move them to preflight/settings unless
  they block the run.

## AI Chat UX

All UX stays inside the AI Chat panel. Do not use TerminalPanel,
`useTerminalStore`, `tuiModeActive`, or `terminal:*` events for the agent run
surface.

The AI Chat panel should contain:

- provider/runtime picker;
- mode segmented control: `Ask`, `Plan`, `Build`, `Debug`, `Review`;
- model picker;
- reasoning selector when supported;
- context disclosure;
- consent state;
- run timeline;
- activity/thinking summaries;
- approval/question cards;
- diff/artifact review;
- optional raw transcript/terminal drawer for fallback evidence;
- composer with attachments and `@` context.

The first screen should be the usable chat/agent surface, not a separate
terminal emulator.

## Mode Contracts

Every mode uses the same selected provider/runtime and the same envelope path.
Mode differences are declarative runtime policy.

### Ask

- Purpose: answer, explain, inspect lightly, clarify.
- Context: minimal by default; explicit mentions preserved.
- Permissions: read-only; no shell/write approvals by default.
- Artifacts: response, safe citations, optional inspected-context summary.
- Success: real provider/agent response or explicit blocked/unavailable state.
- Forbidden: local template answer pretending to be an agent response.

### Plan

- Purpose: produce a plan, risks, sequencing, assumptions.
- Context: repository/context access allowed by disclosure.
- Permissions: read-only; commands only if the provider supports safe read-only
  tool execution and policy allows it.
- Artifacts: plan artifact, risk list, context/egress record.
- Success: structured plan or explicit blocker.

### Build

- Purpose: implement changes.
- Context: repository and relevant files after disclosure.
- Permissions: workspace-write only after consent and approval policy.
- Artifacts: patch proposal or captured direct diff; baseline required.
- Success: accepted patch artifact, captured dirty diff, explicit no-change
  result, or blocked/error with evidence.

### Debug

- Purpose: reproduce, inspect failures, isolate root cause.
- Context: diagnostics, logs, test output, relevant files.
- Permissions: read-only by default; test commands may be approval-gated.
- Artifacts: diagnostic finding, command/test evidence, optional patch if the
  user allows a fix.
- Success: root-cause finding, reproduction evidence, or blocked state.

### Review

- Purpose: review diffs/code, identify issues, suggest fixes.
- Context: git diff, changed files, requested scope.
- Permissions: read-only by default.
- Artifacts: findings ordered by severity, optional patch suggestions.
- Success: review findings or explicit no-findings result.

## Runtime Notices

Runtime notices must not dominate normal chat turns.

Classify notices as:

- `blocking`: login required, trust prompt, approval prompt, unsupported
  transport, failed required MCP server;
- `preflight`: MCP account missing, optional MCP unavailable, update available,
  model migration suggestion;
- `diagnostic`: raw stderr/status text useful for troubleshooting.

Rules:

- blocking notices get GUI cards in the run;
- preflight notices live in provider settings/preflight and are deduplicated;
- diagnostic notices are hidden by default behind an inspector;
- non-blocking MCP startup warnings must not appear on every `Ask` turn;
- update prompts must never be auto-accepted during a run.

The 14-second `Привет` failure mode came from using interactive TUI startup as
the normal request path. A structured warm session or JSONL exec path must not
pay that terminal startup/MCP/update/trust overhead for simple read-only turns.

## Build Mode Edit Problem

A better runtime surface does not by itself fix Build mode.

The accepted path remains:

`provider/runtime -> run events -> tool/proposal or diff capture -> validation -> patch artifact -> review/apply/audit`

Rules:

- Build is not successful unless it produces a reviewed patch artifact,
  captured direct diff, explicit no-change result, or diagnostic/test finding;
- chat prose or terminal transcript alone is not an edit result;
- direct external-agent writes must be captured from a clean baseline;
- dirty-baseline conflicts must block auto-accept and require manual review;
- unsafe paths, secrets, broad rewrites, and stale anchors go through existing
  patch validation and hard-deny rules;
- if a runtime cannot expose structured file-change events, use git diff
  capture as the compatibility bridge;
- if a runtime cannot produce diff/reviewable evidence, Build mode reports
  unavailable/error.

## Safety And Egress

External agents are `local_process_external_account` or equivalent unless the
adapter proves a narrower endpoint class.

Before sending context:

- identify provider, runtime, model, endpoint class, and capability;
- build context summary and data categories;
- apply redaction and protected-resource policy;
- require provider/runtime consent;
- record egress status;
- disclose mode-specific permissions.

Never send:

- provider credentials;
- auth storage;
- keychain/cookie data;
- `.env` files;
- token files;
- secret-like terminal output;
- raw MCP output by default;
- unreviewed Mnemonic private state.

Mnemonic writes from external-agent runs require reviewed, redacted, trusted
facts. Raw transcript text is not a memory source.

## Runtime Architecture

Backend package target:

- `internal/ai/agents` for registry and adapter contracts;
- `internal/ai/agents/codex` for Codex app-server, exec JSONL, and PTY fallback;
- future adapters for OpenCode, Gemini, Cursor, Copilot, GitLab, and Qwen only
  after a structured or provider-sanctioned transport is identified.

Adapter interface shape:

```go
type ExternalAgentRuntime interface {
    Descriptor(ctx context.Context) ExternalAgentRuntimeDescriptor
    AuthStatus(ctx context.Context) ExternalAgentAuthStatus
    Preflight(ctx context.Context, req ExternalAgentPreflightRequest) ExternalAgentPreflight
    StartSession(ctx context.Context, req ExternalAgentSessionRequest, sink ExternalAgentEventSink) (*ExternalAgentSession, error)
    RunTurn(ctx context.Context, req ExternalAgentTurnRequest, sink ExternalAgentEventSink) (*ExternalAgentResult, error)
    Resume(ctx context.Context, req ExternalAgentResumeRequest, sink ExternalAgentEventSink) (*ExternalAgentSession, error)
    Cancel(ctx context.Context, sessionID string) error
}
```

Process rules:

- launch in the selected project root with explicit cwd;
- sanitize environment inheritance;
- never pass prompt/context or secrets through argv;
- capture stdout/stderr/transcript with size limits;
- kill the process group on cancel;
- record exit status, signal, duration, transport, version, and safe error
  class;
- separate auth/login operations from normal turns;
- cache descriptors briefly but invalidate after auth/config changes.

## Provider Matrix

Recommended order:

1. `codex-app-server`
   - Legal basis: first-party OpenAI Codex interface for rich clients.
   - Auth: Codex-managed ChatGPT account or API key flow.
   - Transport: stdio JSONL JSON-RPC first; local WebSocket later only with
     explicit auth and rollout guardrails.
   - Priority: P0.

2. `codex-exec-jsonl`
   - Legal basis: first-party Codex non-interactive mode.
   - Auth: Codex-managed auth; API key in automation only through supported
     environment variables and secure storage.
   - Transport: `codex exec --json`.
   - Priority: P0 fallback/bridge while app-server integration matures.

3. `codex-pty-fallback`
   - Legal basis: first-party CLI.
   - Auth: official `codex login` and TUI prompts.
   - Transport: PTY only for auth/trust/TUI-only interactions.
   - Priority: support path, not normal mode path.

4. `opencode-runtime`
   - Legal basis: open-source coding agent and desktop app.
   - Transport: prefer documented server/SDK/provider surfaces; PTY only if no
     stable structured interface is available.
   - Special rule: do not read OpenCode credential storage.
   - Priority: P1.

5. Additional CLIs
   - Gemini CLI, Cursor Agent, Copilot/GitHub routes, GitLab Duo via documented
     providers, and Qwen Code can be added only with descriptor metadata,
     legal/source links, auth mode, billing mode, and hard-deny rules.
   - Priority: P2/P3.

Existing model runtimes remain first-class peers:

- Ollama;
- LM Studio;
- llama.cpp;
- Hugging Face TGI;
- local or remote OpenAI-compatible endpoints;
- OpenAI Platform/BYOK and enterprise gateways when implemented.

## Implementation Phases

### Phase 1: Correct Runtime Contract

- Rename conceptual runtime from `external_agent_cli` to
  `external_agent_runtime` while keeping backward-compatible DTO values where
  needed.
- Add transport kind: `app_server`, `jsonl_exec`, `pty_fallback`, `model_api`.
- Keep `AIChatRunEnvelope` as the UI source of truth.
- Ensure `Ask`/`Plan`/`Build`/`Debug`/`Review` all route through the selected
  provider/runtime, with mode-specific task profiles.
- Remove any template/local shortcut that can answer as if a provider ran.

### Phase 2: Codex Structured Runtime

- Detect `codex` version and supported commands.
- Start `codex app-server` over stdio JSONL.
- Implement initialize/thread/turn lifecycle mapping.
- Map streamed notifications into AI Chat tokens, activity events, approvals,
  artifacts, and run timeline.
- Add process lifecycle, cancellation, restart, and health handling.
- Keep PTY login flow separate from normal turns.

### Phase 3: JSONL Exec Bridge

- Implement `codex exec --json` adapter for bounded tasks.
- Parse `thread.*`, `turn.*`, `item.*`, `error`, usage, command execution, MCP,
  file-change, reasoning summary, plan update, and agent message events.
- Use stdin for prompt/context.
- Select sandbox by mode policy.
- Capture final message and diff artifacts.

### Phase 4: AI Chat UI

- Keep all UX in AI Chat.
- Replace the terminal-first Agent Console with structured activity cards.
- Add optional raw transcript drawer, not a primary terminal panel.
- Add runtime preflight/status area for non-blocking notices.
- Add login/trust/approval cards only when blocking.
- Preserve existing composer, mode controls, provider picker, context UI, and
  artifact review path.

### Phase 5: OpenCode And Other Adapters

- Study and use documented OpenCode local/server/provider APIs before PTY.
- Add OpenCode runtime only when the adapter can map sessions, messages,
  permissions, and diffs into Arlecchino envelopes.
- Add additional CLIs only after source/legal/auth/capability metadata is clear.

## Verification Gates

Backend:

- descriptor validation includes transport kind, endpoint class, auth mode, and
  legal basis;
- consent-required path blocks before context egress;
- no prompt/context is passed through argv;
- structured Codex app-server or exec JSONL events map into
  `AIChatRunEnvelope`;
- cancellation kills the process/session and prevents stale completion;
- PTY fallback is unavailable for normal turns unless explicitly selected or
  required by auth/trust/TUI-only interaction;
- non-blocking notices are deduplicated and not emitted as run-blocking chat
  cards;
- Build requires patch artifact, captured direct diff, explicit no-change
  result, or diagnostic/test finding.

Frontend:

- all runtime UX stays inside AI Chat;
- no dependency on `TerminalPanel`, `useTerminalStore`, `tuiModeActive`, or
  `terminal:*` events for agent turns;
- `Ask` with selected external agent produces a real run envelope, not a local
  canned response;
- simple read-only `Ask` does not show recurring MCP/runtime notices;
- login/trust/approval prompts render as blocking cards;
- raw transcript is optional evidence, not the primary UI;
- captured diffs use existing review/accept/rollback controls.

Integration:

- run Codex in a disposable project through structured transport;
- prove `mode -> transport -> events -> envelope -> artifact -> validation -> review/rollback -> audit`;
- compare a trivial `Ask` against current PTY behavior and verify it no longer
  pays interactive TUI startup cost;
- verify no unofficial ChatGPT backend replay is used.
