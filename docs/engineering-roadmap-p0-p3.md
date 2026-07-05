# Arlecchino Engineering Roadmap P0-P3

Status: internal ignored execution plan.
Date: 2026-05-27.
Git tracking: this file lives under `docs/`, which is ignored by repository
`.gitignore`.

This document turns the product direction into an engineering roadmap. It is not
public copy and not a wishlist. Treat it as a staged implementation plan for
moving Arlecchino toward a JetBrains-grade controlled AI development IDE.

## Positioning Contract

Arlecchino is no longer a local-only product. It has cloud AI provider
integration and external agent runtime paths. The product bet should be:

- controlled cloud-AI and external-agent orchestration;
- project intelligence deep enough to make AI useful inside the IDE;
- visible execution, approvals, policies, patch artifacts, and rollback;
- MCP/ACP/tool governance rather than blind terminal automation;
- JetBrains-level IDE behavior where it matters most.

Local context remains important, but "local-first" alone is not the wedge.

Primary orientation:

- JetBrains is the main quality bar for project intelligence, inspections,
  quick fixes, refactoring, run/test workflows, and agent governance.
- VS Code is the reference for ecosystem openness, custom instructions,
  MCP/tool configuration, and extension familiarity.
- Athas is the reference for lightweight editor workflow, managed external
  agents, ACP wrapper installation, and declarative extension/runtime tooling.

## External References Checked

- JetBrains Junie agent modes, approvals, allowlist, MCP, guidelines:
  https://www.jetbrains.com/help/ai-assistant/junie-agent.html
- JetBrains ACP/external agent activation:
  https://www.jetbrains.com/help/ai-assistant/activate-agents.html
- JetBrains ACP:
  https://www.jetbrains.com/acp/
- JetBrains inspections and quick fixes:
  https://www.jetbrains.com/help/idea/code-inspection.html
  https://www.jetbrains.com/help/idea/resolving-problems.html
- JetBrains completion:
  https://www.jetbrains.com/help/idea/auto-completing-code.html
  https://www.jetbrains.com/help/idea/advanced-code-completion.html
- VS Code custom instructions and AGENTS.md:
  https://code.visualstudio.com/docs/copilot/customization/custom-instructions
- VS Code agent tools and MCP:
  https://code.visualstudio.com/docs/copilot/concepts/tools
- Athas external agents:
  https://athas.dev/docs/external-agents
- Athas extensions and managed tools:
  https://athas.dev/docs/extensions

## Current Arlecchino Anchors

Existing surfaces to build on:

- AI runtime and envelopes:
  - `internal/ai/chat.go`
  - `internal/ai/types.go`
  - `internal/ai/runtime_kernel.go`
  - `internal/ai/agent_runtime.go`
  - `internal/ai/chat_envelope.go`
  - `frontend/src/stores/aiChatStore.ts`
  - `frontend/src/components/ai-chat/**`
- Providers and model discovery:
  - `internal/ai/provider_specs.go`
  - `internal/ai/provider_runtime.go`
  - `internal/ai/providers/**`
  - `internal/ai/provider_oauth.go`
  - `frontend/src/components/ai-chat/ModelPicker.tsx`
  - `frontend/src/components/ai-chat/ProviderPopover.tsx`
- Context, egress, continuity:
  - `internal/ai/context_preparation.go`
  - `internal/ai/context_budget.go`
  - `internal/ai/context_continuity.go`
  - `internal/ai/egress.go`
  - `internal/ai/privacy.go`
  - `internal/ai/mentions.go`
  - `frontend/src/components/ai-chat/ContextSummary.tsx`
  - `frontend/src/components/ai-chat/ContextPickerMenu.tsx`
- Tools, approvals, artifacts:
  - `internal/ai/policy.go`
  - `internal/ai/tool_gateway.go`
  - `internal/ai/tool_approvals.go`
  - `internal/ai/pending_approvals.go`
  - `internal/ai/pending_approval_ledger.go`
  - `internal/ai/tool_audit.go`
  - `internal/ai/tool_schemas.go`
  - `internal/ai/patch_artifacts.go`
  - `frontend/src/components/ai-chat/ToolProposalCard.tsx`
  - `frontend/src/components/ai-chat/PatchArtifactCard.tsx`
- Project/index/code intelligence:
  - `internal/indexer/**`
  - `internal/indexer/core/**`
  - `internal/indexer/brain/**`
  - `internal/indexer/lsp/**`
  - `internal/indexer/adapters/**`
  - `frontend/src/stores/diagnosticsStore.ts`
  - `frontend/src/components/problems/ProblemsPanel.tsx`
  - `frontend/src/components/CodeMirrorEditor.tsx`
- Git, terminal, shell:
  - `frontend/src/stores/gitStore.ts`
  - `internal/indexer/commands_git.go`
  - `internal/terminal/**`
  - `frontend/src/stores/terminalStore.ts`
  - `frontend/src/components/CommandDispatcher.tsx`
  - `frontend/src/hooks/useDispatcher.ts`
- MCP:
  - `internal/mcp/**`

## Roadmap Shape

P0 is the core product foundation. Do not start P1/P2 feature expansion until
P0 has narrow, stable contracts and visible verification.

P0:

- JetBrains-grade project model and code intelligence primitives.
- AI action policy and permission engine.
- Context governance for cloud AI and external runtimes.

P1:

- ACP/runtime registry.
- Context Inspector.
- Agent run timeline, checkpoints, rollback.

P2:

- GitHub/PR workflow.
- Run/test/debug/service configs.
- Declarative extension and managed tooling catalog.

P3:

- Cross-platform release hardening.
- Trusted distribution strategy, explicitly separate from the current beta line.
- Marketplace, enterprise controls, performance lab.

## P0: Project Intelligence, Code Actions, And AI Policy

### P0.1 Project Model

Goal:

Create a durable project model that turns an opened folder into a typed project
graph. This is the base for JetBrains-like intelligence and AI context quality.

New backend package:

- `internal/projectmodel`

Core DTOs:

- `ProjectProfile`
  - project ID, root, primary language, frameworks, package managers,
    detected trust level, last scan timestamp.
- `ProjectModule`
  - module root, language, framework, source roots, test roots, config files.
- `ProjectToolchain`
  - runtime kind, executable path, version, source of detection, install state.
- `RunTarget`
  - command, cwd, env policy, framework, purpose: dev/test/build/lint/debug.
- `TestTarget`
  - kind, package/file/test-name granularity, command template, last result.
- `ServiceEndpoint`
  - name, port, protocol, owner process, preview URL, health status.
- `ProjectHealthFinding`
  - severity, source, message, suggested action, affected file/config.

Detection sources:

- lockfiles: `package-lock.json`, `pnpm-lock.yaml`, `bun.lockb`,
  `go.mod`, `composer.json`, `Gemfile`, `pyproject.toml`, `Cargo.toml`;
- framework files: Laravel, Vite, Next, Rails, Django, Go service layouts;
- existing `internal/indexer/adapters/**`;
- existing terminal history and preview detection;
- Git root and branch state;
- LSP config from `internal/indexer/lsp/configs.go`.

Storage:

- Start in memory with persisted snapshots under project `.arlecchino/`.
- Use a small SQLite table only if invalidation and history require it.
- Never block UI open on full detection; emit partial model updates.

Backend entrypoints:

- `GetProjectProfile(projectID) ProjectProfile`
- `RefreshProjectProfile(projectID, reason) ProjectProfile`
- `ListRunTargets(projectID) []RunTarget`
- `ListTestTargets(projectID) []TestTarget`
- `ListProjectHealthFindings(projectID) []ProjectHealthFinding`

Frontend surfaces:

- Status bar project profile pill.
- Command Dispatcher entries for run/test/build targets.
- AI Context Preview section named `Project model`.
- Problems panel tab for project health findings.

Verification:

- Unit tests for fixture projects under `internal/projectmodel/testdata`.
- Focused integration test that opening a project emits a partial profile before
  full indexing completes.
- Frontend typecheck after binding generation if Wails DTOs change.

Stop conditions:

- Do not add run targets that execute package-manager install commands without
  explicit user approval.
- Do not infer cloud credentials or provider accounts from files.
- Do not make project open depend on slow package manager commands.

### P0.2 Code Intelligence And Intentions

Goal:

Move from diagnostics display to IDE actions: quick fixes, intentions,
auto-import, and safe refactor previews.

Primary inspiration:

- JetBrains `Alt+Enter`, inspections, quick-fixes, type-aware completion,
  auto-import, and project-wide problem views.

New backend package:

- `internal/codeactions`

Core DTOs:

- `CodeActionRequest`
  - projectID, filePath, range, cursor, diagnostics, trigger kind.
- `CodeAction`
  - id, title, kind, risk, source, previewable, requiresApproval.
- `WorkspaceEditPreview`
  - file edits, import edits, rename edits, delete/create operations,
    conflict status.
- `InspectionFinding`
  - stable ID, severity, scope, file, range, source, quickFix IDs.
- `RefactorPlan`
  - operation, affected symbols, affected files, preview edits, blockers.

Backend implementation steps:

1. Wrap LSP `textDocument/codeAction` behind a normalized `CodeAction` model.
2. Add native quick fixes for imports using existing
   `internal/indexer/brain/autoimport.go`,
   `internal/indexer/brain/import_resolver.go`, and
   `internal/indexer/brain/import_edit_planner.go`.
3. Add project-scope inspection runners:
   - unused imports when known;
   - unresolved symbols where LSP/index data agrees;
   - missing framework files/routes/config for known frameworks;
   - stale generated/runtime config warnings.
4. Add `ApplyCodeActionPreview` that always returns a patch-like preview first.
5. Add safe refactor MVP:
   - rename symbol for language servers that support it;
   - rename file/path references where indexer can prove references;
   - extract variable/function later, not in P0.

Frontend implementation steps:

1. Add `Alt+Enter` / bulb UI in `CodeMirrorEditor.tsx`.
2. Add `CodeActionPopover` with grouped actions:
   - Quick Fix
   - Intention
   - Refactor
   - AI Assist
3. Route preview through the existing patch artifact UI before mutation.
4. Add Problems panel actions:
   - fix one;
   - fix all in file;
   - fix all safe in scope;
   - ask AI with this finding.

AI integration:

- AI may propose a code action, but native deterministic actions should appear
  first.
- AI-generated fixes must still create `WorkspaceEditPreview` or patch artifact.
- The final write boundary is user acceptance, not assistant prose.

Verification:

- `go test ./internal/indexer/brain ./internal/indexer/lsp`
- Add focused tests for normalized code action conversion and import edits.
- `cd frontend && npm run typecheck`
- Focused Playwright or component tests for bulb/popover when practical.

Stop conditions:

- Do not apply multi-file edits without preview.
- Do not use `as any` or frontend type suppression to bridge generated DTO drift.
- If a language server returns edits outside project root, block and show why.

### P0.3 AI Action Policy Engine

Goal:

Replace scattered approval behavior with a typed policy engine covering terminal
commands, file edits, Git, MCP tools, provider egress, and external runtimes.

Primary inspiration:

- JetBrains Junie Ask/Code modes and Action Allowlist.
- VS Code tool enable/disable controls.
- Arlecchino's existing approval ledger and patch artifacts.

New backend package:

- `internal/policy`

Core DTOs:

- `ActionPolicy`
  - projectID, mode, defaultBehavior, rules, updatedAt, source.
- `ActionRule`
  - id, actionKind, matcher, decision, scope, expiresAt, createdFromRunID.
- `ActionEvaluation`
  - decision: allow | ask | block
  - reason
  - matchedRuleIDs
  - risk flags
  - required approval payload.
- `ActionKind`
  - file.read
  - file.edit
  - file.create
  - file.delete
  - terminal.run
  - git.read
  - git.write
  - mcp.tool
  - provider.egress
  - runtime.install
  - runtime.invoke

Matcher model:

- exact command;
- command prefix;
- safe regex with parser-level validation;
- file glob rooted at project;
- MCP server/tool name;
- provider/model class;
- context category;
- run mode.

Default policies:

- Ask mode: allow reads inside project, ask before sensitive reads, block writes.
- Plan mode: allow reads, block writes, ask for optional command evidence.
- Build mode: ask for writes/commands unless allowlisted.
- Debug mode: ask for commands, allow read-only diagnostics.
- Review mode: read-only by default.

Backend integration points:

- `internal/ai/tool_gateway.go`
- `internal/ai/tool_approvals.go`
- `internal/ai/pending_approval_ledger.go`
- `internal/ai/tool_mcp_subagent.go`
- `internal/terminal/agent_launch.go`
- `frontend/src/stores/gitStore.ts` backend Git methods when called by AI.

Frontend surfaces:

- Policy section in AI settings.
- "Allow this once", "Always allow exact command", "Always allow similar",
  "Block this kind" from tool proposal cards.
- Policy diagnostics view showing why an action was allowed/asked/blocked.
- No global "brave mode" as the default path; if added later, it must be
  visually loud, scoped, and time-limited.

Verification:

- Table tests for command matcher safety:
  - no shell chaining;
  - no redirects unless explicitly allowed;
  - no variable expansion by broad regex;
  - no path escape outside project.
- Existing AI approval tests plus new policy evaluation tests.
- MCP tool policy tests.

Stop conditions:

- Do not allow regex rules without a check-command preview.
- Do not let provider-native tools bypass Arlecchino policy.
- Do not store approval codes or secrets in audit logs.

### P0.4 Context Governance For Cloud AI

Goal:

Make cloud AI usage inspectable and controllable. Context governance is now a
core product surface, not a privacy footnote.

Core DTOs:

- `ContextManifest`
  - runID, providerID, modelID, mode, items, token estimate, redactions,
    blocked items, policy decisions.
- `ContextManifestItem`
  - kind, label, path, source, included, reason, byte estimate, token estimate,
    sensitivity flags.
- `ProviderEgressPreview`
  - endpoint class, auth mode, data categories, provider retention link,
    user consent state.
- `VisibleIDESnapshot`
  - active file, selection, visible panels, diagnostics summary, git summary,
    terminal summary, preview state, recent IDE actions.

Backend implementation:

1. Promote current context preview into a persisted `ContextManifest` per run.
2. Add `VisibleIDESnapshot` capture from frontend state, redacted and budgeted.
3. Extend `internal/ai/egress.go` to link provider calls to manifest item IDs.
4. Apply `.aiignore`, `AGENTS.md`, repo rules, and explicit user excludes
   before provider calls.
5. Keep raw snippets out of normal logs; store disclosure metadata separately
   from content where possible.

Frontend implementation:

- Replace flat context preview with a Context Inspector:
  - included;
  - excluded;
  - redacted;
  - token cost;
  - provider destination;
  - why included.
- Add per-run "what was sent" view after completion.
- Add quick toggles for context categories:
  - file;
  - selection;
  - workspace;
  - git diff;
  - diagnostics;
  - terminal;
  - memory;
  - MCP state.

Verification:

- Unit tests for redaction and ignore rules.
- Egress tests proving every provider request has a manifest ID.
- Frontend typecheck and focused AI context UI test.

Stop conditions:

- Do not send secrets, `.env`, credentials, keychains, or ignored sensitive paths.
- Do not silently include terminal output in cloud requests.
- If token estimation fails, display unknown and require explicit consent for
  broad context.

## P1: ACP Runtime, Context Inspector, Timeline, Rollback

### P1.1 ACP And Runtime Registry

Goal:

Make Arlecchino a provider-neutral control plane for cloud providers, local
models, and external agents. Codex stays one adapter, not the architecture.

Primary inspiration:

- Athas managed external agents and ACP wrapper installation.
- JetBrains ACP agents in AI Assistant.

New package:

- `internal/ai/acp`

Core DTOs:

- `RuntimeDescriptor`
  - id, displayName, kind, transport, authModes, capabilities, install state.
- `RuntimeCapability`
  - chat, plan, build, debug, review, patch, terminal, mcp, streaming,
    cancellation, checkpoint, modelSelection.
- `RuntimeInstallPlan`
  - managed command, required runtime, download/install source, checksum,
    post-install auth step.
- `RuntimeSession`
  - runtimeID, projectID, mode, model, status, transport, auth state.

Implementation steps:

1. Extract current runtime descriptors from `internal/ai/agent_runtime.go` and
   provider specs into a common registry.
2. Add ACP client process launcher with stdio transport and strict project cwd.
3. Add adapter conformance tests using recorded JSONL/ACP fixtures.
4. Add managed-install metadata, but keep installs approval-gated.
5. Add runtime health checks:
   - binary exists;
   - version compatible;
   - auth state known;
   - project trust accepted;
   - model list available when applicable.
6. Expose runtime picker UI in AI Chat.

Verification:

- `go test ./internal/ai ./internal/ai/agents`
- ACP fixture tests for happy path, auth missing, malformed event,
  cancellation, and tool proposal.
- Frontend typecheck.

Stop conditions:

- Do not automate web UIs.
- Do not read provider credential stores directly.
- Do not pass prompt/context through argv.
- Do not mark a runtime available until a real health check passes.

### P1.2 Context Inspector

Goal:

Turn context preview into a first-class debugger for AI behavior.

Implementation:

- Add a `ContextInspector` panel under AI Chat.
- Support before-run and after-run modes.
- Group by source:
  - visible IDE snapshot;
  - selected files;
  - diagnostics;
  - git diff;
  - terminal facts;
  - memory;
  - project model;
  - MCP state;
  - instructions.
- Show inclusion reason, token estimate, provider destination, policy decision.
- Allow user to pin/exclude items for this run.
- Persist user exclusions per project when requested.

Backend:

- Extend `AIContextSnapshot` rather than making a parallel context stack.
- Link `ContextManifest` to `AIEgressRecord`.

Verification:

- Context budget tests.
- Egress record tests.
- UI snapshot/component tests for included/excluded/redacted states.

### P1.3 Agent Timeline, Checkpoints, Rollback

Goal:

Make agent work inspectable and reversible. The user should see what happened,
what changed, what was approved, and how to revert.

Core DTOs:

- `AgentRunTimeline`
  - runID, events, approvals, commands, patches, diagnostics, tests, review.
- `AgentCheckpoint`
  - project dirty baseline, files touched, git baseline, timestamp, run mode.
- `RollbackPlan`
  - patch reverse plan, file restore set, blocked paths, conflicts.

Backend implementation:

1. Capture dirty-state baseline before Build/Debug runs.
2. Store timeline events in the existing run envelope path.
3. Require Build success evidence:
   - patch artifact;
   - captured diff;
   - explicit no-change result;
   - diagnostic/test evidence;
   - blocked/error evidence.
4. Add rollback preview from checkpoint.
5. Keep rollback approval-gated.

Frontend implementation:

- Add Run Timeline view to `RunCard`/`ActivityTimeline`.
- Add "Revert this run" action when checkpoint exists.
- Add evidence badges:
  - files changed;
  - commands run;
  - tests run;
  - approvals granted;
  - provider calls;
  - patch artifacts.

Verification:

- Dirty baseline tests.
- Patch reverse tests with conflicts.
- UI typecheck and focused AI timeline tests.

Stop conditions:

- Do not claim Build success from prose alone.
- Do not auto-rollback without user approval.
- Do not overwrite user edits made after the checkpoint without conflict UI.

## P2: GitHub, Run Configs, Services, Extension Catalog

### P2.1 GitHub And PR Workbench

Goal:

Match the daily workflow depth users expect from VS Code, Athas, and JetBrains:
not just Git status, but PR, review, checks, conflicts, and AI-aware change
sets.

Implementation:

- Add GitHub connector abstraction:
  - auth state;
  - repository mapping;
  - issues;
  - pull requests;
  - checks;
  - review comments.
- Extend Git store with:
  - changelists/task changes;
  - worktree awareness;
  - conflict state;
  - PR branch relationship.
- Add AI entrypoints:
  - review this PR;
  - summarize changes;
  - fix failing check;
  - respond to review comment;
  - generate commit message.
- Add Commit Checks:
  - run tests;
  - run formatter;
  - run AI review;
  - block commit if configured checks fail.

Likely files:

- `frontend/src/stores/gitStore.ts`
- Git backend methods around `RunGitCommand`
- new `internal/github` or connector-backed service
- AI review workflow in `internal/ai/workflow.go`

Verification:

- Git parser tests.
- Mock GitHub API tests.
- Focused frontend typecheck and Git panel tests.

Stop conditions:

- Do not require GitHub for normal Git use.
- Do not push, merge, or submit reviews without explicit approval.
- Do not store OAuth tokens in project files.

### P2.2 Run, Test, Debug, And Services

Goal:

Create JetBrains-like operational workflow: run configs, test configs, dev
services, logs, preview, and debugger routing.

Implementation:

- Build on P0 `RunTarget` and `TestTarget`.
- Add run configuration model:
  - command;
  - cwd;
  - env profile;
  - before-run tasks;
  - terminal ownership;
  - preview URL;
  - stop command;
  - health check.
- Add service registry:
  - running process;
  - port;
  - owner project;
  - logs;
  - preview link;
  - restart/stop.
- Add test explorer:
  - discovered test suites;
  - last result;
  - run file/test/package;
  - AI explain failure.
- Add DAP later after run/test model stabilizes.

Likely files:

- `internal/terminal/**`
- `frontend/src/stores/terminalStore.ts`
- `frontend/src/components/CommandDispatcher.tsx`
- new `internal/runconfig`
- new frontend service/test panels.

Verification:

- Run config parser tests for fixtures.
- Terminal lifecycle tests.
- Frontend typecheck and focused workflow smoke.

Stop conditions:

- Do not run install/build commands automatically from project detection.
- Do not kill user-owned processes without explicit ownership and approval.
- Do not expose env secrets in UI, logs, or AI context.

### P2.3 Declarative Extension And Managed Tool Catalog

Goal:

Avoid hardcoding every language, tool, provider, and agent in core. Adopt an
Athas-like declarative extension model while keeping execution constrained.

Manifest model:

- `extension.json`
  - id, publisher, version, engines, categories;
  - contributes.languages;
  - contributes.snippets;
  - contributes.themes;
  - contributes.icons;
  - contributes.commands;
  - contributes.keybindings;
  - contributes.agents;
  - capabilities.lsp;
  - capabilities.formatter;
  - capabilities.linter;
  - capabilities.parser;
  - capabilities.runtime;

Implementation:

1. Add manifest parser and schema validation.
2. Start with built-in local manifests, not remote marketplace execution.
3. Move language/tool metadata toward declarative manifests.
4. Add managed tool installer for LSP/formatter/linter/agent binaries.
5. Keep arbitrary extension code out of process for now.
6. Add catalog UI under Settings.

Likely packages:

- `internal/extensions`
- `internal/lsp/installer.go`
- `internal/indexer/adapters/**`
- `frontend/src/components/SettingsModal.tsx`

Verification:

- Manifest schema tests.
- Tool install plan tests.
- No arbitrary script execution in extension install path.

Stop conditions:

- Do not run downloaded extension code in the editor process.
- Do not install tools without checksum/source metadata and user approval.
- Do not break existing built-in language support during manifest migration.

## P3: Release, Marketplace, Enterprise, Performance Lab

### P3.1 Cross-Platform Release Hardening

Goal:

Turn macOS-first beta into a credible multi-platform release without pretending
Wails packaging is the whole answer.

Implementation:

- macOS:
  - Developer ID signing and notarization will be added soon, with no date
    committed;
  - stable updater channel;
  - installed-app smoke tests;
  - Keychain/provider credential verification.
- Windows:
  - WebView2 bootstrap story;
  - installer path;
  - terminal PTY behavior;
  - file associations;
  - signing plan.
- Linux:
  - distro/runtime matrix;
  - AppImage/deb/rpm decision;
  - PTY and native dependency probes;
  - sandbox/path assumptions.

Verification:

- Package smoke per OS.
- No local path leakage.
- Signature/trust checks.
- Minimal open-project/edit/terminal/AI settings smoke.

Stop conditions:

- Do not call Windows/Linux releasable until packaged smoke passes on target OS.
- Do not expose private updater or local machine paths in public artifacts.

### P3.2 Marketplace And Extension Distribution

Goal:

Move from internal manifests to a public, signed, reviewable catalog.

Implementation:

- Static catalog with signed manifest index.
- Extension package checksums.
- Trust levels:
  - built-in;
  - official;
  - community declarative;
  - external tool installer;
  - disabled/untrusted.
- Review pipeline:
  - schema validation;
  - no arbitrary code for declarative packages;
  - tool source/checksum validation;
  - security metadata.
- Settings UI:
  - install/uninstall;
  - update;
  - view permissions;
  - disable.

Verification:

- Catalog signature tests.
- Manifest compatibility tests.
- Install/uninstall smoke.

Stop conditions:

- Do not execute marketplace extension code until a constrained extension host
  exists.
- Do not auto-update managed tools without a visible policy.

### P3.3 Enterprise And Team Controls

Goal:

Make Arlecchino useful for teams that allow cloud AI only under policy.

Implementation:

- Organization policy file:
  - allowed providers;
  - allowed models;
  - disallowed data categories;
  - required approvals;
  - required audit export;
  - allowed MCP servers;
  - allowed external runtimes.
- Audit export:
  - provider calls;
  - context manifests;
  - approvals;
  - tool calls;
  - patch artifacts;
  - run evidence.
- Team instructions:
  - AGENTS.md;
  - `.aiignore`;
  - repo policy;
  - per-language instructions.
- Admin-visible diagnostics:
  - provider auth mode;
  - egress categories;
  - blocked rule reason.

Verification:

- Policy precedence tests.
- Audit redaction tests.
- Provider/model block tests.

Stop conditions:

- Do not advertise enterprise readiness before policy enforcement is hard and
  auditable.
- Do not implement telemetry by default.

### P3.4 Performance Lab

Goal:

Keep the WebView/Wails stack from feeling like a wrapped website. Performance
must be measured as product behavior, not defended rhetorically.

Budgets:

- cold launch to first useful paint;
- project open to visible shell;
- project model partial result latency;
- indexing start latency;
- editor input latency;
- terminal scroll/input latency;
- Command Dispatcher open latency;
- AI context preview latency;
- patch artifact render latency.

Implementation:

- Add repeatable perf fixtures:
  - small project;
  - medium web app;
  - large monorepo;
  - many diagnostics;
  - large Git diff;
  - long terminal output.
- Add browser/dev smoke and packaged-app smoke separately.
- Add perf counters to `frontend/src/stores/performanceStore.ts`.
- Add backend timings for indexer/project model/AI context.
- Keep geometry-stable adaptive behavior under pressure.

Verification:

- Focused Playwright perf tests where browser truth is enough.
- Native packaged smoke for launch/menu/focus/terminal behavior.
- Regression threshold reports in CI or release smoke.

Stop conditions:

- Do not optimize by removing visible user-enabled features without an explicit
  adaptive-mode contract.
- Do not rely on browser preview for native-shell truth.

## Suggested Implementation Order

1. P0.3 AI Action Policy Engine
   - Highest risk reducer.
   - Enables safer agent expansion.
2. P0.4 Context Governance
   - Makes cloud AI truthful and inspectable.
   - Required before broad provider/runtime expansion.
3. P0.1 Project Model
   - Gives both IDE and AI a stable understanding of the project.
4. P0.2 Code Actions And Intentions
   - Turns project intelligence into daily user value.
5. P1.1 ACP Runtime Registry
   - Expand runtime surface after policy/context gates exist.
6. P1.3 Timeline And Rollback
   - Make Build/Debug runs reversible and evidence-driven.
7. P1.2 Context Inspector
   - Polish and deepen the context governance UX.
8. P2.2 Run/Test/Services
   - Build JetBrains-like operational workflows on project model.
9. P2.1 GitHub/PR Workbench
   - Extend Git into external collaboration after local Git is stable.
10. P2.3 Extension Catalog

- Reduce core hardcoding after built-in behavior is proven.

11. P3 release/marketplace/enterprise/perf lab

- Hardening and scale-out.

## Global Verification Matrix

Backend narrow checks:

```bash
go test ./internal/ai ./internal/ai/agents ./internal/ai/providers
go test ./internal/indexer/... ./internal/lsp ./internal/terminal ./internal/mcp
```

Frontend narrow checks:

```bash
cd frontend && npm run typecheck
cd frontend && npx prettier --check src/path/to/changed-file.tsx
```

Runtime/browser checks:

```bash
cd frontend && ARLECCHINO_TEST_WAILS_RUNTIME=1 npm run dev
cd frontend && npx playwright test <focused-spec> --workers=1
```

Packaged app checks:

```bash
./scripts/wails3-local-release-macos.sh
./scripts/wails3-release-smoke-macos.sh --report /tmp/arlecchino-release-smoke.json
```

Use packaged smoke for native-shell behavior: Dock, menus, focus, open intents,
notifications, Keychain, file associations, and updater truth.

## Design Rules

- Do not build a second AI stack. Extend `AIChatRunRequest ->
AIContextSnapshot -> provider/runtime -> AIChatRunEnvelope -> artifacts`.
- Deterministic IDE actions beat AI actions when both exist.
- Every provider call should have a context manifest.
- Every sensitive action should pass through typed policy evaluation.
- Every file mutation from AI should be previewable and auditable.
- Every Build success should have evidence beyond prose.
- Every runtime should expose truth: provider, model, transport, auth state,
  fallback state, and limitations.
- Project model updates should be incremental and non-blocking.
- Extension manifests can declare capabilities, but arbitrary extension code is
  out of scope until a constrained host exists.

## Open Engineering Questions

- Which languages/frameworks are P0 golden paths: Laravel/PHP, TypeScript/Vite,
  Go, or another pair?
- Should policy rules live in project `.arlecchino/`, repository files, app
  settings, or all three with precedence?
- Should ACP be introduced as a new adapter under current runtime kernel or as a
  sibling transport package first?
- What is the first public promise for rollback: reverse patch only, checkpoint
  restore, or Git worktree-backed task isolation?
- Do we want a JetBrains-like "safe mode / trusted project" gate before managed
  tool install and run configs?
