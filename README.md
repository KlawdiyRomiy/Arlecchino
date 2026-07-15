<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="Arlecchino">
</p>

<h1 align="center">Arlecchino</h1>

<p align="center">
  A Go-powered desktop project workbench for code, terminal, Git, previews,
  diagnostics, and visible AI-assisted actions.<br>
  Current beta builds ship on macOS first. Windows and Linux are planned targets.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Wails-v3%20alpha-EB4034" alt="Wails v3 alpha">
  <img src="https://img.shields.io/badge/Platform-macOS%20beta%20now-000000?logo=apple&logoColor=white" alt="macOS beta now">
  <img src="https://img.shields.io/badge/Targets-Windows%20%2F%20Linux%20planned-555555" alt="Windows and Linux planned">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## Positioning

Arlecchino is a dense desktop workbench that keeps the project visible while
editing, terminal work, search, previews, Git, diagnostics, and approved
AI/MCP actions happen in context.

The current public beta ships first on macOS. Windows and Linux are planned
release targets, but they are not current beta platforms.

## What Makes It Different

- **Project workbench.** The editor sits inside a desktop shell with snapped,
  floating, and fullscreen panels for Explorer, Terminal, Git, Problems, Code,
  Markdown Preview, and local preview surfaces.
- **Perspective navigation.** Explorer files can open a full Dependency Tree or
  a mini Quick Relations menu, while editor definitions can open either directly
  or as a Quick Look preview.
- **One dispatcher.** `Cmd+Shift+F` routes search, IDE commands, file search,
  grep, symbol search, terminal dispatch, and AI prompts from one command
  surface.
- **Guarded code intelligence.** Completion combines CodeMirror, LSP, local and
  indexed symbols, guarded apply/resolve behavior, and a local candidate
  ranker. Quality still depends on language-server coverage.
- **Visible AI and MCP.** AI Chat, external runtimes, and MCP control are
  approval-oriented surfaces with context, provider/runtime state, tool
  proposals, and patch artifacts visible before files change.
- **Go and Wails foundation.** Arlecchino uses a Go backend for local IDE
  services and Wails for the desktop shell. Wails v3 is an upstream alpha
  dependency.

## Status

Arlecchino is a **macOS open beta**. The beta is already useful as a desktop
IDE: editor, Command Dispatcher, terminal, panels, Git, previews, project
switching, MCP control, AI Chat, and deterministic completion/ranking are all
part of the current product surface.

AI features still depend on the provider, model, consent settings, and runtime
you configure. Background agents remain preview-only, and embeddings/RAG are off
in this build.

Current artifacts are not Apple Developer ID signed and are not notarized.
Install `Arlecchino.app` from the DMG and launch the installed app. Gatekeeper
may warn that macOS cannot verify the developer or scan the app.

## DMG Launch Path

Use the macOS beta DMG from the release artifacts:

1. Open the DMG.
2. Copy `Arlecchino.app` to `/Applications`.
3. Launch `/Applications/Arlecchino.app`.

On first launch, macOS may block the app because it is unsigned and not
notarized. If you trust the beta artifact, use the macOS Gatekeeper override:

- Open **System Settings -> Privacy & Security**.
- Find the blocked Arlecchino warning.
- Choose **Open Anyway**, then confirm the launch.

## What It Includes

- A dense desktop IDE shell with floating, snapped, and fullscreen panels.
- CodeMirror 6 editing with LSP-backed diagnostics, hover, signature help,
  navigation flows, deterministic completion, and guarded apply/resolve paths.
- Explorer, Problems, Git, Browser Preview, Markdown Preview, terminal, Code
  panel, status, settings, and multi-project switching surfaces.
- Perspective Mode for project navigation: `Cmd+Click` a file in Explorer to
  open the Dependency Tree, or `Option+Click` a file to open the mini Quick
  Relations menu.
- Definition navigation in the editor: `Cmd+Click` / `Ctrl+Click` opens a
  definition, while `Option+Click` opens a Quick Look Definition preview.
- Integrated terminal tabs with search, splits, command prediction,
  TUI-awareness, and preview detection from terminal output.
- Command Dispatcher flows with `Cmd+Shift+F`, default search, `>` IDE
  commands, `>>` file search, quoted grep search, `#` symbol search, `@t `
  terminal dispatch, and `@ai ` AI dispatch.
- Built-in MCP server for approval-based IDE access by external coding agents.
- AI Chat with provider/model selection, context disclosure, consent gates,
  `@ai` prompts, `/chat`, `/plan`, `/debug`, `/build`, `/review`,
  plan-to-build handoff, linked review, runtime status, pending approvals, tool
  review, patch artifacts, Mnemonic memory, and optional passive editor
  predictions.
- macOS native bridge work for menu, fullscreen, window controls, packaged app
  open intents, Dock reopen behavior, and Keychain-backed credential storage.
- Go backend services for project sessions, indexing, terminal/PTY, MCP,
  AI runtime, updater evidence, and packaged app integration.
- Bundled internal autocomplete model used for suggestion ranking.

See [FEATURES.md](FEATURES.md) for the public feature and demo-video map.

## Current Limits

- macOS is the active open-beta platform; Windows/Linux are future release
  targets.
- Wails v3 remains an upstream alpha dependency.
- Builds do not have Developer ID signing or notarization yet. Gatekeeper may
  warn or block first launch until the user explicitly opens the trusted beta
  artifact.
- AI provider availability depends on provider accounts, BYOK/API-key or OAuth
  setup, configured external CLIs/runtimes, and model capability.
- Background agent behavior is preview-only.
- Embeddings/RAG are disabled in the current beta.
- The bundled internal autocomplete model is a ranker, not a generative code
  model.
- Go, Wails, React, and CodeMirror are implementation technologies used by the
  project.

## Documentation

- [FEATURES.md](FEATURES.md) - public feature map and demo-video slots.
- [PRIVACY.md](PRIVACY.md) - beta privacy and provider/runtime disclosure.
- [MODEL_PROVENANCE.md](MODEL_PROVENANCE.md) - bundled autocomplete model
  notice.
- [release-notes/v0.2.23-beta.144.md](release-notes/v0.2.23-beta.144.md) -
  latest checked-in beta release notes in this tree.
- [CUSTOM_THEMES.md](CUSTOM_THEMES.md) - custom theme format and import guide.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) - third-party notices.
- [build/README.md](build/README.md) - packaging assets and templates.

## Tech Stack

| Layer    | Technology                    |
| -------- | ----------------------------- |
| Backend  | Go 1.26                       |
| Frontend | React 19, TypeScript (strict) |
| Editor   | CodeMirror 6                  |
| Desktop  | Wails v3 alpha                |
| Database | SQLite with GORM              |
| Parsing  | Tree-sitter                   |
| Terminal | xterm.js + PTY                |
| Styling  | Tailwind CSS v4               |
| State    | Zustand                       |

## License

[MIT](LICENSE)
