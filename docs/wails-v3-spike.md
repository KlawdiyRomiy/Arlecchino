# Wails v3 Shell Spike

## Status

As of **2026-04-22**, Arlecchino keeps `main` on **Wails v2.12**.

Wails v3 remains a separate shell exploration track in:

```text
feature/wails3-shell-spike
```

The reason is straightforward:

- the current product can keep shipping on v2
- the bubble shell redesign does not depend on v3
- the main value of v3 is future shell capability, not immediate UI polish
- Wails v3 is still documented under the `v3alpha` docs track

## Why Arlecchino Cares About v3

Arlecchino's future shell needs more than a single custom window:

- multi-window applets
- detachable terminal / AI chat / browser preview windows
- native-feeling window lifecycle and menus
- tray, notifications, single-instance routing
- file associations, custom protocols, updater flow
- future material backends such as Liquid Glass on supported macOS

That is why v3 matters. It is a shell foundation question, not a “new version looks nicer” question.

## Spike Scope

The spike is only successful if it proves shell value for Arlecchino.

### Shell checks to verify

- app boots and the existing frontend loads
- bindings/events still work cleanly
- multi-window behavior works
- detached applet prototypes work for:
  - Terminal
  - AI Chat
  - Browser Preview
- native menus and context menus are credible
- tray and notifications are usable
- single-instance flow is viable
- file associations and custom protocol hooks are prototypeable
- updater path can at least check a manifest

### Out of scope for the spike

- moving `main` to v3 immediately
- rewriting the product around v3 APIs
- treating Liquid Glass as already-proven production support
- mixing the spike with release packaging promises

## Decision Gate

Do not move `main` to v3 unless all of these are true:

- terminal focus and input remain stable
- editor behavior remains stable
- detached window lifecycle is reliable
- shortcut behavior across windows is sane
- packaging/build flow is credible on target platforms
- migration effort is understood
- rollback back to v2 is clear
- no alpha blocker threatens release confidence

If these do not pass, Arlecchino keeps shipping on v2 while v3 stays a spike branch.

## Current Direction

- `main` = bubble shell + Wails v2.12 + macOS-first source alpha
- `feature/wails3-shell-spike` = shell exploration branch
- Liquid Glass is part of the **future shell track**, not the current alpha baseline

## Current Official Docs Used For This Spike

- [Wails v3 changelog](https://v3alpha.wails.io/changelog/)
- [Multiple Windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Single Instance](https://v3alpha.wails.io/guides/single-instance/)
- [File Associations](https://v3alpha.wails.io/guides/file-associations/)
- [Auto-Updates](https://v3alpha.wails.io/guides/distribution/auto-updates/)
