# Theme Guide

Arlecchino themes are defined in `frontend/src/styles/themes.ts`.

Settings supports built-in themes and custom JSON theme imports. Imported themes are stored in local storage and use ids prefixed with `custom:`.

## Built-In Themes

- `blackprint`: default dark Arlecchino theme.
- `arlecchino-light`: light inversion of the default theme.
- `arlecchino-stage`: theatrical dark theme with stage-black surfaces, velvet red cues, brass dividers, and teal focus states.
- `arlecchino-matinee`: theatrical light theme with ivory playbill surfaces, red cues, brass structure, and teal focus states.
- `catppuccin-latte`: Catppuccin light theme.
- `catppuccin-frappe`: Catppuccin dark theme.
- `catppuccin-macchiato`: Catppuccin dark theme.
- `catppuccin-mocha`: Catppuccin dark theme.

`system` is a preference, not a theme. It resolves to `blackprint` when the OS prefers dark mode and `arlecchino-light` when the OS prefers light mode.

## Theme Shape

Each theme is an `IDEThemeDefinition`:

```ts
interface IDEThemeDefinition {
  id: ThemeId;
  name: string;
  appearance: "light" | "dark";
  description: string;
  colors: ThemeUIColorPalette;
  editor: EditorThemePalette;
  terminal: ITheme;
  cssVariables: Record<string, string>;
}
```

The theme has three color surfaces:

- `colors`: IDE chrome and panels.
- `editor`: CodeMirror background, gutter, selection, tooltip, and syntax colors.
- `terminal`: xterm foreground, background, cursor, selection, and ANSI palette.

`cssVariables` is generated from `colors`, `editor`, and `terminal`. The app applies these variables to `<html>` through `ThemeProvider`.

## Add A Built-In Theme

1. Add the id to `BUILT_IN_THEME_IDS`.
2. Create an `IDEThemeDefinition`, usually through `createThemeDefinition`.
3. Add the theme to `themeList`.
4. Check Settings and Appearance Preview. Both read from `themeOptions`.
5. Run focused frontend checks:

```bash
cd frontend
npm run typecheck
npx prettier --check "src/styles/themes.ts"
```

## Token Map

Core IDE tokens:

- `--surface-canvas`, `--surface-1`, `--surface-2`, `--surface-3`
- `--surface-elevated`, `--surface-overlay`
- `--text-primary`, `--text-secondary`, `--text-muted`
- `--border-subtle`, `--border-default`, `--border-strong`
- `--accent-brand`, `--accent-brand-soft`
- `--status-success`, `--status-warning`, `--status-error`, `--status-info`

Editor tokens:

- `--editor-bg`, `--editor-surface`, `--editor-gutter`
- `--editor-text`, `--editor-text-soft`, `--editor-text-muted`
- `--editor-caret`, `--editor-selection`, `--editor-active-line`
- `--editor-tooltip-bg`, `--editor-tooltip-bg-strong`
- `--syntax-comment`, `--syntax-keyword`, `--syntax-string`, `--syntax-function`

Terminal tokens:

- `terminal.background`
- `terminal.foreground`
- `terminal.cursor`
- `terminal.selectionBackground`
- ANSI colors: `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white` and bright variants.

## Custom Theme Files

Custom theme files are imported from Settings with `Add custom theme`. The importer validates the same shape before applying it:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "appearance": "dark",
  "colors": {},
  "editor": {},
  "terminal": {}
}
```

Required rules:

- `id` is optional, but recommended. It is normalized to `custom:<slug>`.
- `name` is optional; the file name is used as a fallback.
- `appearance` must be `"light"` or `"dark"`.
- Every `colors`, `editor`, and `terminal` key listed above is required.
- Imported themes replace an existing custom theme with the same normalized id.
- Keep editor and terminal bodies opaque by default. Transparent themes need a separate material layer and contrast audit.

## Example Custom Theme

Use `/Users/klawdiy/Documents/tomorrow-night-burns.arlecchino-theme.json` as a local complete example. It is an Arlecchino-format rewrite inspired by the Zed extension `alii/zed-tomorrow-night-burns`, not a Zed theme file copied into our app.

To add it in the IDE:

1. Open `Settings`.
2. Go to `Appearance`.
3. Click `+ ADD` in `Add custom theme`.
4. Choose `/Users/klawdiy/Documents/tomorrow-night-burns.arlecchino-theme.json`.
5. Open the theme dropdown and select it under `Custom themes`.

When writing a new custom theme, copy the example and change:

- `id`: stable slug; Arlecchino stores it as `custom:<id>`.
- `name`: display name in Settings.
- `appearance`: `"dark"` or `"light"`.
- `colors`: IDE chrome tokens.
- `editor`: CodeMirror and syntax tokens.
- `terminal`: xterm palette.

Do not paste a Zed, VS Code, or terminal theme directly. Convert its palette into these three Arlecchino sections and keep every required key present.
