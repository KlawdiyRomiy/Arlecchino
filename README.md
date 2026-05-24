<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="Arlecchino">
</p>

<h1 align="center">Arlecchino</h1>

<p align="center">
  A desktop IDE in macOS open beta, built for controlled AI-assisted development.<br>
  Go backend, React frontend, floating IDE tools, AI Chat, and MCP-based agent control.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Wails-v3%20alpha-EB4034" alt="Wails v3 alpha">
  <img src="https://img.shields.io/badge/Platform-macOS%20open%20beta-000000?logo=apple&logoColor=white" alt="macOS open beta">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## Status

Arlecchino is currently a **macOS open beta**. Windows and Linux releases are
planned later, but the current public path is macOS-first.

The beta includes the editor shell, Command Dispatcher, terminal/workspace
flow, floating panels, Git and preview surfaces, packaged macOS routing,
provider-aware defaults, MCP control, and an integrated AI surface with AI
Chat, provider/model selection, context preview, consent gates, approval-gated
tool review, reviewable patch artifacts, optional passive editor predictions,
and a Codex-backed external agent runtime path.

This is not a general-availability release or a stable autonomous AI IDE. AI
behavior depends on configured providers, model capabilities, consent, approval
settings, and selected runtime. Background agents are preview-only,
embeddings/RAG are disabled, and advanced runtime coverage is still being
hardened.

There is no Apple Developer ID signing or notarization yet. The beta tester path
is a DMG artifact, installation of `Arlecchino.app`, and launch of the installed
app bundle. Because the app is not Developer ID signed or notarized, Gatekeeper
will warn that macOS cannot verify the developer or check the app for malicious
software. That warning is expected for this beta until signing and notarization
exist.

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

- A dense desktop IDE shell with floating and snapped panels.
- CodeMirror 6 editing with LSP-backed diagnostics, hover, signature help, and
  navigation flows.
- Explorer, Problems, Git, Browser Preview, Markdown Preview, terminal, Code
  panel, status, settings, and multi-project switching surfaces.
- Integrated terminal tabs with search, splits, command prediction,
  TUI-awareness, and preview detection from terminal output.
- Command Dispatcher flows with `Cmd+Shift+F`, default search, `>` IDE
  commands, `>>` file search, quoted grep search, `#` symbol search, `@t `
  terminal dispatch, and `@ai ` AI dispatch.
- Built-in MCP server for controlled IDE access by external coding agents.
- Chat-first AI Chat with provider/model selection, context disclosure, consent
  gates, `@ai` bare prompts, `/chat`, `/plan`, `/debug`, `/build`, `/review`,
  plan-to-build handoff, linked review, session-scoped continuity, runtime
  status, pending approvals, tool review, patch artifacts, Mnemonic memory, and
  optional passive editor predictions.
- macOS native bridge work for menu, fullscreen, window controls, packaged app
  open intents, Dock reopen behavior, and Keychain-backed credential storage.
- Bundled internal autocomplete model for suggestion ranking.

See [FEATURES.md](FEATURES.md) for the feature and demo-video map.

## Current Limits

- macOS is the active open-beta platform; Windows/Linux are future release
  targets.
- Wails v3 remains an upstream alpha dependency.
- Builds do not have Developer ID signing or notarization; Gatekeeper will warn
  or block first launch until the user explicitly opens the trusted beta
  artifact.
- AI provider availability depends on provider accounts, BYOK/API-key or OAuth
  setup, configured external CLIs/runtimes, and model capability.
- Background agent behavior is preview-only.
- Embeddings/RAG are disabled in the current beta.
- The bundled internal autocomplete model is a ranker, not a generative code
  model.

## Documentation

- [FEATURES.md](FEATURES.md) - public feature map and demo-video slots.
- [PRIVACY.md](PRIVACY.md) - beta privacy and provider/runtime disclosure.
- [MODEL_PROVENANCE.md](MODEL_PROVENANCE.md) - bundled autocomplete model
  notice.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) - third-party notices and
  release checklist caveats.
- [build/README.md](build/README.md) - build asset and packaging template notes.

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
