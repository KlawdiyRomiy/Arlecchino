<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="Arlecchino">
</p>

<h1 align="center">Arlecchino</h1>

<p align="center">
  A bubble-shell desktop IDE for building software.<br>
  Go backend, React frontend, floating tools, built-in MCP server.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Wails-v2.12-EB4034" alt="Wails v2.12">
  <img src="https://img.shields.io/badge/Platform-macOS%20alpha-000000?logo=apple&logoColor=white" alt="macOS alpha">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## Alpha Status

Arlecchino is currently a **source alpha**, built on **Wails v2.12**.

Wails v3 is still being explored as a separate shell track.

---

## What Ships In Alpha Now

### Bubble Shell On Wails v2

- Rounded shell chrome with a calmer, darker bubble-style interface
- Floating and snapped panels for Explorer, Terminal, Git, Problems
- Per-project panel layouts and workspace state
- A serious dense IDE layout, not a generic web dashboard

### Command Palette And Terminal Dispatcher

- `Cmd+F` opens the command palette / search bar
- Plain search for files
- `>` for IDE commands
- `@t ` for terminal-mode command dispatch with ghost text prediction
- TUI-aware terminal flow for tools like `vim`, `htop`, and `less`

### Editor And Navigation

- CodeMirror 6 editor
- Multi-language editing with LSP integration
- Inline diagnostics, hover, signature help, minimap, split views
- Quick file relations and dependency graph flows
- Multi-project workspace and tab history

### Built-In IDE Tools

- Explorer
- Problems panel
- Git panel with details and diff views
- Browser Preview
- Status bar, settings, project switching

### MCP Integration

Arlecchino ships with a built-in MCP server so external coding agents can interact with the IDE through a controlled protocol surface.

That includes:

- file operations
- terminal orchestration
- project and layout control
- preview and panel control
- audit-aware sensitive access boundaries

---

## Experimental / Partial

These parts exist, but they should not be described as fully finished yet:

- **Predictive autocomplete / ARLE brain**
  The ranking and suggestion pipeline is real, but consistency still varies by language and project shape.

- **AI chat panel**
  Currently unavailable.

---

## Quick Start (macOS alpha)

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

- installs the core dev toolchain needed for local alpha development
- installs recommended extras for a better alpha experience
- runs `go mod download`
- runs `npm ci` inside `frontend/`
- prints a summary of what is installed, already present, or optional

### Run

```bash
./scripts/wails-dev-macos.sh
```

This is the canonical alpha dev path on `main`.

`./scripts/wails-dev-macos.sh` wraps `wails dev` and also keeps the macOS app bundle icon assets in sync (`Assets.car`, `appicon.icns`) so the Dock icon stays correct on newer macOS builds.

The wrapper builds the dev app into `/tmp/Arlecchino-wails-build` instead of the cloned workspace. This avoids `codesign` detritus and File Provider issues when the repo lives inside `Documents`, iCloud Drive, or another synced folder.

This is an **early technical alpha** path:

- source checkout only
- no Apple Developer signing
- no notarization
- no polished installer or DMG flow yet

### Build A Local Alpha Bundle

```bash
./scripts/wails-build-macos.sh
```

This creates a local macOS app bundle at:

```bash
/tmp/Arlecchino-wails-build/bin/Arlecchino.app
```

Like the dev wrapper, the build wrapper keeps icon assets in sync and avoids File Provider / `codesign` detritus by building outside the cloned workspace.

---

## Dependency Model

### Required For App Boot

These are the dependencies the bootstrap treats as required:

- `go`
- `node@22`
- `npm`
- `wails` (`v2.12`)
- `go mod download`
- `frontend/npm ci`

If one of these cannot be installed or resolved, the bootstrap exits with a clear instruction instead of pretending everything is fine.

Arlecchino's alpha toolchain intentionally prefers **Node.js 22 LTS** instead of the newest Homebrew `node`. That keeps `npm ci`, `vite`, and Wails frontend packaging reproducible for this repo.

### Recommended Extras Installed By Bootstrap

These are not hard blockers for app boot, but they make the alpha feel closer to the intended experience:

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

These stay outside the default alpha bootstrap:

- `php`, `composer`, `phpactor`
- Rust toolchain and Rust analyzers
- Ruby / Solargraph
- Terraform, Lua, Kotlin, Scala, and other language-specific chains

Some of these can still be installed later from Arlecchino's language server flows or manually through your own environment.

### ONNX Runtime Note

`onnxruntime` is **not** a hard blocker for starting Arlecchino.

If it is missing, the app still boots and falls back away from the ONNX-backed path. Installing it simply gives the autocomplete stack access to the faster ML backend where available.

---

## Future Shell Track (Wails v3 spike)

Wails v3 is **not** the default alpha path for Arlecchino today.

The current strategy is:

- keep `main` on **Wails v2.12**
- keep the current bubble shell evolving on `main`
- explore **Wails v3** separately in `feature/wails3-shell-spike`

That v3 track exists to evaluate future shell capabilities such as:

- multi-window applets
- detached terminal / chat / preview windows
- native menus and context menus
- tray and notifications
- single-instance handling
- custom protocols and file associations
- updater / release plumbing
- future material backends such as Liquid Glass on supported macOS

See [docs/wails-v3-spike.md](docs/wails-v3-spike.md) for the shell-spike scope and migration gate.

---

## Tech Stack

| Layer    | Technology                    |
| -------- | ----------------------------- |
| Backend  | Go 1.26                       |
| Frontend | React 19, TypeScript (strict) |
| Editor   | CodeMirror 6                  |
| Desktop  | Wails v2.12                   |
| Database | SQLite with GORM              |
| Parsing  | Tree-sitter                   |
| Terminal | xterm.js + PTY                |
| Styling  | Tailwind CSS v4               |
| State    | Zustand                       |

---

## License

[MIT](LICENSE)
