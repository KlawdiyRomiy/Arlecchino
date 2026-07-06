<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="Arlecchino">
</p>

<h1 align="center">Arlecchino</h1>

<p align="center">
  A desktop IDE in macOS open beta, built for AI-assisted project work.<br>
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

Arlecchino is a **macOS open beta**. Windows and Linux are later targets; the
current release path is macOS first.

The beta is already useful as a desktop IDE: editor, Command Dispatcher,
terminal, panels, Git, previews, project switching, MCP control, and AI Chat.
AI features still depend on the provider, model, consent settings, and runtime
you configure. Background agents remain preview-only, and embeddings/RAG are
off in this build.

Current artifacts are not Apple Developer ID signed and are not notarized.
Developer ID signing and notarization will be added soon; no date is committed
yet. For now the tester path is simple: download the DMG, install
`Arlecchino.app`, and launch the installed app. Gatekeeper may warn that macOS
cannot verify the developer or scan the app. That is normal for this beta
artifact.

For owner/local-tester builds, release scripts also support
`--sign local-identity`. This requires an explicitly created local code-signing
certificate, defaults to the identity name `Arlecchino Local Code Signing`, and
does not create or trust certificates automatically. It is intended to keep the
same local signing identity across updates on that Mac so macOS folder
permissions are less likely to reset after each app replacement. It is not
public Gatekeeper trust, not Developer ID signing, and not notarization.

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
- Built-in MCP server for approval-based IDE access by external coding agents.
- Chat-first AI Chat with provider/model selection, context disclosure, consent
  gates, `@ai` bare prompts, `/chat`, `/plan`, `/debug`, `/build`, `/review`,
  plan-to-build handoff, linked review, session-scoped continuity, runtime
  status, pending approvals, tool review, patch artifacts, Mnemonic memory, and
  optional passive editor predictions.
- macOS native bridge work for menu, fullscreen, window controls, packaged app
  open intents, Dock reopen behavior, and Keychain-backed credential storage.
- Bundled internal autocomplete model for suggestion ranking.

See [FEATURES.md](FEATURES.md) for the public feature and demo-video map.

## Current Limits

- macOS is the active open-beta platform; Windows/Linux are future release
  targets.
- Wails v3 remains an upstream alpha dependency.
- Builds do not have Developer ID signing or notarization yet. They will be
  added soon, with no date committed. Gatekeeper may warn or block first launch
  until the user explicitly opens the trusted beta artifact.
- Ad-hoc local builds may trigger macOS folder-access prompts again after app
  updates. Use the documented `local-identity` signing mode only for explicit
  owner/local-tester workflows on a Mac where the local certificate is trusted.
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
- [release-notes/v0.2.20-beta.141.md](release-notes/v0.2.20-beta.141.md) -
  latest checked-in beta release notes in this tree.
- [CUSTOM_THEMES.md](CUSTOM_THEMES.md) - if you want to create and add your
  custom theme.
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
