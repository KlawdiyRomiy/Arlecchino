# Wails v3 Shell Status

## Status

As of **2026-05-05**, Arlecchino `main` is on the pinned
`github.com/wailsapp/wails/v3 v3.0.0-alpha.87` module.

This is now the source-alpha shell baseline, not a separate future-only branch.
The public product message should still call this an Editor/Shell Alpha because
Wails v3 is still an alpha dependency and several native delivery surfaces are
gated behind explicit smoke paths.

## Current Source-Alpha Path

- Use `./scripts/wails3-dev-macos.sh` on `main`.
- Do not use the global Wails v2 CLI for current `main` verification.
- Generated bindings are controlled by `./scripts/wails3-generate-bindings.sh`.
- Release packaging uses the `wails3-*` macOS scripts, but public product and
  artifact names must not include `v3`.

## Why Arlecchino Cares About v3

Arlecchino's shell needs more than a single custom window:

- multi-window applets;
- detachable terminal, preview, Git, and Problems helper surfaces;
- native-feeling window lifecycle and menus;
- tray, notifications, single-instance routing;
- file associations, custom protocols, updater flow;
- future material backends such as Liquid Glass on supported macOS.

That is why v3 matters. It is a shell foundation question, not a "new version
looks nicer" question.

## Release Positioning

The current alpha should be described as:

- editor and shell first;
- local-first by default;
- no accounts or product analytics by default;
- no cloud AI/chat integration in the current alpha;
- local ARLE autocomplete/ranking as experimental;
- no Apple Developer ID signing or notarization yet.

## Demo Video Slots

- Wails v3 source-alpha launch: TBD
- Bubble shell panel lifecycle: TBD
- Detached helper surface behind gate: TBD
- Native menu/context menu path: TBD
- Single-instance/open-intent path: TBD
- Local-alpha packaging/install flow: TBD
- Auto-update check/apply flow: TBD

## Decision Gate

Do not call the Wails v3 shell complete unless all of these are true:

- terminal focus and input remain stable;
- editor behavior remains stable;
- detached window lifecycle is reliable where enabled;
- shortcut behavior across windows is sane;
- packaging/build flow is credible on target platforms;
- migration effort and rollback path are understood;
- no alpha blocker threatens release confidence;
- release smoke and installed-app smoke evidence are current.

If these do not pass, Arlecchino can still ship as a technical source alpha, but
the affected native shell capability must remain gated or explicitly documented
as experimental.

## Current Official Docs Used For This Track

- [Wails v3 changelog](https://v3alpha.wails.io/changelog/)
- [Multiple Windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Single Instance](https://v3alpha.wails.io/guides/single-instance/)
- [File Associations](https://v3alpha.wails.io/guides/file-associations/)
- [Auto-Updates](https://v3alpha.wails.io/guides/distribution/auto-updates/)
