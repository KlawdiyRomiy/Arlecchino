# Build Assets

This directory contains checked-in assets and platform templates used by
Arlecchino packaging flows.

The current public beta is macOS-first. Windows files are kept as metadata and
packaging templates for future platform work; they are not a claim that Windows
release artifacts are currently supported.

## Structure

- `appicon.png` - root application icon used by Wails packaging flows.
- `appicon.icon/` - icon source metadata.
- `darwin/` - macOS plist templates, app icons, and packaged-app assets.
- `windows/` - Windows manifest, icon, installer, and version metadata
  templates for future Windows releases.
- `bin/` - generated output directory when created during packaging; ignored by
  git.

## macOS

Tester validation should start from the DMG artifact, installation of
`Arlecchino.app`, and launch of the installed app bundle. Public beta docs
should not direct testers to non-DMG launch paths.

Ad-hoc tester beta artifacts remain a packaging-stage path until Developer ID
signing and notarization are available. Gatekeeper warnings are expected for
those unsigned, non-notarized artifacts.

Important macOS files:

- `darwin/Info.plist` - macOS bundle metadata template.
- `darwin/Info.dev.plist` - development bundle metadata template.
- `darwin/Info.wails3.plist` - Wails v3 packaging template.
- `darwin/iconfile.icns` - packaged macOS icon.
- `darwin/appicon-dark.png` and `darwin/appicon-light.png` - app icon variants.

## Windows

Windows release artifacts are planned later. The files under `windows/` are
kept so platform metadata can evolve with the repo, but they are not the active
public beta distribution path.

Important Windows files:

- `windows/icon.ico` - Windows application icon.
- `windows/info.json` - Windows version metadata template.
- `windows/wails.exe.manifest` - application manifest.
- `windows/installer/*` - installer template files.

## Generated Output

Do not commit generated build output from this directory. Keep packaged apps,
release archives, smoke reports, and temporary packaging output outside git
unless a release process explicitly says otherwise.
