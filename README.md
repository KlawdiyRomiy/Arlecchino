<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="Arlecchino">
</p>

<h1 align="center">Arlecchino</h1>

<p align="center">
  A new interface for building software.<br>
    Floating panels, search bar/terminal dispatcher, autocomplete, builtin MCP server.<br>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Wails-v2.12-EB4034" alt="Wails v2.12">
  <img src="https://img.shields.io/badge/Platform-macOS-000000?logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

<!-- GIF: Full IDE overview — editor with open file, terminal at bottom, explorer on left -->

---

## What Is This

Arlecchino is a native desktop IDE where every panel floats, the terminal predicts your commands, and files know about each other. It's built as a single binary - Go handles the backend (indexing, LSP, terminal, predictions), React handles the UI, and they talk through Wails bindings.

There's also a full MCP server baked in, so AI coding agents (Claude Code, Codex, OpenCode) can control the IDE programmatically — open files, run terminal commands, manage layout, all through a secure protocol with audit logging.

The MCP server and autocomplete engine is still in active development. The features marked "In Development" are not finished yet.

---

## Features

### Floating Panels

Every panel in the IDE — Explorer, Terminal, Git, Problems — is a floating panel that operates in two modes:

- **Snapped**: docked to a screen edge, no border radius, integrated into the layout
- **Floating**: free-positioned window with rounded corners, drop shadow, and 8-direction resize handles

Drag any panel by its header and drop it near a screen edge to snap it. Drop it anywhere else and it floats. Eight translucent drop zones light up at screen edges while you drag, so you always know where it'll land.

Panel layouts are saved per-project. Switch between projects and each one remembers where you left everything.

<!-- GIF: Dragging a panel from snapped position to floating, then snapping it to a different edge -->

---

### Perspective Mode

Most editors let you open a file. Arlecchino lets you see what that file is connected to.

- **Alt+Click** any file → a searchable dropdown of every related file. Filtered by type, searchable by name.
- **Cmd+Click** any file → a full interactive dependency graph. Animated nodes showing symbols per file, bezier-curved edges labeled by relationship kind, a minimap for navigation.

<!-- GIF: Alt+Click showing QuickRelationsMenu, then Cmd+Click opening the full dependency graph -->

---

### Command Dispatcher

One search bar, eight modes. Hit `Cmd+F` and start typing:

| Prefix | What it does |
|--------|-------------|
| *(none)* | Fuzzy file search across the project |
| `>` | IDE actions (toggle panels, change theme, etc.) |
| `@t ` | Terminal command mode with ghost text prediction |

In terminal mode (`@t`), you type a command and the dispatcher shows a ghost text prediction of what comes next. Tab accepts it, Enter runs the command directly.

<!-- GIF: Typing in Command Dispatcher — switching between file search, grep mode, and @t terminal prediction -->

---

### TUI Mode

When you run `vim`, `htop`, `less`, or any other TUI program in the terminal, the IDE detects it and takes action:

1. Saves your current panel layout
2. Hides everything except the terminal
3. Gives the terminal full screen space with elevated z-index

When you exit the TUI program, everything snaps back to exactly where it was.

<!-- GIF: Running vim in terminal — IDE enters TUI mode, then showing TUI Assist with Explorer alongside -->

---

### Terminal

The terminal is built on xterm.js with full PTY management. It does more than you'd expect:

**Multiple tabs and split panes** — up to 2 panes (horizontal or vertical), multiple tabs per pane. Per-project layout persistence.

**Agent detection** — when you launch `claude`, `codex`, `aider`, or other AI agents from the terminal, the IDE detects it and can optionally inject an `AGENT_GUIDE.md` with IDE-specific instructions.

<!-- GIF: Terminal with ghost text predictions, accepting with Tab, and clicking a file:line reference -->

---

### MCP Integration

Arlecchino ships with a built-in [MCP](https://modelcontextprotocol.io/) server — 47 tools that let AI agents control the IDE programmatically.

**What agents can do:**
- **File operations**: read, write, search — with automatic checkpoint/rollback
- **IDE backend**: open/close projects, query LSP, create terminals, run commands, read git status/diff/log
- **IDE UI**: emit events, control browser preview, manage layout profiles, take snapshots, hot-switch panels

**Security is not an afterthought:**
- Sensitive file detection (`.env`, `.ssh`, `*.pem`, `*credentials*`) requires explicit approval
- Time-limited permissions (5 min default, 1 hour max)
- Constant-time token comparison, 30-minute token rotation
- Audit logging with risk classification (read-only, mutating, sensitive-access, boundary-crossing)
- Rate limiting at 50 events/second

**Bootstrap**: run `arlecchino mcp-bootstrap` to generate config files for Claude Code, Codex CLI, and OpenCode. The MCP server communicates over stdio or Unix sockets.

<!-- GIF: An AI agent creating a file and opening it in the editor through MCP -->

---

## Code Editor

The editor is built on CodeMirror 6.

- **57 languages** with syntax highlighting, Tree-sitter parsing, and LSP integration
  - Tier 1 (18): JavaScript, TypeScript, Go, PHP, Python, Rust, C/C++, Java, C#, HTML, CSS, SQL, and more
  - Tier 2 (13): Kotlin, Ruby, Dart, Swift, Lua, R, and more
  - Tier 3 (17): Elixir, Scala, Haskell, Zig, OCaml, COBOL, and more
  - Plus data formats (JSON, YAML, TOML, XML), web frameworks (Vue, Svelte, Astro), and extras (GraphQL, Terraform, Solidity)
- **Go-to-definition** via `Cmd+Click` — with a multi-definition chooser when there are several matches. Laravel gets 15+ specialized patterns (routes, views, models, controllers, middleware, config, env, Blade templates)
- **Inline diagnostics** — squiggles, line emphasis, inline messages, and a diagnostics donut visualization
- **Signature help and hover info** from LSP
- **Rainbow brackets**, minimap (toggleable), code folding, bracket matching
- **Auto-save** after 1.5 seconds of idle time
- **Format-on-save** via built-in Prettier (Babel, TypeScript, HTML, PostCSS, PHP)
- **Custom snippets** from localStorage

---

## Navigation & Files

**File Explorer** — tree with a distinctive visual style.

**Multi-project workspace** — open multiple projects simultaneously. Animated switch transitions with directional slides. Each project keeps its own panel layout, tab state, and terminal sessions. 

**Tab management** — drag-and-drop reorder (Framer Motion), dirty indicator (`●`), close on hover. Split view (right or down). Reopen last closed tab with `Cmd+Shift+T` (keeps 10 in history).

**Welcome screen** — recent projects, environment validation (checks for Node, Go, PHP, Composer), dev tools status, LSP server installation. Missing tools can be installed directly from the welcome screen.

---

## Developer Tools

**Git Panel** — staged/unstaged changes with file status colors (modified, added, deleted, untracked, renamed). Inline diff viewer. Commit history. Branch display.

**Browser Preview** — embedded iframe with URL bar and navigation controls. Auto-detects dev server URLs from terminal output (localhost/loopback only). Auto-refreshes on file save. Settings: auto-open, reuse session window, close on exit. MCP-controllable — agents can open, navigate, and close preview windows.

**Framework Plugins** — auto-detection based on project markers:
- **Laravel**: artisan file → artisan command suggestions, route/model/controller/view/middleware/config/env/Blade go-to-definition
- **Django**: manage.py → management command suggestions
- **Rails**: Gemfile with rails → rails/rake/rspec suggestions
- **Common**: git integration for all projects

**Problems Panel** — real-time LSP diagnostics. Inline diagnostics in the editor. Compact mode for the status bar. Diagnostics donut visualization per file.

---

## UI & System

**Theme system** — three modes: Dark (Blackprint), Light, System (follows OS). Persisted in localStorage. Synchronized across editor, terminal, and all panels.

**Keyboard shortcuts** — layout-independent, using physical key positions (`KeyboardEvent.code`). Works correctly with any keyboard layout (Russian, German, etc.). 25+ shortcuts for file operations, navigation, terminal, and split views. Context-aware: TUI mode reroutes shortcuts to assist panel toggles.

(добавить в последствии разработки еще настройки)**Settings** — 4 tabs: Appearance (theme), Editor (font size, UI scale 80–140%), Diagnostics (minimap, inline, compact, donut), Browser Preview (auto-open, reuse, close-on-exit).

TUI mode automatically triggers hard pause. When you exit, everything resumes.

**Status bar** — diagnostics count, language, project name, relative file path, cursor position (Ln/Col), encoding.

---

## In Development

These features exist and partially work, but they're not finished. Shipping them as "ready" would be dishonest.

### Autocomplete Engine

The autocomplete system has a 3,500-line prediction brain that aggregates completions from five sources: LSP, predictive patterns, SQLite symbol index, local file symbols, and virtual (pending) symbols. It includes a custom ONNX neural network (INT8 quantized) called ARLE that handles completion ranking (60% deterministic + 40% ML score blending), ghost text generation (up to 20 tokens), and 51-language detection.

There's a SmartMatcher with five cascade levels (exact → prefix → word-boundary → subsequence → contains), pattern matching with placeholder resolution, a project learner that tracks accepted completions, and language-specific confidence thresholds.

It works. Sometimes it works well. But it's not consistent enough to call "done."

### AI Chat

The chat panel UI is built and persists conversation history. The backend is a placeholder — responses are hardcoded after a delay. The architecture is ready for an AI service, but no AI dependency has been added. By design, not by accident.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.26 |
| Frontend | React 19, TypeScript (strict) |
| Editor | CodeMirror 6 |
| Desktop | Wails v2.12 |
| Database | SQLite with GORM, WAL mode |
| Parsing | Tree-sitter (Go bindings) |
| Terminal | xterm.js + PTY (creack/pty) |
| ML | ONNX Runtime (INT8 quantized model) |
| Styling | Tailwind CSS v4 |
| State | Zustand |

---

## Keyboard Shortcuts

| Action | macOS |
|--------|-------|
| Search / Command Palette | `Cmd+F` |
| Quick Open | `Cmd+P` |
| Toggle Sidebar | `Cmd+B` |
| Toggle Terminal | `` Ctrl+` `` |
| Toggle AI Panel | `Cmd+R` |
| Settings | `Cmd+,` |
| Open Project | `Cmd+O` |
| New Project | `Cmd+N` |
| Save | `Cmd+S` |
| Close Tab | `Cmd+W` |
| Reopen Tab | `Cmd+Shift+T` |
| Split Right | `Cmd+\` |
| New Terminal Tab | `Cmd+T` |
| Zoom In / Out / Reset | `Cmd+=` / `Cmd+-` / `Cmd+0` |
| Switch Project | `` Cmd+` `` |

---

## License

[MIT](LICENSE)
