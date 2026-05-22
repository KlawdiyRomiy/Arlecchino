<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="Arlecchino">
</p>

<h1 align="center">Arlecchino</h1>

<p align="center">
  A local-first desktop IDE beta for building software with integrated AI assistance.<br>
  Go backend, React frontend, floating tools, AI Chat, and built-in MCP control.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Wails-v3.0.0--alpha.87-EB4034" alt="Wails v3.0.0-alpha.87">
  <img src="https://img.shields.io/badge/Platform-macOS%20beta-000000?logo=apple&logoColor=white" alt="macOS beta">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## Beta Status

Arlecchino is now a **macOS-first IDE Beta**, built on
**Wails v3.0.0-alpha.87**.

The beta keeps the editor shell, terminal/workspace flow, floating panels,
Git/preview surfaces, local-first defaults, and MCP control as the foundation.
It now also includes the integrated AI surface: AI Chat, provider/model
selection, context preview, consent gates, approval-gated tool review,
reviewable patch artifacts, optional passive editor predictions, and a
Codex-backed external agent runtime path.

This is not a GA/stable AI IDE yet. AI availability depends on configured
providers, model capability, user consent, approval settings, and the selected
runtime. Background agents are preview-only, embeddings/RAG are disabled, and
some advanced runtime flows remain gated while the beta hardens.

There is no Apple Developer ID signing or notarization yet. The primary path is
source checkout for technical users; ad-hoc DMG/ZIP artifacts are convenience
tester builds and may require manual approval in macOS Privacy & Security.

---

## What Ships In Beta Now

### Bubble Shell And Panels

Demo video: TBD - add a short clip showing panel open, snap, float, move, and
restore behavior.

- Rounded shell chrome with a calmer, darker bubble-style interface
- Floating and snapped panels for Explorer, Terminal, Git, Problems
- Per-project panel layouts and workspace state
- A serious dense IDE layout, not a generic web dashboard

### Command Palette And Terminal Dispatcher

Demo video: TBD - add a short clip showing `Cmd+F`, `>` commands, `@t `
terminal dispatch, and TUI-aware terminal behavior.

- `Cmd+F` opens the command palette / search bar
- Plain search for files
- `>` for IDE commands
- `@t ` for terminal-mode command dispatch with ghost text prediction
- TUI-aware terminal flow for tools like `vim`, `htop`, and `less`

### Editor And Navigation

Demo video: TBD - add a short clip showing editing, diagnostics, hover,
signature help, minimap, split views, and file navigation.

- CodeMirror 6 editor
- Multi-language editing with LSP integration
- Inline diagnostics, hover, signature help, minimap, split views
- Quick file relations and dependency graph flows
- Multi-project workspace and tab history

### Built-In IDE Tools

Demo video: TBD - add a short clip showing Explorer, Problems, Git, Browser
Preview, project switching, and settings.

- Explorer
- Problems panel
- Git panel with details and diff views
- Browser Preview
- Status bar, settings, project switching

### MCP Integration

Demo video: TBD - add a short clip showing an external coding agent reading IDE
state, opening a file/panel, and hitting the approval boundary for a mutating
action.

Arlecchino ships with a built-in MCP server so external coding agents can interact with the IDE through a controlled protocol surface.

That includes:

- file operations
- terminal orchestration
- project and layout control
- preview and panel control
- audit-aware sensitive access boundaries

### Integrated AI Surface

Demo video: TBD - add a short clip showing AI Chat, provider/model selection,
context preview, consent gates, tool proposal review, patch preview, and an
optional editor prediction.

Arlecchino now ships an integrated AI surface wired to the backend runtime:

- AI Chat panel with `Ask`, `Plan`, `Build`, `Debug`, and `Review` modes
- provider/model selection for local, BYOK/API-key, and external agent runtimes
- context preview and disclosure before provider calls
- local egress records without storing full prompts or provider responses
- approval-gated tool proposals for file, terminal, MCP, and subagent-preview
  flows
- reviewable patch artifacts with apply and rollback paths
- project-local Mnemonic memory with reviewed/trusted entry handling
- optional passive editor AI predictions behind provider and consent gates
- Codex CLI runtime integration behind the same consent, run-envelope, artifact,
  and audit surfaces

---

## Experimental / Partial

These parts exist, but they should not be described as fully finished yet:

- **Predictive autocomplete / ARLE brain**

  Demo video: TBD - add a short clip showing local autocomplete/ranking in a
  project where the current beta behavior is representative.

  The ranking and suggestion pipeline is real, but consistency still varies by language and project shape.

- **AI chat panel**

  Demo video: TBD - add a focused clip after provider setup and tool-review
  paths are representative.

  The panel is now real and wired to backend chat runs, but provider setup,
  model capability, consent, tool support, and runtime coverage still vary. Do
  not market this beta as a finished autonomous AI IDE.

- **Agent/runtime coverage**

  Background agents are preview-only. The built-in external-agent path is
  currently centered on Codex CLI; do not describe the beta as a generic
  multi-agent runtime.

---

## Quick Start (macOS beta)

### Prerequisite 0

You should already have:

- Xcode Command Line Tools
- Homebrew

If either one is missing, install it first and then come back.

### Clone

```bash
git clone https://github.com/KlawdiyRomiy/Arlecchino.git
cd Arlecchino
```

### Bootstrap

```bash
./scripts/bootstrap-dev-macos.sh
```

What the bootstrap does:

- installs the core dev toolchain needed for local beta development
- installs recommended extras for a better beta experience
- runs `go mod download`
- runs `npm ci` inside `frontend/`
- prints a summary of what is installed, already present, or optional

### Run

```bash
./scripts/wails3-dev-macos.sh
```

This is the canonical beta dev path on `main`.

`./scripts/wails3-dev-macos.sh` builds the Wails v3 app through the
repo-local Go module, runs the frontend build, writes output under
`/tmp/Arlecchino-wails-build`, and owns child-process cleanup for stale dev MCP
server processes.

This is an **early technical beta** path:

- source checkout first
- no Apple Developer signing
- no notarization
- no frictionless trusted macOS installer yet
- ad-hoc DMG/ZIP artifacts are convenience builds, not trusted
  notarized distribution

Unsigned local beta bundles or DMGs may require macOS Privacy & Security ->
Open Anyway. That is expected for this early beta path until an Apple
Developer signing and notarization flow exists.

### Build Local Beta Artifacts

```bash
./scripts/wails3-local-alpha-release-macos.sh
```

This currently uses the historical local-alpha packaging script name, but it
creates ad-hoc local/tester macOS artifacts such as `Arlecchino.app`,
`arlecchino-macos-universal.zip`, JSON release evidence, and optionally
`arlecchino-macos-universal.dmg`. These artifacts are for local/tester beta
use until Developer ID signing and notarization are available.

---

## Dependency Model

### Required For App Boot

These are the dependencies the bootstrap treats as required:

- `go`
- `node@22`
- `npm`
- `go mod download`
- `frontend/npm ci`
- Wails v3 is resolved from the pinned Go module in `go.mod`

If one of these cannot be installed or resolved, the bootstrap exits with a clear instruction instead of pretending everything is fine.

Arlecchino's beta toolchain intentionally prefers **Node.js 22 LTS** instead of the newest Homebrew `node`. That keeps `npm ci`, `vite`, and Wails frontend packaging reproducible for this repo.

The legacy Homebrew `wails` CLI may still be present for older wrappers and
diagnostics, but the current `main` source runner is
`./scripts/wails3-dev-macos.sh`.

### Recommended Extras Installed By Bootstrap

These are not hard blockers for app boot, but they make the beta feel closer to the intended experience:

- `carapace`
- `onnxruntime`
- `gopls`
- `typescript-language-server`
- `pyright`
- `vscode-langservers-extracted`
- `yaml-language-server`
- `bash-language-server`
- `dockerfile-language-server-nodejs`

### Optional / Later

These stay outside the default beta bootstrap:

- `php`, `composer`, `phpactor`
- Rust toolchain and Rust analyzers
- Ruby / Solargraph
- Terraform, Lua, Kotlin, Scala, and other language-specific chains

Some of these can still be installed later from Arlecchino's language server flows or manually through your own environment.

See [docs/lsp-supply-chain.md](docs/lsp-supply-chain.md) for the language
server and toolchain supply-chain policy.

### ONNX Runtime Note

`onnxruntime` is **not** a hard blocker for starting Arlecchino.

If it is missing, the app still boots and falls back away from the ONNX-backed path. Installing it simply gives the autocomplete stack access to the faster ML backend where available.

The bundled ARLE model artifacts are tracked in
[docs/model-provenance.md](docs/model-provenance.md). The beta release keeps
the model bundled for local autocomplete ranking; release gates and the
remaining memorization check are recorded in that document.

---

## Privacy And Data

Arlecchino's beta builds are intended to run locally without product analytics
or accounts. Cloud AI and external agent runtimes are optional and require
explicit provider configuration, consent, and runtime gates. Project indexes,
workspace state, MCP audit logs, AI run metadata, provider settings, and
editor/runtime state may be stored locally to support IDE features.

See [docs/privacy-policy.md](docs/privacy-policy.md) for the beta privacy
policy and AI provider disclosure rules.

See [docs/release-alpha-checklist.md](docs/release-alpha-checklist.md) for the
Beta, source checkout, and unsigned DMG release gates.

---

## Wails v3 Alpha Shell Track

Arlecchino's current `main` branch is already on Wails v3 alpha. The Wails v3
dependency remains alpha-quality because Wails v3 itself is still on the alpha
docs track and some native delivery surfaces are intentionally gated. This is
an upstream/runtime dependency status, not the product release status.

The current strategy is:

- keep `main` on the pinned **Wails v3.0.0-alpha.87** module
- use `./scripts/wails3-dev-macos.sh` for source runs
- keep generated bindings controlled by `./scripts/wails3-generate-bindings.sh`
- keep detached/native delivery surfaces gated until their smoke evidence is
  release-ready

The Wails v3 shell work supports:

- multi-window applets
- detached terminal / preview/helper windows behind gates
- native menus and context menus
- tray and notifications
- single-instance handling
- custom protocols and file associations
- updater / release plumbing
- future material backends such as Liquid Glass on supported macOS

See [docs/wails-v3-spike.md](docs/wails-v3-spike.md) for the current Wails v3
shell status and release gate.

---

## Tech Stack

| Layer    | Technology                    |
| -------- | ----------------------------- |
| Backend  | Go 1.26                       |
| Frontend | React 19, TypeScript (strict) |
| Editor   | CodeMirror 6                  |
| Desktop  | Wails v3.0.0-alpha.87         |
| Database | SQLite with GORM              |
| Parsing  | Tree-sitter                   |
| Terminal | xterm.js + PTY                |
| Styling  | Tailwind CSS v4               |
| State    | Zustand                       |

---

## License

[MIT](LICENSE)
