# Custom Themes

Arlecchino can import custom color themes from JSON files. Custom themes are
added from `Settings -> Appearance -> Add custom theme`, stored locally in the
app, and listed under `Custom themes` in the theme dropdown.

Custom theme imports do not modify the built-in theme registry or write source
files. They are persisted in browser local storage and can be replaced by
importing another JSON file with the same normalized id.

If you adapt an existing theme, keep its attribution and license with your
theme file. Keep examples and shared theme files repo-safe: do not use
machine-specific absolute paths in public docs or checked-in theme examples.

## File Shape

A custom theme file must be a JSON object with these top-level fields:

- `appearance`: required, either `"light"` or `"dark"`.
- `colors`: required, IDE chrome and panel colors.
- `editor`: required, CodeMirror surface, selection, tooltip, and syntax colors.
- `terminal`: required, xterm foreground, background, cursor, selection, and
  ANSI palette.
- `id`: optional but recommended. Arlecchino normalizes it to `custom:<slug>`.
- `name`: optional but recommended. This is the display name in Settings.
- `description`: optional. If omitted, Arlecchino creates a fallback description
  from the imported file name.

Every value inside `colors`, `editor`, and `terminal` must be a non-empty
string. Use normal CSS color strings such as hex, `rgb(...)`, `rgba(...)`, or
supported CSS color expressions.

## Example Themes

The following `Backstage Footlights` examples are original Arlecchino custom
themes. Ready-to-import files are included in this repo, and the JSON blocks
below are kept here for copy-paste.

Ready-to-import files:

- [`themes/backstage-footlights-dark.arlecchino-theme.json`](themes/backstage-footlights-dark.arlecchino-theme.json)
- [`themes/backstage-footlights-light.arlecchino-theme.json`](themes/backstage-footlights-light.arlecchino-theme.json)

### Backstage Footlights Dark

```json
{
  "id": "backstage-footlights-dark",
  "name": "Backstage Footlights Dark",
  "appearance": "dark",
  "description": "A graphite backstage theme with warm footlights and emerald focus cues.",
  "colors": {
    "bg": "#0B0F14",
    "bgSecondary": "#10161D",
    "bgTertiary": "#17202A",
    "bgPanel": "#131A22",
    "bgHover": "#22303A",
    "border": "#2D3A44",
    "borderSubtle": "#1E2932",
    "borderLight": "#B87538",
    "text": "#D8E0E3",
    "textPrimary": "#F2EFE7",
    "textSecondary": "#B8C1C4",
    "textMuted": "#758089"
  },
  "editor": {
    "background": "#0B0F14",
    "surface": "#10161D",
    "surfaceElevated": "#17202A",
    "gutter": "#0E141A",
    "scrollbarTrack": "#0A0E13",
    "scrollbarThumb": "#31404A",
    "scrollbarThumbHover": "#465864",
    "border": "rgba(242, 239, 231, 0.09)",
    "borderStrong": "rgba(184, 117, 56, 0.3)",
    "text": "#D8E0E3",
    "textSoft": "#AEB9BD",
    "textMuted": "#758089",
    "caret": "#F0B15F",
    "activeLine": "rgba(240, 177, 95, 0.08)",
    "activeLineGutter": "#F0B15F",
    "selection": "rgba(49, 125, 108, 0.35)",
    "selectionInactive": "rgba(49, 125, 108, 0.2)",
    "selectionMatch": "rgba(240, 177, 95, 0.18)",
    "bracketMatch": "rgba(240, 177, 95, 0.24)",
    "searchMatch": "rgba(240, 177, 95, 0.22)",
    "tooltipBg": "rgba(16, 22, 29, 0.985)",
    "tooltipBgStrong": "rgba(11, 15, 20, 0.99)",
    "tooltipShadow": "inset 0 1px 0 rgba(242, 239, 231, 0.045), 0 18px 40px -24px rgba(0, 0, 0, 0.84), 0 28px 72px -42px rgba(0, 0, 0, 0.78)",
    "ghostText": "rgba(216, 224, 227, 0.32)",
    "highlight": "rgba(49, 125, 108, 0.16)",
    "comment": "#78836F",
    "string": "#7EC59B",
    "number": "#D7A86E",
    "keyword": "#E9785B",
    "operator": "#B8C1C4",
    "type": "#6BB7C8",
    "property": "#C8955D",
    "function": "#F0B15F",
    "variable": "#D8E0E3",
    "constant": "#D7A86E",
    "accent": "#3FB493"
  },
  "terminal": {
    "background": "#0B0F14",
    "foreground": "#D8E0E3",
    "cursor": "#F0B15F",
    "cursorAccent": "#0B0F14",
    "selectionBackground": "rgba(49, 125, 108, 0.35)",
    "black": "#0B0F14",
    "red": "#D96A57",
    "green": "#63B985",
    "yellow": "#F0B15F",
    "blue": "#6CA9D8",
    "magenta": "#B98BD9",
    "cyan": "#3FB493",
    "white": "#D8E0E3",
    "brightBlack": "#758089",
    "brightRed": "#F0846C",
    "brightGreen": "#82D3A0",
    "brightYellow": "#F6C77D",
    "brightBlue": "#8CC1E6",
    "brightMagenta": "#CFA6EA",
    "brightCyan": "#66D0B3",
    "brightWhite": "#F2EFE7"
  }
}
```

### Backstage Footlights Light

```json
{
  "id": "backstage-footlights-light",
  "name": "Backstage Footlights Light",
  "appearance": "light",
  "description": "A rehearsal-paper theme with copper structure and emerald focus cues.",
  "colors": {
    "bg": "#F7F1E6",
    "bgSecondary": "#EFE7D8",
    "bgTertiary": "#E6DCCB",
    "bgPanel": "#FFF9EF",
    "bgHover": "#E9DCC6",
    "border": "#C9BCA8",
    "borderSubtle": "#DED2BD",
    "borderLight": "#A9672B",
    "text": "#232323",
    "textPrimary": "#1B1B1B",
    "textSecondary": "#4D463D",
    "textMuted": "#756D61"
  },
  "editor": {
    "background": "#FFF9EF",
    "surface": "#F4ECDD",
    "surfaceElevated": "#ECE0CE",
    "gutter": "#F1E7D6",
    "scrollbarTrack": "#E8DDCA",
    "scrollbarThumb": "#BDAF98",
    "scrollbarThumbHover": "#A48763",
    "border": "rgba(35, 35, 35, 0.11)",
    "borderStrong": "rgba(169, 103, 43, 0.28)",
    "text": "#232323",
    "textSoft": "#4D463D",
    "textMuted": "#756D61",
    "caret": "#0E7F68",
    "activeLine": "rgba(169, 103, 43, 0.11)",
    "activeLineGutter": "#A9672B",
    "selection": "rgba(14, 127, 104, 0.2)",
    "selectionInactive": "rgba(14, 127, 104, 0.12)",
    "selectionMatch": "rgba(169, 103, 43, 0.14)",
    "bracketMatch": "rgba(169, 103, 43, 0.24)",
    "searchMatch": "rgba(223, 151, 61, 0.3)",
    "tooltipBg": "rgba(255, 249, 239, 0.985)",
    "tooltipBgStrong": "rgba(244, 236, 221, 0.99)",
    "tooltipShadow": "inset 0 1px 0 rgba(255, 255, 255, 0.84), 0 18px 38px -24px rgba(71, 55, 32, 0.28), 0 28px 70px -42px rgba(71, 55, 32, 0.2)",
    "ghostText": "rgba(35, 35, 35, 0.32)",
    "highlight": "rgba(14, 127, 104, 0.1)",
    "comment": "#7B7469",
    "string": "#28764C",
    "number": "#93631D",
    "keyword": "#A14F3C",
    "operator": "#655B4F",
    "type": "#1C7580",
    "property": "#8A5F1F",
    "function": "#7B551A",
    "variable": "#232323",
    "constant": "#93631D",
    "accent": "#0E7F68"
  },
  "terminal": {
    "background": "#FFF9EF",
    "foreground": "#232323",
    "cursor": "#0E7F68",
    "cursorAccent": "#FFF9EF",
    "selectionBackground": "rgba(14, 127, 104, 0.2)",
    "black": "#232323",
    "red": "#A14F3C",
    "green": "#28764C",
    "yellow": "#A9672B",
    "blue": "#2E6F9E",
    "magenta": "#7D5A9E",
    "cyan": "#0E7F68",
    "white": "#4D463D",
    "brightBlack": "#756D61",
    "brightRed": "#BF624C",
    "brightGreen": "#338E5E",
    "brightYellow": "#C98538",
    "brightBlue": "#4A86B4",
    "brightMagenta": "#936FB5",
    "brightCyan": "#159A7F",
    "brightWhite": "#1B1B1B"
  }
}
```

## Required Keys

`colors` keys:

```text
bg
bgSecondary
bgTertiary
bgPanel
bgHover
border
borderSubtle
borderLight
text
textPrimary
textSecondary
textMuted
```

`editor` keys:

```text
background
surface
surfaceElevated
gutter
scrollbarTrack
scrollbarThumb
scrollbarThumbHover
border
borderStrong
text
textSoft
textMuted
caret
activeLine
activeLineGutter
selection
selectionInactive
selectionMatch
bracketMatch
searchMatch
tooltipBg
tooltipBgStrong
tooltipShadow
ghostText
highlight
comment
string
number
keyword
operator
type
property
function
variable
constant
accent
```

`terminal` keys:

```text
background
foreground
cursor
cursorAccent
selectionBackground
black
red
green
yellow
blue
magenta
cyan
white
brightBlack
brightRed
brightGreen
brightYellow
brightBlue
brightMagenta
brightCyan
brightWhite
```

## Import Workflow

1. Save the theme as a `.json` file.
2. Open `Settings`.
3. Go to `Appearance`.
4. Click `ADD` in `Add custom theme`.
5. Select the JSON file.
6. Open the theme dropdown and choose the imported theme under
   `Custom themes`.

If the import succeeds, Arlecchino immediately selects the imported theme. If a
required key is missing or empty, the import fails with a validation message
that names the missing field.

## ID And Replacement Rules

Arlecchino normalizes custom theme ids before storing them:

- `my-theme` becomes `custom:my-theme`.
- `custom:my-theme` remains `custom:my-theme`.
- `My Theme.json` becomes `custom:my-theme`.

If you import another theme with the same normalized id, it replaces the
previous local custom theme. Use a stable `id` when you want updates to replace
the old version, and use a different `id` when you want multiple variants in the
dropdown.

## Authoring Notes

- Keep `appearance` honest. Dark themes should use `"dark"` and light themes
  should use `"light"` so Arlecchino can set the right document mode.
- Keep editor and terminal backgrounds opaque unless you are intentionally
  auditing transparent material layers and contrast.
- Tune `colors` for the IDE shell first, then tune `editor` and `terminal`
  against that shell palette.
- Do not paste a VS Code, Zed, or terminal theme directly. Convert its palette
  into the three Arlecchino sections and keep every required key present.
- Do not add `cssVariables`; Arlecchino generates CSS variables from the three
  palettes during import.
