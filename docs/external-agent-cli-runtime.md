# Universal Agent Runtime Layer

Status: execution guide and implementation reference.
Date: 2026-05-19.

This document is an execution guide for turning the current Arlecchino AI runtime
into a provider-neutral runtime layer for AI Chat. It supersedes the earlier
"external agent CLI" and "GUI over TUI" framing.

The goal is not to run a provider's TUI session and type prompts into it from
Arlecchino. The goal is an Arlecchino-native GUI client over structured agent
and model runtimes. Codex is the only registered structured external agent
target for now because its current official surfaces fit this architecture well,
but Codex is not the architecture.
Model and reasoning selection are provider-neutral runtime inputs. Codex may be
the first tested adapter, but no UI or backend contract may assume that
`Codex == agent runtime`.

The runtime layer must cover:

- structured external coding agents such as Codex app-server;
- bounded JSONL/non-interactive agents such as Codex `exec --json`;
- noTUI model providers such as Ollama, LM Studio, llama.cpp, Hugging Face TGI,
  and OpenAI-compatible endpoints where Arlecchino owns the agent loop;
- PTY/TUI fallback only for login, trust prompts, unsupported approvals,
  degraded compatibility, and raw evidence.

All of these must share the same Arlecchino context, tools, memory, skills,
approval, patch, audit, and UI envelope surfaces.

## How To Use This Guide

Read and execute this document from top to bottom.

1. Follow the `Implementation Contract`.
2. Use the `File Ownership Map` before editing.
3. Execute phases in `Execution Order`.
4. For each phase, use its task card: inspect first, implement only the listed
   scope, run the listed checks, and stop on its stop conditions.
5. Use architecture/reference sections only to clarify decisions, not as a
   substitute for the phase task cards.

This document is not a prompt for a coding agent and not a loose roadmap. Treat
it as the implementation instruction for the runtime refactor.

## Implementation Contract

Mode:

- Refactor the current Arlecchino AI runtime into an `Agent Runtime Kernel`.
- Do not add a second runtime stack, second chat history, second approval system,
  second memory store, or terminal-only agent stack.

Primary invariant:

`AIChatRunRequest -> AIContextSnapshot -> consent/egress -> runtime turn -> normalized events -> AIChatRunEnvelope -> artifacts -> review/apply/audit`

Keep:

- `AIChatRunRequest` as the request entrypoint.
- `AIChatRunEnvelope` as the frontend source of truth.
- Account-scoped runtime model catalogs and reasoning effort as explicit run
  inputs, not hardcoded model menus.
- Existing context disclosure, egress records, approval policy, tool gateway,
  Mnemonic, skills, patch artifacts, rollback checkpoints, and audit records as
  the governance layer.

Change:

- Provider-specific code becomes adapter code under the runtime kernel.
- Existing model providers become `model_agent_runtime` adapters.
- Codex app-server and Codex exec become structured/JSONL runtime adapters.
- Terminal/TUI becomes fallback evidence and auth/trust support, not the normal
  turn surface.

Do not:

- Read or replay provider credential stores.
- Infer subscription/model access by scraping provider account pages or local
  credential stores; use only official account-aware CLI/API catalog surfaces.
- Automate consumer web UIs.
- Pass prompt/context through argv.
- Treat chat prose, provider prose, or terminal transcript as edit/tool success.
- Let provider-native tools bypass Arlecchino tool proposals and approvals.
- Write Mnemonic facts from raw runtime output.
- Hand-edit generated bindings when regeneration is required.

Success criteria:

- A selected runtime either produces real normalized events and an
  `AIChatRunEnvelope`, or returns a typed unavailable/blocked/error result.
- Build mode succeeds only with patch artifact, captured diff, explicit no-change
  evidence, diagnostic/test evidence, or blocked/error evidence.
- Ask/Plan/Review stay read-only by default.
- Cancellation suppresses stale completions.
- The UI shows the actual provider, model, transport, fallback state, proof gate,
  consent, tool policy, account-scoped model source, reasoning effort, and
  artifact status.

## File Ownership Map

Use this map before editing. Inspect the current code first; the exact DTO names
can drift.

Runtime entry and mode orchestration:

- Inspect first: `internal/ai/chat.go`, `internal/ai/service.go`,
  `internal/ai/types.go`.
- Likely changes: route runs through kernel, remove fake/template success,
  preserve mode policy.
- Verification: `go test -run 'Test.*Chat|Test.*Mode|Test.*Runtime' ./internal/ai`.

Runtime kernel and adapters:

- Inspect first: `internal/ai/agent_runtime.go`,
  `internal/ai/agents/types.go`, `internal/ai/agents/codex.go`.
- Likely changes: descriptors, proof gate, event mapping, watchdog, Codex
  app-server/exec adapters.
- Verification:
  `go test -run 'Test.*Agent|Test.*Codex|Test.*Runtime' ./internal/ai ./internal/ai/agents`.

Providers and model runtimes:

- Inspect first: `internal/ai/providers/types.go`,
  `internal/ai/providers/ollama.go`,
  `internal/ai/providers/openai_compatible.go`,
  `internal/ai/model_capabilities.go`, `internal/ai/model_probe.go`.
- Likely changes: convert provider generate paths into `model_agent_runtime`
  adapters, capability canaries.
- Verification: `go test ./internal/ai/providers` plus focused
  `./internal/ai` tests.

Context and egress:

- Inspect first: `internal/ai/egress.go`, `internal/ai/privacy.go`,
  `internal/ai/mentions.go`, `internal/ai/mcp_context.go`.
- Likely changes: context manifest, consent block, argv/log redaction.
- Verification: focused `go test ./internal/ai` egress/context tests.

Tools and approvals:

- Inspect first: `internal/ai/tool_gateway.go`,
  `internal/ai/tool_approvals.go`, `internal/ai/tool_audit.go`,
  `internal/ai/pending_approvals.go`, `internal/ai/tool_schemas.go`.
- Likely changes: lower provider tool requests into Arlecchino proposals, typed
  approvals, audit.
- Verification: focused `go test ./internal/ai` tool/approval tests.

Patch artifacts and edit safety:

- Inspect first: `internal/ai/patch_artifacts.go`,
  `internal/ai/tool_edit.go`, `internal/ai/edit_fallback.go`,
  `internal/ai/recovery.go`.
- Likely changes: patch fidelity service, dirty-state baseline, diff capture,
  rollback.
- Verification: `git apply --check` fixture tests through
  `go test ./internal/ai`.

Mnemonic and skills:

- Inspect first: `internal/ai/mnemonic_service.go`,
  `internal/ai/mnemonic/store.go`, `internal/ai/skills/store.go`,
  `internal/ai/service.go`.
- Likely changes: memory quarantine, reviewed memory writes, bounded skill
  digests.
- Verification: focused `go test ./internal/ai ./internal/ai/mnemonic`.

AI Chat UI:

- Inspect first: `frontend/src/components/ai-chat/AIChatPanel.tsx`,
  `RunCard.tsx`, `ActivityTimeline.tsx`, `ToolProposalCard.tsx`,
  `PatchArtifactCard.tsx`, `AgentConsole.tsx`,
  `frontend/src/stores/aiChatStore.ts`.
- Likely changes: visible truth UI, runtime cards, fallback transcript drawer, no
  terminal-store dependency.
- Verification: `cd frontend && npm run typecheck`; focused specs for AI chat.

Wails bridge and bindings:

- Inspect first: `frontend/src/wails/app.ts`, generated bindings, Wails
  generation scripts.
- Likely changes: update only through approved generation flow when DTOs change.
- Verification: approved binding generation plus frontend typecheck.

Generated artifacts:

- Do not hand-edit `frontend/bindings/**` or `frontend/wailsjs/**`.
- If DTO changes require regeneration, stop and use the repo-approved Wails
  binding generation flow.

## Execution Order

Do not implement adapters before the kernel gates exist.

Required order:

1. Phase 0: runtime refactor baseline.
2. Phase 1: kernel contract, proof gate, failure taxonomy, event vocabulary.
3. Phase 2: patch fidelity, dirty-state baseline, artifact acceptance.
4. Phase 3: model agent runtime for existing providers.
5. Phase 4: Codex structured runtime.
6. Phase 5: Codex JSONL bridge.
7. Phase 6: runtime UI.
8. Phase 7: additional adapters only after explicit approval.

Dependency rule:

- A later phase can start only when the earlier phase has a passing narrow
  verification path or an explicit documented blocker.
- If a later phase needs a DTO/contract absent from an earlier phase, return to
  the earlier phase and update the shared contract first.

## Stop Conditions

Stop and report a blocker instead of patching around it when:

- the selected provider surface is unofficial or requires credential-store
  replay;
- Build output cannot be represented as structured patch, captured diff,
  explicit no-change, diagnostic/test evidence, or blocked/error evidence;
- current DTOs cannot represent required runtime events and binding regeneration
  has not been approved;
- a provider tool path would bypass Arlecchino approvals/audit;
- context would be sent without an egress record and consent state;
- a local server would bind outside loopback or accept browser-origin requests
  without auth/origin checks;
- cancellation cannot suppress stale completions;
- UI would need to claim success without backend proof/artifacts;
- tests show Ask/Plan/Review lost read-only or streaming behavior.

## Decision

Build an `Agent Runtime Kernel` under AI Chat.

The kernel owns the common lifecycle:

`AIChatRunRequest -> AIContextSnapshot -> consent/egress -> runtime turn -> normalized events -> AIChatRunEnvelope -> artifacts -> review/apply/audit`

The selected provider determines the adapter and transport. The selected mode
determines policy. No mode may silently fake success, bypass the selected
runtime, or answer through a local template while presenting it as provider
work.

The primary production integration for Codex is:

1. `codex app-server` over stdio JSON-RPC/JSONL for rich GUI sessions.
2. `codex exec --json` for bounded non-interactive bridge runs.
3. Codex PTY only for auth, trust, unsupported approvals, and fallback evidence.

The primary model-provider integration for local noTUI providers is:

1. Arlecchino-owned agent loop.
2. Provider `Generate` or OpenAI-compatible request.
3. Arlecchino tool gateway, Mnemonic, skills, context composer, approval policy,
   and patch artifacts.

This keeps provider-owned agents and model-only providers behind one UX and one
governance layer.

## Migration Principle

Do not build a new agent system above the current Arlecchino AI runtime. Rework
the current runtime into the `Agent Runtime Kernel`.

The existing pieces remain the foundation:

- `AIChatRunRequest` remains the request entrypoint.
- `AIContextSnapshot`, `AIContextSummary`, and `AIEgressRecord` remain the
  context and disclosure contract.
- `AIChatRunEnvelope` remains the frontend source of truth.
- The provider registry becomes the runtime catalog.
- The current tool gateway becomes the only path for Arlecchino-owned tools.
- Mnemonic remains Arlecchino memory, not provider memory.
- Existing patch artifacts, approval state, rollback checkpoints, and audit
  records remain the governance layer.
- The current AI Chat panel remains the product surface, but it renders runtime
  cards and artifacts instead of terminal state.

Adapters must not create private histories, private tool approval stores,
private memory stores, private provider settings, or terminal-only success
paths. When the current DTOs cannot represent a runtime case, extend the current
contract and regenerate bindings through the project flow instead of adding a
sidecar protocol that the rest of the app cannot audit.

The migration should retire duplicate or fake paths as the kernel takes over.
In particular, any local template answer, chat-only edit, or terminal transcript
success path must be deleted, blocked, or downgraded to evidence-only behavior
once the equivalent runtime event/artifact path exists.

## Non-Goals

- Do not create a parallel agent stack.
- Do not build a terminal emulator as the primary AI Chat surface.
- Do not automate provider web UIs.
- Do not read, copy, transform, export, or replay provider credential stores.
- Do not copy private ChatGPT, Claude, Gemini, Cursor, Copilot, or other hidden
  backend endpoint flows into production.
- Do not auto-answer login, trust, update, shell, file, MCP, network, or tool
  approval prompts.
- Do not treat terminal transcript text as a successful tool, edit, or patch
  result.

## Runtime Families

### `structured_agent_runtime`

A provider-owned coding agent with a structured session protocol and stable
events.

Examples:

- Codex app-server.
- Future Claude/Gemini/Copilot/Cursor routes only if they expose documented,
  provider-sanctioned structured surfaces.

Arlecchino responsibilities:

- launch or connect to the runtime;
- manage project-scoped sessions;
- map provider events into normalized events;
- render approvals/questions as GUI controls;
- capture artifacts and audits;
- keep provider credentials owned by the provider runtime.

### `jsonl_exec_runtime`

A bounded non-interactive agent process with machine-readable output.

Examples:

- Codex `exec --json`.
- Other CLIs only when their documented non-interactive mode emits structured
  events or a stable final JSON result.

Arlecchino responsibilities:

- pass prompt/context through stdin or safe process input, not argv;
- select sandbox by mode policy;
- parse events into the normalized vocabulary;
- kill the process group on cancel;
- capture final message, usage, command evidence, and diff artifacts.

### `model_agent_runtime`

A noTUI model provider where Arlecchino owns the agent loop.

Examples:

- Ollama.
- LM Studio.
- llama.cpp server.
- Hugging Face TGI.
- local or remote OpenAI-compatible endpoints.
- OpenAI Platform BYOK and enterprise gateways.

Arlecchino responsibilities:

- run the planning/tool/edit loop;
- choose tool schemas and tool call strategy per model capability;
- execute tools only through `ExecuteToolCall`;
- handle memory and skill context explicitly;
- transform model output into patch artifacts or tool proposals;
- maintain cancellation, retries, egress, and audits.

This is the "ordinary runner" for noTUI agents. It should feel like the same
agent surface even though the provider is only a model endpoint.

### `interactive_fallback_runtime`

A PTY/TUI compatibility path.

Allowed uses:

- official provider login/auth flows;
- trust prompts;
- unsupported approval prompts;
- update prompts that block a run;
- manual debug/evidence drawer;
- last-resort compatibility when no structured surface exists.

Rules:

- never use TUI prompting as the normal request path;
- never treat TUI parsing as authoritative state when structured events exist;
- never send prompt/context through argv;
- never auto-answer prompts;
- keep transcript bounded and redacted;
- convert safely identifiable blocking prompts into GUI cards;
- store terminal output as evidence, not as run truth.

## Kernel Architecture

### Runtime Catalog

Every runtime descriptor needs enough metadata for routing, security, legal
review, and UI:

```go
type AgentRuntimeDescriptor struct {
    ID               string
    Name             string
    RuntimeFamily    string // structured_agent_runtime, jsonl_exec_runtime, model_agent_runtime, interactive_fallback_runtime
    Transport        string // app_server, http_sse, jsonl_exec, model_api, sdk, pty_fallback
    Binary           string
    Endpoint         string
    EndpointClass    string // local_process, local_stdio, local_loopback, local_network, remote_provider, enterprise_gateway, unknown
    AuthMode         string // none, api_key, oauth, cli_managed, account_via_cli
    AuthStatus       string // unknown, missing, ready, needs_auth, error
    BillingMode      string // local, api_key, subscription, provider_account, enterprise, unknown
    LegalBasis       string // first_party_docs, formal_partner, public_oss_api, local_model_api, unsupported_private
    RiskTier         string
    Capabilities     []AgentRuntimeCapability
    SupportedModes   []AgentRuntimeMode
    SourceLinks      []string
    RuntimeVersion   string
    LastCheckedAt    string
}
```

Capability examples:

- streamed messages;
- persistent sessions;
- non-interactive run;
- structured approvals;
- file change events;
- diff/revert;
- shell commands;
- tool calling;
- MCP;
- skills;
- memory;
- image input;
- web search;
- subagents;
- resume/fork;
- reasoning/activity summaries;
- usage/cost metrics;
- PTY fallback.

Descriptor validation is a security gate. A provider without legal basis,
transport kind, endpoint class, auth mode, and source links must be disabled or
research-only.

### Session Manager

The session manager owns:

- project-scoped runtime sessions;
- warm app-server/server connections;
- health checks and restart policy;
- per-runtime concurrency limits;
- turn queue and backpressure;
- cancellation;
- stale completion suppression;
- runtime version and capability cache;
- descriptor invalidation after auth/config changes.

For responsiveness, prefer warm structured sessions for `Ask` and `Plan`. A
simple read-only `Ask` such as `Привет` should not pay interactive TUI startup,
MCP startup noise, update prompts, or trust-prompt overhead.

### Turn Orchestrator

The orchestrator owns the high-level state machine:

- `queued`;
- `preflight`;
- `context_ready`;
- `blocked_by_consent`;
- `session_starting`;
- `running`;
- `waiting_for_approval`;
- `waiting_for_user_input`;
- `waiting_for_tool`;
- `capturing_diff`;
- `completed`;
- `error`;
- `canceled`.

All terminal states must be idempotent. A canceled run must not later complete
successfully because a child process or provider session emitted a stale final
message.

### Context Plane

Context remains Arlecchino-owned:

- `AIContextRequest` captures requested context.
- `AIContextSnapshot` is the full materialized source of truth.
- `AIContextSummary` is the UI/ledger-safe projection.
- `AIEgressRecord` records provider-visible data categories.
- Context artifacts make disclosure inspectable.

Minimal/general chat must not get implicit current-file, Mnemonic, MCP, skill,
terminal, or workspace context. Explicit mentions can include context when
policy allows it.

### Tool Plane

All tools remain Arlecchino-owned unless a structured provider protocol exposes
equivalent typed approval and audit events.

Use the existing tool gateway:

- `AIToolDescriptor`;
- `AIToolProposal`;
- `ExecuteToolCall`;
- approval grants;
- tool lifecycle artifacts;
- tool audit records.

Provider-native tool requests must be lowered into Arlecchino tool proposals.
Model-only runtimes must call tools only through Arlecchino. External
structured runtimes may use provider-side tools only when their request,
approval, execution, and result events can be represented in the envelope and
audit ledger.

### Memory Plane

Mnemonic is shared runtime memory, not provider memory.

Rules:

- Mnemonic inclusion is explicit and disclosed.
- Raw terminal output, raw provider output, raw MCP output, and untrusted skill
  text are not memory sources.
- Memory writes require reviewed, redacted, trusted facts.
- Provider-specific memory must not override Arlecchino Mnemonic or repo/user
  instructions.
- Cross-runtime memory must record source, trust, redaction, and reviewer state.

### Skill Plane

Skills are shared procedural context.

Rules:

- Attach trusted skill digests through context, not hidden prompt injection.
- For Codex app-server, prefer structured skill input items when supported.
- For model runtimes, include a bounded digest or selected skill sections.
- Skills never outrank direct user instructions, safety policy, repo
  `AGENTS.md`, provider consent, or tool approvals.
- Runtime adapters must not auto-install or auto-enable skills without user
  review.

### Artifact Plane

Artifacts are the durable proof surface:

- context disclosure;
- egress record;
- runtime transcript or structured event evidence;
- tool lifecycle;
- command/test evidence;
- plan and review findings;
- patch preview;
- captured direct diff;
- rollback checkpoint;
- blocked/error evidence.

Build mode is successful only when it produces one of:

- structured patch proposal;
- captured direct diff from a clean baseline;
- explicit no-change result with evidence;
- diagnostic/test finding when the mode policy is debug-like;
- blocked/error state with evidence.

Chat prose or terminal transcript alone is not Build output.

### UI Projection

The AI Chat panel is the main GUI.

It should render:

- provider/runtime picker;
- mode control;
- model/reasoning selector when supported;
- context disclosure;
- consent state;
- runtime health/preflight;
- timeline;
- activity/thinking summaries;
- approval/question cards;
- tool proposal cards;
- diff/artifact review;
- optional raw transcript drawer for fallback evidence;
- composer with attachments and `@` context.

Do not use `TerminalPanel`, `useTerminalStore`, `tuiModeActive`, or
`terminal:*` events as the normal agent turn surface.

## Normalized Event Vocabulary

Every adapter should map provider events into a small Arlecchino vocabulary.

```go
type AgentRuntimeEvent struct {
    ID               string
    RunID            string
    SessionID        string
    RuntimeID        string
    RuntimeFamily    string
    Transport        string
    Type             string
    Status           string
    Text             string
    Payload          json.RawMessage
    DataCategories   []string
    ArtifactID       string
    ToolCallID       string
    ApprovalID       string
    CreatedAt        string
}
```

Core event types:

- `runtime.status`;
- `runtime.preflight`;
- `message.delta`;
- `message.final`;
- `reasoning.delta`;
- `approval.request`;
- `approval.resolved`;
- `tool.request`;
- `tool.result`;
- `tool.error`;
- `file.change.proposed`;
- `file.change.applied`;
- `diff.captured`;
- `artifact.created`;
- `notice.blocking`;
- `notice.preflight`;
- `notice.diagnostic`;
- `usage.updated`;
- `terminal.data`.

Provider event schemas must stay adapter-local. The AI Chat UI should consume
envelopes, artifacts, and normalized events.

## Mode Contracts

Every mode uses the same selected runtime and same envelope path.

### Ask

- Purpose: answer, explain, inspect lightly, clarify.
- Context: minimal by default; explicit mentions preserved.
- Permissions: read-only; no shell/write approvals by default.
- Artifacts: response, safe citations, optional inspected-context summary.
- Success: real provider/agent response or explicit blocked/unavailable state.
- Forbidden: local template answer pretending to be a provider response.

### Plan

- Purpose: produce a plan, risks, sequencing, assumptions.
- Context: repository/context access allowed by disclosure.
- Permissions: read-only; read-only commands only if policy allows them.
- Artifacts: plan artifact, risk list, context/egress record.
- Success: structured plan or explicit blocker.

### Build

- Purpose: implement changes.
- Context: repository and relevant files after disclosure.
- Permissions: workspace-write only after consent and approval policy.
- Artifacts: patch proposal or captured direct diff; baseline required.
- Success: reviewed patch artifact, captured direct diff, explicit no-change
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

## Security And Legal Model

This section is a product security design baseline, not legal advice.

### Assets

Protect:

- provider credentials and OAuth state;
- API keys, cookies, keychains, browser stores, token files, auth JSON files;
- project source, secrets, `.env`, git state, diagnostics, terminal output;
- Mnemonic, skills, MCP resources, tool results;
- approval grants, egress records, patch artifacts, rollback checkpoints;
- local app-server, HTTP, WebSocket, SSE, and stdio channels;
- user trust in which provider/model/runtime actually ran.

### Trust Boundaries

Treat these as boundaries:

- user prompt to context composer;
- repository files to prompt/context;
- provider output to UI/tool gateway;
- external runtime process to Arlecchino;
- local HTTP/WS/SSE server to browser/web origins;
- MCP server metadata/tools/resources to Arlecchino;
- model-only provider output to Arlecchino-owned tools;
- direct file writes to patch artifacts;
- raw terminal transcript to inspectable evidence;
- skill text to trusted digest;
- Mnemonic write path to durable memory.

### Hard Deny

Do not implement:

- reading `~/.codex/auth.json`, `.claude`, GitHub/Cursor
  token files, browser cookies, keychain items, or provider credential stores;
- web automation for ChatGPT, Claude, Gemini, Cursor, Copilot, or similar UIs;
- private backend replay, hidden endpoint copying, or monkey-patched provider
  packages for consumer subscription access;
- bundled credentials, copied device codes, shared OAuth client secrets, or
  undocumented token exchange;
- provider-side approval laundering where Arlecchino records a run as approved
  without its own approval/audit surface;
- unbounded local HTTP/WS servers on non-loopback interfaces;
- local server endpoints without Origin validation and auth when reachable from
  a browser or network;
- raw MCP output, raw terminal transcript, or raw provider stderr as default
  model context;
- direct Build success without patch/diff/no-change/diagnostic evidence;
- automatic third-party CLI agent classification without an approved legal basis,
  runtime descriptor, and conformance proof.

### Required Controls

Every runtime adapter needs:

- descriptor legal basis and source links;
- endpoint class and transport classification;
- auth ownership statement;
- billing/quota ownership statement;
- preflight and health result;
- context manifest and egress categories before provider invocation;
- consent block before external egress;
- protected resource denylist for secrets and provider auth stores;
- output redaction before logs, transcript artifacts, egress summaries, and UI;
- process-group or session cancellation;
- bounded stdout/stderr/transcript and provider event buffers;
- no prompt/context in argv;
- approval separation: mode permission, tool approval, provider consent, auth,
  MCP authorization, protected-resource policy;
- patch validation and rollback checkpointing for edits;
- audit records for tool calls, egress, approvals, artifacts, and runtime
  lifecycle.

### High-Risk Failure Modes

Security review should look for:

- credential replay;
- prompt injection through repo files, MCP metadata, skill text, provider output;
- confused deputy tool use;
- memory poisoning;
- permission laundering;
- sandbox mismatch between mode and runtime flags;
- local server DNS rebinding or cross-origin abuse;
- shell-command construction bugs;
- path traversal in file tools or patch apply;
- provider binary or plugin supply-chain drift;
- unreviewable direct writes;
- stale completion after cancellation;
- secret leakage through argv, logs, transcripts, events, or final responses.

## Similar Systems And Transferable References

The exact Arlecchino system is unusual because it unifies provider-owned agents
and model-only providers behind one IDE-native runtime kernel. Still, several
systems provide usable patterns.

### Codex App Server

Official Codex rich-client surface.

Transfer:

- use a long-lived local process for rich clients;
- communicate over JSON-RPC/JSONL or local WebSocket when supported;
- map streamed items, approvals, file changes, tools, and skills into GUI
  state;
- keep Codex-managed auth inside Codex.

Source:

- https://developers.openai.com/codex/app-server

### Codex Non-Interactive

Official bounded task surface.

Transfer:

- use `codex exec --json` for machine-readable bounded runs;
- pipe context through stdin when needed;
- use read-only sandbox by default;
- use workspace-write only for approved Build-style work.

Source:

- https://developers.openai.com/codex/noninteractive

### Model Context Protocol

MCP is not the runtime kernel, but it is the best reference for tool/context
protocol boundaries.

Transfer:

- resources, prompts, tools, cancellation, logging, progress;
- stdio and Streamable HTTP transports;
- explicit consent before tool invocation and data exposure;
- host responsibility for user control and privacy;
- local HTTP endpoint hardening against DNS rebinding.

Sources:

- https://modelcontextprotocol.io/specification/
- https://modelcontextprotocol.io/specification/draft/basic/transports

### Ollama

Local model runtime with REST API.

Transfer:

- model provider can be noTUI and local;
- Arlecchino should own the agent loop, tools, memory, and artifacts;
- endpoint defaults to localhost and should stay classified as local loopback
  unless configured otherwise.

Source:

- https://docs.ollama.com/api/introduction

### LM Studio

Local server and SDK ecosystem with OpenAI and Anthropic-compatible endpoints,
tool use, structured output, and headless daemon options.

Transfer:

- noTUI local model providers can support tools and structured outputs;
- OpenAI-compatible endpoints are useful for a common model provider adapter;
- headless deployment can avoid GUI coupling.

Sources:

- https://lmstudio.ai/docs/developer
- https://www.lmstudio.ai/docs/developer/openai-compat/tools

### Claude Code And GitHub Copilot CLI

Useful references for permission and non-interactive patterns, not a license to
wrap private or interactive flows.

Transfer:

- non-interactive mode should have a structured permission story;
- MCP tools need explicit allow/permission controls;
- terminal agents warn users to trust launch directories and review commands.

Sources:

- https://code.claude.com/docs/en/cli-usage
- https://code.claude.com/docs/en/agent-sdk/mcp
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli

### Continue And Aider

Useful product references for provider-neutral configuration and context maps.

Transfer:

- let users choose or mix model providers;
- maintain a compact repository map/context pack instead of flooding prompts;
- keep provider choice separate from IDE workflow.

Sources:

- https://docs.continue.dev/customize/overview
- https://aider.chat/docs/repomap.html

## Library Guidance

Prefer existing dependencies before adding new ones.

### Keep And Reuse

- `go.lsp.dev/jsonrpc2`: JSON-RPC concepts and helpers for structured local
  protocol work.
- `github.com/goccy/go-json`: faster JSON decoding for high-volume event
  streams.
- `github.com/coder/websocket`: local WebSocket client/server when a runtime
  requires it.
- `github.com/creack/pty`: fallback PTY only, with explicit process lifecycle
  and cancellation.
- `github.com/go-git/go-git/v5`: git inspection where shelling out is not the
  best fit.
- existing git shell helpers: keep using native git for exact diffs when that is
  more reliable.
- `github.com/cyphar/filepath-securejoin`: path containment support.
- `mvdan.cc/sh/v3`: shell parsing for terminal tool previews and policy checks.
- `github.com/dgraph-io/ristretto/v2`: short-lived runtime descriptor/session
  caches where useful.
- `fsnotify`: provider config and project state watchers.
- SQLite/GORM ledgers: egress, tool audit, artifacts, Mnemonic, capability
  probes.
- `@xterm/xterm`: optional fallback transcript drawer only.
- `@tanstack/react-virtual`: large timeline/transcript virtualization.
- Radix UI primitives: approval dialogs, menus, toggles, popovers.

### Consider Only With A Clear Gap

- `github.com/modelcontextprotocol/go-sdk`: official MCP client/server SDK when
  Arlecchino needs full MCP transport/client expansion rather than its current
  local bridge.
- Provider official SDKs: only when they expose structured events, model
  management, auth, or tool behavior that HTTP cannot represent cleanly.
- Dedicated SSE helper: only if `net/http` plus `bufio.Scanner`/reader code
  becomes error-prone for provider event streams.

### Avoid

- Generic agent frameworks that replace Arlecchino's context, approval, memory,
  artifact, and audit contracts.
- New terminal libraries for normal agent turns.
- Browser automation libraries for provider access.
- Shell string manipulation where structured JSON, JSON-RPC, AST, or shell
  parsers exist.

## Provider Matrix

### P0: Codex App Server

- Family: `structured_agent_runtime`.
- Transport: `app_server` over stdio JSON-RPC/JSONL first.
- Legal basis: first-party OpenAI Codex interface for rich clients.
- Auth: Codex-managed.
- Use for: normal Codex Ask/Plan/Build/Debug/Review.
- Required proof: approvals, file changes, streamed events, cancellation, skills
  and artifacts map into `AIChatRunEnvelope`.

### P0: Codex Exec JSONL

- Family: `jsonl_exec_runtime`.
- Transport: `codex exec --json`.
- Legal basis: first-party Codex non-interactive interface.
- Auth: Codex-managed or supported API-key automation path.
- Use for: bounded bridge runs while app-server integration matures.
- Required proof: stdin prompt/context, mode sandbox, event parsing, cancellation,
  final message, captured diff.

### P0: Arlecchino Model Agent Runtime

- Family: `model_agent_runtime`.
- Transport: provider HTTP/OpenAI-compatible/model API.
- Legal basis: local model API, BYOK, enterprise gateway, or configured provider
  API terms.
- Use for: Ollama, LM Studio, llama.cpp, OpenAI-compatible endpoints.
- Required proof: tool loop, capability probe, structured output fallback,
  approval gateway, patch artifact generation.

### P1: Additional Structured Agents

- Not registered by default.
- Add only after explicit product approval and adapter conformance.
- Family: `structured_agent_runtime` only when the provider has an official,
  mappable structured API.
- Hard rule: do not read provider credential storage.

### P2: Other CLI Agents

Candidates:

- Claude Code;
- Gemini CLI;
- GitHub Copilot CLI;
- Cursor agent surfaces;
- GitLab Duo;
- Qwen Code.

Rules:

- Do not register or auto-detect these as Arlecchino agents by default.
- Add only after official structured or non-interactive machine-readable
  surfaces are confirmed.
- PTY is fallback-only.
- Consumer subscription routes through unofficial plugins are deny unless the
  provider explicitly supports that route for embedded clients.

## Stability And Correctness Additions

These additions are required because prior runtime work surfaced recurring
failure modes: fake/template success, chat prose treated as edit output, broken
diff fidelity, Build fixes leaking into Ask/Plan streaming, stale editor state,
and UI polish hiding missing backend evidence.

### 1. Runtime Proof Gate

Problem:

- The UI can look like an agent ran even when no provider/model process actually
  started or no real runtime event arrived.

Adaptation:

- Add a proof stage to the current run lifecycle before a run is presented as
  active or successful.
- The proof record should be emitted as `runtime.status` and attached to
  `AIChatRunEnvelope`.
- Required fields: runtime descriptor id, provider id, model id when applicable,
  transport kind, endpoint class, adapter version, runtime binary path/version
  when local, session/run id, preflight result, and the first real provider
  event or typed failure.
- `AIChatRunRequest` should not fall back to local assistant/template output when
  the selected runtime is unavailable.

Gate:

- If proof is missing, the run state is `unavailable` or `blocked`, never
  `completed`.
- The frontend must render the real runtime label, for example
  `Codex app-server`, `Codex exec JSONL`, `Ollama model_agent_runtime`, or
  `PTY fallback`.

### 2. Adapter Conformance Suite

Problem:

- Each provider can drift into its own semantics for startup, streaming, tools,
  cancellation, consent, and Build output.

Adaptation:

- Add a shared backend conformance harness for every runtime adapter.
- The harness should exercise the same contract through fake transports,
  captured fixtures, and disposable local projects.
- Start with focused cases: descriptor validation, startup/preflight, first
  event, streaming, cancellation, stale completion, consent block, tool approval,
  Build artifact, argv-leak check, redaction, provider auth failure, and local
  server Origin/auth checks where applicable.
- Existing provider tests should be folded toward this harness rather than
  duplicated per adapter.

Gate:

- A runtime cannot be shown as production-capable in the provider picker until
  its conformance profile passes or is explicitly marked experimental/degraded.

### 3. Golden Event Replay

Problem:

- Provider protocols change, and the UI can break silently when JSONL, SSE,
  JSON-RPC, or model output shapes change.

Adaptation:

- Keep sanitized golden event fixtures for each adapter family:
  `structured_agent_runtime`, `jsonl_exec_runtime`, `model_agent_runtime`, and
  `interactive_fallback_runtime`.
- Normalizers should be testable as pure transformations from provider events
  into normalized `AgentRuntimeEvent` values.
- Fixtures should include happy paths, approvals, tool calls, file-change
  proposals, usage updates, stderr/noise, malformed events, and provider
  protocol upgrades.

Gate:

- A normalizer change must replay old fixtures and show deliberate fixture
  updates when behavior changes.
- Unknown provider events should become bounded `notice` or ignored diagnostic
  events, not crashes or fake completions.

### 4. Mode Regression Matrix

Problem:

- Build-only recovery behavior previously risked breaking Ask/Plan/Debug
  streaming or permission boundaries.

Adaptation:

- Treat mode as policy over the same runtime, then test each mode explicitly.
- Matrix rows: `Ask`, `Plan`, `Build`, `Debug`, `Review`.
- Matrix columns: streaming, context access, shell permission, file-write
  permission, tool approval, Mnemonic inclusion, Build artifact requirement,
  fallback eligibility, and terminal transcript visibility.
- Build fallback buffering must remain scoped to Build paths that need edit
  recovery.

Gate:

- A change to tool loop, streaming, fallback, context, or approval policy must
  run the narrow matrix cases for affected modes before it is accepted.

### 5. Patch Fidelity Service

Problem:

- Diff generation is fragile; small whitespace or trimming mistakes can corrupt
  hunks and make `git apply --check` fail.

Adaptation:

- Centralize patch building, parsing, validation, and artifact creation behind a
  single backend service used by model runtimes, structured agent runtimes,
  JSONL bridges, and captured direct-write diffs.
- This service must preserve unified-diff payloads exactly and use trimming only
  for emptiness checks.
- It should normalize line endings only through explicit, tested policy.
- It should validate protected paths, binary files, rename/delete cases,
  current-file anchors, and rollback checkpoint creation.

Gate:

- Build output is accepted only after the service creates a valid patch artifact
  or captured diff artifact and `git apply --check` or an equivalent validation
  passes.

### 6. Dirty-State And Baseline Guard

Problem:

- A runtime can write against stale disk state while the editor buffer or
  worktree already has unrelated changes.

Adaptation:

- Before Build, capture a baseline containing git status, affected file hashes,
  editor buffer version, selected context ids, and rollback checkpoint id.
- For provider direct writes, capture the diff from that baseline and reject
  ambiguous or unrelated changes.
- For current-file fallback, block when the editor buffer and disk state have
  diverged unless the user explicitly chooses the editor buffer as the baseline.
- The guard should live below all adapters so PTY, JSONL, Codex app-server, and
  model runtimes share the same behavior.

Gate:

- If baseline cannot be established or has become stale, Build ends as
  `blocked_stale_state` with evidence, not as a successful edit.

### 7. Failure Taxonomy

Problem:

- Generic errors make the system feel random and hide whether the issue is auth,
  consent, runtime startup, provider config, protocol drift, or no artifact.

Adaptation:

- Define stable runtime failure codes and expose them through
  `AIChatRunEnvelope` notices/artifacts.
- Initial codes:
  `provider_not_configured`, `provider_not_running`, `auth_required`,
  `trust_prompt_required`, `consent_required`, `tool_denied`,
  `protected_resource_denied`, `no_reviewable_artifact`, `stale_completion`,
  `dirty_baseline`, `adapter_protocol_changed`, `runtime_timeout`,
  `runtime_cancelled`, `runtime_unhealthy`, `quota_or_billing_blocked`.
- Map provider-specific errors into these codes at the adapter boundary.

Gate:

- The frontend should branch on failure codes instead of parsing provider prose.
- Provider auth failure must not be mislabeled as consent failure, and missing
  model/runtime must not become template success.

### 8. Runtime Watchdog

Problem:

- CLI, PTY, local server, and model runtimes can hang, flood output, survive
  cancellation, or complete after the user already started another run.

Adaptation:

- Add a watchdog per runtime session with heartbeat, startup timeout, idle
  timeout, max output buffer, max event queue size, process-group cancellation,
  orphan cleanup, and run epoch/stale nonce.
- Warm sessions should have health states: `starting`, `ready`, `busy`,
  `degraded`, `blocked`, `restarting`, `dead`.
- Backpressure should downgrade noisy transcript/event output into bounded
  artifacts instead of blocking the UI.

Gate:

- Cancellation must kill or detach the process/session, mark the run cancelled,
  and suppress late provider completions from mutating the current envelope.

### 9. Capability Canary Tasks

Problem:

- Descriptor metadata alone can claim support for tools, streaming, patches, or
  approvals when the selected binary/model actually cannot do it.

Adaptation:

- Add lightweight canary tasks per runtime profile:
  read-only answer, stream a small response, request/decline a mock tool, propose
  a tiny patch in a disposable project, cancel mid-run, and emit usage when
  supported.
- Cache canary results per runtime descriptor, adapter version, provider version,
  model id, and project trust state.
- Use canaries to drive UI capability badges and mode availability.

Gate:

- Build mode should be disabled or marked degraded until the runtime proves it
  can produce a structured patch, captured diff, explicit no-change, or
  diagnostic evidence through the shared artifact path.

### 10. Memory Quarantine

Problem:

- Raw provider output, terminal output, MCP metadata, or repo-injected text can
  poison durable Mnemonic memory.

Adaptation:

- Add a quarantine state for candidate memory facts from runtime output.
- Candidate facts must record source run id, source type, trust label, redaction
  state, extracted claim, and reviewer state.
- Only reviewed/redacted facts can become Mnemonic facts.
- Runtime adapters may request memory inclusion through context policy, but they
  may not write directly to Mnemonic.

Gate:

- Raw transcript, raw model output, raw MCP output, and untrusted skill text are
  never written as durable memory.

### 11. Provider Binary Provenance

Problem:

- CLI tools and local servers can update independently and change behavior,
  protocol shape, permissions, or legal surface.

Adaptation:

- Runtime descriptors should include local binary path, resolved executable,
  version output, source link, install channel when known, protocol surface,
  adapter compatibility range, and optional checksum/fingerprint when practical.
- Store provenance in runtime health artifacts, not in prompts.
- When a provider binary changes, invalidate cached capability canaries and run
  preflight again.

Gate:

- If the binary version is unknown or outside the adapter compatibility range,
  the runtime becomes `degraded` or `blocked` until the user accepts the risk or
  the adapter is updated.

### 12. Visible Truth UI

Problem:

- A polished chat surface can hide whether the backend ran the selected runtime,
  used a fallback, skipped tools, or only generated local prose.

Adaptation:

- The AI Chat panel should always show the actual runtime family, provider,
  model, transport, mode, consent state, sandbox/tool policy, health state,
  proof gate result, and artifact status.
- Raw transcript belongs in an evidence drawer only. The main timeline renders
  normalized events, approvals, tool cards, patch artifacts, diagnostics, and
  failure notices.
- Fallback state must be visible: `structured`, `jsonl`, `model agent`, or
  `PTY fallback`.

Gate:

- The UI cannot show success until the envelope contains a terminal state plus
  the required proof/artifact for the selected mode.

## Implementation Task Cards

Each phase below is a task card. Execute only one phase at a time unless the
work is explicitly split into non-overlapping backend/frontend slices.

### Phase 0: Runtime Refactor Baseline

Goal:

- Establish the current truth before changing behavior.
- Decide which existing code becomes kernel code, which code becomes adapter
  code, and which code must be deleted or blocked.

Inspect first:

- `internal/ai/chat.go`
- `internal/ai/service.go`
- `internal/ai/types.go`
- `internal/ai/chat_envelope.go`
- `internal/ai/agent_runtime.go`
- `internal/ai/agents/types.go`
- `internal/ai/provider_specs.go`
- `internal/ai/tool_gateway.go`
- `internal/ai/patch_artifacts.go`
- `frontend/src/components/ai-chat/AIChatPanel.tsx`
- `frontend/src/stores/aiChatStore.ts`

Implement:

1. Inventory the current request, context, provider, egress, envelope, tool,
   patch, Mnemonic, skills, and frontend binding contracts.
2. Mark every fake/local/template success path and every terminal-only success
   path.
3. Identify duplicated provider state, duplicated history state, and duplicated
   approval state.
4. Write the minimal in-code comments or type names needed to make the kernel
   boundary obvious.
5. Do not add Codex/Ollama adapter behavior yet.

Stop conditions:

- DTO changes are required but binding regeneration is not approved.
- The current runtime path cannot be mapped to `AIChatRunEnvelope`.
- A fake/template path cannot be blocked without changing user-visible behavior.

Verification:

- `go test -run 'Test.*Chat|Test.*Mode|Test.*Runtime' ./internal/ai`
- `cd frontend && npm run typecheck` if frontend types changed.
- `git diff --check`

Accepted when:

- The current runtime entrypoints and duplicate/fake paths are identified.
- No new adapter was added before the kernel contract exists.
- The documentable migration path is current-runtime refactor, not sidecar stack.

### Phase 1: Kernel Contract, Proof, And Events

Goal:

- Add the shared kernel contract that all adapters must use.
- Make fake/providerless success impossible.

Inspect first:

- `internal/ai/types.go`
- `internal/ai/agent_runtime.go`
- `internal/ai/agents/types.go`
- `internal/ai/chat.go`
- `internal/ai/chat_envelope.go`
- `internal/ai/run_timeline.go`

Implement:

1. Introduce or update `AgentRuntimeDescriptor` with runtime family, transport,
   endpoint class, auth mode, billing mode, legal basis, source links, risk tier,
   and capabilities.
2. Add runtime proof state: descriptor id, provider id, model id, transport,
   endpoint class, adapter version, binary path/version when local, session/run
   id, preflight result, first provider event, and typed failure.
3. Define normalized runtime events for status, messages, reasoning summaries,
   approvals, tools, file proposals, captured diffs, artifacts, notices, usage,
   and bounded terminal data.
4. Add stable failure codes and map provider/adapter errors into those codes at
   the boundary.
5. Ensure every mode routes through the selected provider/runtime or returns a
   typed unavailable/blocked result.
6. Block local/template answers when the selected runtime did not prove it ran.

Stop conditions:

- A provider cannot expose enough evidence for proof state.
- A failure cannot be represented without inventing frontend-only state.
- Event DTO changes require generated bindings and regeneration is not approved.

Verification:

- descriptor validation test rejects incomplete descriptors;
- proof gate test rejects missing provider/model/transport/session evidence;
- fake-provider path returns unavailable/blocked, not completed;
- stale completion test is prepared for later watchdog integration;
- `go test -run 'Test.*Agent|Test.*Runtime|Test.*Envelope|Test.*Mode' ./internal/ai ./internal/ai/agents`.

Accepted when:

- `AIChatRunEnvelope` can represent runtime proof, failure, and normalized
  events.
- No selected runtime can silently complete without backend proof.

### Phase 2: Patch Fidelity And Dirty-State Guard

Goal:

- Make Build output reviewable and reliable before adding more writer runtimes.

Inspect first:

- `internal/ai/patch_artifacts.go`
- `internal/ai/tool_edit.go`
- `internal/ai/edit_fallback.go`
- `internal/ai/recovery.go`
- `internal/ai/tool_gateway.go`
- `internal/ai/chat.go`
- `internal/ai/service_test.go`

Implement:

1. Centralize patch creation, parsing, validation, and artifact creation into one
   patch fidelity path.
2. Preserve unified diff payloads exactly; use trimming only for emptiness
   checks.
3. Add dirty-state baseline capture for Build: git status, affected file hashes,
   editor buffer version when available, selected context ids, and rollback
   checkpoint id.
4. Require direct runtime writes to become captured diffs from the known
   baseline.
5. Block ambiguous edits, protected paths, binary files, stale anchors, stale
   editor buffers, and broad whole-file rewrites unless explicitly reviewed.

Stop conditions:

- A runtime can write files without producing patch/captured diff evidence.
- `git apply --check` or equivalent validation cannot be applied.
- Editor buffer state and disk state conflict without a user-selected baseline.

Verification:

- patch validation passes for targeted edit, multi-hunk patch, new file, and
  captured direct diff;
- corrupt hunk fixture fails;
- dirty-current-file fixture blocks;
- Ask/Plan/Debug streaming tests still pass;
- `go test -run 'Test.*Patch|Test.*Edit|Test.*Fallback|Test.*Dirty|Test.*Mode' ./internal/ai`.

Accepted when:

- Build cannot complete from chat prose or terminal transcript alone.
- Every edit path produces reviewable artifact or typed blocked/error evidence.

### Phase 3: Model Agent Runtime

Goal:

- Promote existing noTUI providers from plain chat models to first-class
  `model_agent_runtime` adapters.

Inspect first:

- `internal/ai/providers/types.go`
- `internal/ai/providers/ollama.go`
- `internal/ai/providers/openai_compatible.go`
- `internal/ai/model_capabilities.go`
- `internal/ai/model_probe.go`
- `internal/ai/model_probe_ledger.go`
- `internal/ai/provider_runtime.go`
- `internal/ai/chat.go`

Implement:

1. Treat existing provider `Generate` implementations as model adapters under
   the runtime kernel.
2. Move common tool loop, patch proposal, context, Mnemonic, skills, approval,
   and artifact behavior above provider-specific code.
3. Add capability canaries for read-only answer, streaming, mock tool request,
   tiny patch proposal, cancel, and usage when supported.
4. Use canary results to enable, degrade, or disable Build mode per model.
5. Route all model edits through patch fidelity and dirty-state guard.
6. Keep conservative text-only behavior for models that cannot produce
   reviewable edits.

Stop conditions:

- A model cannot be distinguished from not-running/not-configured.
- A model claims Build capability but cannot produce tool call, structured patch,
  captured diff, explicit no-change, or diagnostic evidence.
- A local provider would need broad filesystem or credential access to run.

Verification:

- `go test ./internal/ai/providers`
- focused `go test -run 'Test.*Model|Test.*Probe|Test.*Capability|Test.*Tool|Test.*Patch' ./internal/ai`
- local smoke, when practical: Ollama or LM Studio Ask through
  `model_agent_runtime` with no write permissions.

Accepted when:

- Existing noTUI providers use the same envelope/tool/artifact path as external
  agent runtimes.
- Weak local models fail or degrade honestly instead of faking agent behavior.

### Phase 4: Codex Structured Runtime

Goal:

- Add Codex as the first primary structured agent runtime without making Codex
  the architecture.

Inspect first:

- `internal/ai/agents/codex.go`
- `internal/ai/agents/types.go`
- `internal/ai/agent_runtime.go`
- `internal/ai/chat.go`
- `internal/ai/tool_gateway.go`
- `internal/ai/patch_artifacts.go`

Implement:

1. Detect `codex` path, version, and supported subcommands.
2. Record binary provenance and invalidate capability canaries when version
   changes.
3. Start `codex app-server --listen stdio://` only for normal structured turns.
4. Keep Codex login/trust/update prompts in PTY fallback cards, not normal turn
   automation.
5. Map initialize/thread/turn lifecycle into normalized events.
6. Lower Codex approvals, command execution, file changes, dynamic tools, skills,
   streaming messages, and usage into Arlecchino events, proposals, and artifacts.
7. Use runtime watchdog for startup, heartbeat, cancellation, restart, overload,
   and stale completion suppression.

Stop conditions:

- Codex app-server protocol cannot be mapped without private/undocumented
  endpoints.
- Codex asks for trust/auth/update approval that cannot be represented as a
  blocking GUI card.
- Codex produces direct writes that cannot be captured into reviewable diff
  artifacts.

Verification:

- `go test -run 'Test.*Codex|Test.*Agent|Test.*Runtime|Test.*Watchdog' ./internal/ai ./internal/ai/agents`
- disposable project smoke: Codex Ask produces real envelope and no recurring
  trust/update noise;
- cancellation smoke suppresses stale Codex completion.

Accepted when:

- Codex normal turns run through structured events, not prompted TUI.
- Codex is one adapter under the kernel, not a special AI stack.

### Phase 5: Codex JSONL Bridge

Goal:

- Add bounded non-interactive Codex runs for fast bridge cases and fallback
  automation that does not need a warm app-server session.

Inspect first:

- `internal/ai/agents/codex.go`
- `internal/ai/agents/types.go`
- `internal/ai/agent_runtime.go`
- `internal/ai/chat.go`
- `internal/ai/privacy.go`
- `internal/ai/egress.go`

Implement:

1. Implement `codex exec --json` as `jsonl_exec_runtime`.
2. Pass prompt/context through stdin or safe process input, never argv.
3. Select sandbox by mode: read-only for Ask/Plan/Review, workspace-write only
   for approved Build/Debug fix flows.
4. Parse JSONL into normalized events.
5. Capture final message, usage, command evidence, and diff artifacts.
6. Apply the same proof gate, failure taxonomy, watchdog, patch fidelity, and
   dirty-state guard as app-server/model runtimes.

Stop conditions:

- Prompt/context appears in argv or process list.
- JSONL output cannot be parsed into stable events.
- Sandbox cannot be matched to selected mode.

Verification:

- argv/process-list leak test;
- JSONL fixture replay;
- cancel kills process group;
- Build without artifact fails;
- compare trivial Ask latency against PTY-first path.

Accepted when:

- Codex JSONL is fast, bounded, mode-safe, and not terminal-driven.

### Phase 6: Runtime UI

Goal:

- Make AI Chat render truthful runtime state, not provider-specific terminal
  buffers.

Inspect first:

- `frontend/src/components/ai-chat/AIChatPanel.tsx`
- `frontend/src/components/ai-chat/RunCard.tsx`
- `frontend/src/components/ai-chat/ActivityTimeline.tsx`
- `frontend/src/components/ai-chat/ToolProposalCard.tsx`
- `frontend/src/components/ai-chat/PatchArtifactCard.tsx`
- `frontend/src/components/ai-chat/AgentConsole.tsx`
- `frontend/src/stores/aiChatStore.ts`
- `frontend/src/wails/app.ts`

Implement:

1. Render normalized runtime cards: runtime family, provider, model, transport,
   fallback state, health, consent, sandbox/tool policy, proof gate, and artifact
   status.
2. Render blocking prompts as GUI cards.
3. Render approvals and tool proposals through existing tool UI.
4. Render patches and captured diffs through existing artifact review UI.
5. Move raw transcript into an optional evidence drawer.
6. Remove normal-turn dependencies on `TerminalPanel`, `useTerminalStore`,
   `tuiModeActive`, or `terminal:*` events.
7. Preserve current composer, provider picker, context UI, tool cards, and patch
   review controls.

Stop conditions:

- UI requires provider-specific terminal state to show normal run progress.
- UI would show success before the envelope terminal state and mode-specific
  proof/artifact exist.
- Generated bindings are stale and regeneration is not approved.

Verification:

- `cd frontend && npm run typecheck`
- focused AI chat specs for visible truth, tool approvals, patch cards, and
  inline patch controls;
- browser/app smoke when practical for runtime cards and blocking prompts.

Accepted when:

- The user can see which runtime actually ran and why a run is ready, degraded,
  blocked, cancelled, or failed.

### Phase 7: Additional Adapters

Goal:

- Add additional providers only after the kernel is stable and enforceable.

Inspect first:

- this document's adapter checklist;
- official provider docs for the target adapter;
- `internal/ai/agents/types.go`;
- `internal/ai/agent_runtime.go`;
- provider auth and legal/terms requirements.

Implement:

1. Confirm an official/provider-sanctioned integration surface.
2. Classify transport and endpoint class.
3. Define auth/billing without reading credential stores.
4. Map events into the normalized vocabulary.
5. Prove cancellation, tool approval, egress, patch artifact, watchdog,
   provenance, canary, conformance, memory quarantine, and visible-truth behavior.
6. Keep imported MCP/provider config disabled by default and approval-gated.

Stop conditions:

- The route depends on web UI automation, hidden endpoints, credential replay, or
  unofficial subscription bridging.
- PTY would be the normal prompt path rather than fallback evidence.
- The adapter cannot produce reviewable Build evidence.

Verification:

- adapter conformance suite;
- golden event replay;
- mode regression matrix;
- disposable project smoke;
- no credential-store access check.

Accepted when:

- The adapter behaves like a peer runtime family under the kernel and does not
  create provider-specific governance.

## Verification Gates

Backend:

- descriptor validation rejects missing transport, endpoint class, auth mode,
  legal basis, or source links;
- runtime proof gate rejects missing provider/model/transport/session evidence;
- consent-required path blocks before context egress;
- prompt/context is not passed through argv;
- `Ask`/`Plan` use read-only policy by default;
- structured app-server or JSONL events map into `AIChatRunEnvelope`;
- model runtimes use Arlecchino tool gateway, not provider side effects;
- cancellation kills the process/session and prevents stale completion;
- watchdog bounds startup, idle time, output, event queues, and orphan processes;
- PTY fallback is unavailable for normal turns unless required by auth/trust or
  explicitly selected;
- non-blocking notices are deduplicated;
- failure taxonomy maps adapter/provider errors into stable codes;
- Build requires patch artifact, captured diff, explicit no-change result, or
  diagnostic/test evidence;
- direct writes from external runtimes are captured from a clean baseline and
  get rollback checkpoints;
- patch fidelity service validates every patch/captured diff;
- memory writes from runtime output enter quarantine before Mnemonic.

Frontend:

- AI Chat renders normalized runtime cards, not provider terminal buffers;
- no dependency on `TerminalPanel`, `useTerminalStore`, `tuiModeActive`, or
  `terminal:*` events for normal agent turns;
- external and model runtimes share context disclosure, consent, timeline, tool
  approval, and artifact UI;
- simple read-only `Ask` with Codex produces a real run envelope without
  recurring MCP/update/trust noise;
- login/trust/unsupported approval prompts render as blocking cards;
- raw transcript is optional evidence;
- visible truth UI shows actual runtime family, provider, model, transport,
  fallback state, health, proof gate, consent, sandbox/tool policy, and artifact
  status;
- success is impossible without the required envelope terminal state and
  mode-specific artifact/proof.

Security:

- provider credential files are never read;
- local servers bind loopback by default;
- HTTP/WS/SSE endpoints validate Origin/auth when applicable;
- MCP/tool descriptions are treated as untrusted;
- approval, provider consent, auth state, MCP authorization, mode policy, and
  protected-resource policy remain separate;
- transcripts, egress summaries, logs, and final responses redact secret-like
  values;
- runtime adapter source links and versions are recorded;
- provider binary provenance is captured and capability canaries are invalidated
  when local binaries change;
- untrusted runtime, MCP, terminal, and provider output cannot write durable
  Mnemonic facts directly.

Integration:

- run Codex in a disposable project through app-server or JSONL transport;
- run Ollama or LM Studio through model_agent_runtime with the same tool and
  artifact path;
- prove `mode -> transport -> events -> envelope -> tool/artifact -> validation -> review/rollback -> audit`;
- replay golden provider events through the normalizer;
- run adapter conformance and mode regression suites;
- run capability canaries for the selected runtime/profile;
- compare trivial `Ask` latency against current PTY-first path;
- verify no unofficial backend replay or credential-store access is used.

## Codex Skills For Future Work

Three Codex-native skills now capture the operating procedure for future
implementation:

- `arlecchino-agent-runtime-kernel`: shared runtime contract and implementation
  checklist.
- `arlecchino-runtime-security-review`: security, legal, consent, credential,
  approval, sandbox, and audit checklist.
- `arlecchino-runtime-adapter-research`: provider adapter research pack,
  reference patterns, and implement/bridge/fallback/deny decision.

These are Codex-side skills under `~/.codex/skills`, not repo-local docs, so
future Codex sessions can load them before editing this runtime area.
