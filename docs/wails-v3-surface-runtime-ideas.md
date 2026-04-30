# Wails v3 Surface Runtime Ideas For Arlecchino

Status: planning reference
Date: 2026-05-01

Этот документ фиксирует идеи для развития Arlecchino на ветке Wails v3. Он не является
списком задач на немедленную реализацию. Его цель - связать продуктовые идеи IDE,
текущий код проекта и реальные возможности Wails v3, чтобы будущая разработка шла не
через разрозненные панели и хаотичные события, а через понятную модель shell/runtime.

## Scope Corrections

### Arlehub Is GUI Hub Mode, Not TUI Hub

Arlehub не должен становиться TUI-хабом. При включении Arlehub IDE должна переходить в
GUI hub mode: центральная поверхность становится GUI-чатом и orchestration view в духе
Codex/OpenCode Desktop, а floating panels остаются помощниками вокруг него. Explorer,
Git, Problems, терминал и отдельные code/file panels должны открываться как вспомогательные
поверхности, а не заменять хаб.

Текущий код уже частично поддерживает эту модель:

- `frontend/src/stores/previewWindowStore.ts` хранит `PreviewWindow` с surface type
  `file`, `code`, `browser`, `git`, `chat`, `terminal`, `appearance` и режимами
  `floating`/`snapped`.
- `frontend/src/components/layout/PreviewWindowLayer.tsx` уже рендерит отдельные
  preview windows через `FloatingPanel`.
- `internal/mcp/service_bridge_tools.go` уже имеет tools `ide_ui.open_file_panel`,
  `ide_ui.preview_open`, `ide_ui.preview_focus`, `ide_ui.preview_close`.
- `docs/arlehub-architecture.md` описывает Arlehub как host applet с режимами
  `floating`, `snapped`, `fullscreen`, `detached` в будущем.

Следствие: Wails v3 multi-window нужен не для превращения Arlehub в терминальный центр,
а для promotion chain: applet может жить в main shell, floating helper, snapped helper,
fullscreen hub или отдельном OS window.

### Diagnostics Donut 2.0 Is Rejected For Now

Diagnostics Donut 2.0 не входит в план. Не надо делать круговой индикатор, drag-out
diagnostics window или before/after badge по этой идее.

Текущая диагностика должна развиваться через существующие surfaces:

- `frontend/src/stores/diagnosticsStore.ts` уже держит summary, grouping и lifecycle
  диагностики.
- `frontend/src/components/problems/DiagnosticsDonutIndicator.tsx` сейчас возвращает
  `null`, что удобно оставить как отсутствие surface.
- `frontend/src/components/layout/MainLayoutPanelRenderer.tsx` уже рендерит Problems как
  обычную floating/snapped панель.

Если диагностику расширять позже, делать это через Problems applet и agent-open-error
flow, а не через donut UI.

## Wails v3 Baseline

Wails v3 пока находится в alpha, поэтому каждую интеграцию нужно проверять spike-кодом и
узкими тестами. Основные области документации, на которые опирается этот документ:

- [Wails v3 alpha docs](https://v3alpha.wails.io/)
- [v2 to v3 migration](https://v3alpha.wails.io/migration/v2-to-v3/)
- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Bound methods and generated models](https://v3alpha.wails.io/features/bindings/methods/)
- [Frontend runtime](https://v3alpha.wails.io/reference/frontend-runtime/)
- [Events](https://v3alpha.wails.io/reference/events/)
- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Window options](https://v3alpha.wails.io/features/windows/options/)
- [Application menus](https://v3alpha.wails.io/features/menus/application/)
- [Context menus](https://v3alpha.wails.io/features/menus/context/)
- [Keyboard shortcuts](https://v3alpha.wails.io/features/keyboard/shortcuts/)
- [Systray](https://v3alpha.wails.io/features/menus/systray/)
- [Single instance](https://v3alpha.wails.io/guides/single-instance/)
- [Custom protocols](https://v3alpha.wails.io/guides/distribution/custom-protocols/)
- [File associations](https://v3alpha.wails.io/guides/file-associations/)
- [Auto updates](https://v3alpha.wails.io/guides/distribution/auto-updates/)

Текущий `wails.json` все еще использует schema v2 и v2-подобный frontend workflow. Это
нужно считать migration risk, а не деталью конфигурации.

Текущий spike-вывод: для этой ветки использовать `./scripts/wails3-dev-macos.sh`.
Обычный `wails` из PATH сейчас может быть v2 CLI и падать с `Unable to find Wails in
go.mod`, потому что проект уже импортирует `github.com/wailsapp/wails/v3`.

Bindings policy для этой ветки теперь repo-local: `./scripts/wails3-generate-bindings.sh`
запускает Wails v3 alpha генератор pinned к `v3.0.0-alpha.78`. Dry-run по умолчанию пишет
во временную директорию, потому что alpha `-dry` при указании реального output dir может
чистить generated output. Запись в `frontend/bindings` допускается только через
`./scripts/wails3-generate-bindings.sh --write` и отдельный diff review generated churn.
Frontend все равно держит runtime fallback через `main.App.*`/`arlecchino.App.*`, чтобы
dev-сборки со stale bindings не ломали shell.

Baseline hardening для этой ветки теперь имеет отдельный checkpoint:

- `8cdbb8b Checkpoint Wails v3 shell baseline` - зафиксирован shell/surface/runtime
  baseline перед дальнейшим hardening.
- `./scripts/wails3-dev-macos.sh` больше не делает tail `exec` в app binary: runner
  владеет child process, ставит `INT`/`TERM`/`EXIT` cleanup и завершает stale
  `mcp-server` процессы, запущенные из текущего Wails v3 output path.
- Orphan cleanup ограничен текущим output binary. Для отладки можно временно отключить
  его через `ARLE_WAILS3_KEEP_STALE_MCP=1`.
- UI automation target вынесен в `./scripts/wails3-ui-launch-target-macos.sh`. Скрипт
  печатает shell-readable dev или packaged launch target, включая executable, cwd,
  `ARLECCHINO_MCP_BRIDGE_METADATA_PATH` и команду запуска.
- Automation launch target выставляет `ARLECCHINO_DISABLE_MCP_BOOTSTRAP=1`, чтобы
  smoke/Playwright запуски не переписывали пользовательские MCP bootstrap configs.

## Current Project Anchors

Главные точки текущей архитектуры:

- `main.go` создает одно Wails application instance, регистрирует один сервис `App`,
  подключает embedded frontend assets, задает main `WebviewWindow` и application menu.
- `app.go` сейчас является большим центральным сервисом. В нем живут project state,
  core engine, completion brain, LSP manager, plugin system, terminal manager,
  execution service, MCP bridge и Wails window/app references.
- `frontend/src/wails/runtime.ts` уже является совместимостным runtime wrapper над
  Wails v3 runtime imports (`Application`, `Browser`, `Clipboard`, `Events`, `Window`).
- `frontend/src/wails/app.ts` переэкспортирует generated bindings из
  `frontend/bindings/arlecchino/app`.
- `runtime_safe_log.go` дает безопасный event emit/listen wrapper для Go-side runtime.
- `shell_menu.go`, `frontend/src/utils/applicationMenu.ts` и
  `frontend/src/hooks/useApplicationMenuBridge.ts` уже связывают native menu actions с
  frontend command handling.
- `frontend/src/components/layout/panelLayoutModel.ts`,
  `frontend/src/components/layout/useMainLayoutPanelDrag.ts`,
  `frontend/src/components/layout/MainLayoutPanelRenderer.tsx`,
  `frontend/src/components/layout/MainLayout.tsx`,
  `frontend/src/components/layout/PreviewWindowLayer.tsx` и
  `frontend/src/stores/previewWindowStore.ts` - текущая основа panel/window surface model.
- `frontend/src/stores/terminalStore.ts`, `terminal.go`, `internal/terminal/pty.go`,
  `internal/terminal/agent_launch.go`, `internal/terminal/agent_guide.go` - основа
  terminal-first режима и agent CLI detection.
- `internal/mcp/service_bridge_tools.go` - уже существующий мост, через который agent
  может управлять UI events, panels и preview windows.
- `docs/arlehub-architecture.md` - продуктовая архитектура Arlehub, projection graph,
  provider registry, event store, subagents, skill residency и sandbox.

## Current Spike Status

Состояние на 2026-04-29:

- Добавлен frontend Surface Runtime contract: `frontend/src/surfaces/surfaceRuntime.ts`
  строит stable `SurfaceSession` для panels и preview windows.
- Добавлен runtime store: `frontend/src/surfaces/surfaceRuntimeStore.ts`, а
  `frontend/src/components/layout/MainLayout.tsx` синхронизирует текущие panels,
  panel configs и preview windows в этот snapshot.
- Добавлен Shell Capabilities v1: `shell_capabilities.go` отдает
  `App.GetShellCapabilities()` с platform/runtime/version и capability descriptors.
- `frontend/src/shell/shellCapabilities.ts` содержит conservative fallback, hook
  `useShellCapabilities()`, backend loader, payload normalization для camelCase/PascalCase
  и runtime fallback через `main.App.GetShellCapabilities`/`arlecchino.App.GetShellCapabilities`.
- Generated Wails v3 bindings регенерированы repo-local командой с `-b -ts`; в них
  появились `GetShellCapabilities` и typed models
  `ShellCapabilitiesSnapshot`, `ShellCapabilityDescriptor`, `ShellCapabilityStatus`.
- `frontend/src/App.tsx` загружает Shell Capabilities через generated typed binding при
  старте приложения, fallback path остается внутри `shellCapabilities.ts`.
- Готовые shell-точки уже переведены на capability-aware поведение: directory dialogs,
  external browser open и clipboard runtime fallback.
- Добавлен event contract module `frontend/src/surfaces/surfaceRuntimeEvents.ts` и
  contract tests для `surface:open/focus/move/promote/close/state`, failure payloads и
  dedupe.
- `frontend/src/surfaces/surfaceRuntimeStore.ts` теперь ведет bounded event history и
  автоматически выводит `surface:*` события из diff между предыдущим и текущим host
  snapshot. Это делает уже существующие panel/preview transitions observable без
  переписывания UI handlers.
- Surface Runtime v1 получил read/focus contract: frontend store отдает read model с
  active surface, focus history, indexes by source/host/applet и bounded event tail.
- `frontend/src/hooks/useIDEEvents.ts` теперь может возвращать result payload в
  `mcp:ui-event:ack`, а `internal/mcp/service_bridge_tools.go` добавил read-only tool
  `ide_ui.surface_read`, который запрашивает `ide:surface:read` у frontend и возвращает
  актуальную Surface read model через live bridge.
- `frontend/src/components/layout/MainLayout.tsx` и panel/preview event hooks теперь
  синхронизируют активный panel/preview focus в Surface Runtime без изменения
  визуального поведения и без detached windows.
- Native context menu adapter добавлен как capability-aware слой поверх существующего
  `ContextActionMenu`: при usable `contextMenu` frontend отправляет текущие visible
  actions в `App.OpenNativeContextMenu`, backend строит transient Wails native menu и
  возвращает выбранный action через `ide:context-menu:action`; при unavailable capability
  остается текущий Radix/DOM fallback. Generated bindings для этого slice не тронуты.
- Dialog/clipboard/browser URL audit закрыт для текущих прямых frontend вызовов:
  directory dialogs идут через `shellDialogs.ts`, clipboard copy/paste - через
  `utils/clipboard.ts` с runtime и navigator fallback, external URL open - через
  `shell/browser.ts` с capability gate и запретом non-http(s) payloads.
- Добавлен Protocol/Open Intent router для текущих in-app flows: frontend принимает
  `ide:intent:open`, нормализует typed intents `openProject`, `openFile`, `openPreview`,
  `focusSurface`, держит bounded queue до регистрации layout dispatcher и затем вызывает
  существующие project/file/preview/focus handlers. Для MCP добавлен подтверждаемый
  `ide_ui.open_intent`, который эмитит тот же `ide:intent:open` и сохраняет approval,
  burst-limit и path guard для file intents.
- Добавлен gated single-instance/open-file spike: `ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1`
  включает Wails v3 `SingleInstanceOptions`, second-instance callback фокусит main window
  и маршрутизирует launch/open targets в `ide:intent:open`. Backend держит bounded queue
  до frontend-ready сигнала `ide:frontend:ready`, чтобы launch args и second-instance
  requests не терялись до регистрации React dispatcher. По умолчанию capability остается
  выключенной до packaged smoke.
- Добавлен Protocol/File Association packaged probe: backend launch parser теперь
  нормализует `arlecchino://` custom protocol payloads и `file://` association payloads
  в те же typed `ide:intent:open` intents. Allowlist остается узким:
  open project, open file, open preview URL и focus surface; произвольные commands,
  non-http(s) preview URL и небезопасные surface ids отклоняются. Capabilities
  `customProtocol`/`fileAssociations` остаются `requires-build`, пока packaged smoke не
  подтвердит OS registration.
- Добавлен Background Shell Status v1 без включения tray/notifications:
  `background_shell_status.go` хранит in-memory read model для фоновых jobs/services,
  bounded event tail, cancel/focus action candidates и rate-limited notification
  candidates. `app.go` подключает indexer, LSP install и MCP bridge lifecycle к этому
  snapshot, а frontend mirror `frontend/src/shell/backgroundShellStatus.ts` читает
  `App.GetBackgroundShellStatus()` через Wails v3 runtime `Call.ByName` и слушает
  `shell:background:status`. Action contract добавляет `App.RunBackgroundShellAction(actionID)`
  для будущих tray/notification/menu consumers: `cancel-job` отменяет активную cancelable
  job, а `focus-surface` фокусит main window и отправляет `ide:intent:open`/`focusSurface`.
  Native tray и native notification delivery остаются выключенными.
- Добавлен Agent Flight Recorder v1 на MCP/backend side: `internal/mcp/flight_recorder.go`
  ведет bounded in-memory timeline и append-only `.arlecchino/agent-flight-recorder.log`,
  `ide_control.flight_recorder` читает события, а `ide_control.capabilities` отдает
  `flightRecorderDiskPath` и `supportsFlightRecorderV1`. MCP tool calls пишут
  `mcp.tool.completed`, UI bridge calls пишут `agent.ui.requested`/`agent.ui.acknowledged`,
  live approval path пишет `approval.requested`/`approval.resolved`; redaction использует
  audit sanitizer, а дублирующие approval checks внутри bridge helpers убраны.
- Добавлен Applet Promotion Chain v1 без detached windows: `ide:surface:promote`
  исполняет `promote-floating`, `snap`, `fullscreen`, `return-to-main` для `panel:*`
  и `preview:*`, сохраняя panel/window identity и payload. Surface Runtime read model
  отдает `promotion.commandsBySurfaceId`, disabled `detach` command с явной причиной и
  `promotion.returnTargets`, которые запоминают предыдущий host layout при переходе
  `snapped`/`floating`/`fullscreen`.
- Добавлен Window Lease System foundation без native detached window creation:
  `frontend/src/surfaces/windowLease.ts` вводит lease registry/read model для
  detached-capable applet roles, close/focus/return/stale policies и cleanup stale
  leases. На текущем gate actual native-detachable surface честно ограничен только
  Browser Preview: `panel:git`, `panel:problems` и `panel:terminal` больше не
  показывают enabled `detach`, пока native panel detach не реализован. Default остается
  off до packaged/manual smoke.
- Добавлен Window Lease v2 native detached preview spike: backend `window_lease.go`
  хранит lease registry для actual Wails windows и dev-gated
  `RunWindowLeaseAction(detach)`, который при
  `ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1` создает detached Browser Preview window
  с route `/?arleDetachedHost=...`. Frontend `windowLeaseBridge.ts` синхронизирует
  `shell:window-lease:status`, а `DetachedAppletHost` рендерит существующий
  `PreviewWindowSurface` без нового applet body. Close policy возвращает preview в
  main shell через `ide:intent:open`. Git/Problems/Terminal остаются lease-supported,
  но actual native detach для них отложен до стабильного preview smoke.
- Detached Browser Preview return lifecycle усилен чистым helper contract: close/return
  intent теперь сохраняет `surfaceId`, `previewWindowId`, current URL payload, title,
  `pinned` и return target host/position перед отправкой обратно в Open Intent router.
- Добавлен Packaged OS Integration adapter layer без включения native delivery:
  `packaged_os_integration.go` отдает default-off adapters/read model для custom
  protocol, file associations, tray, notifications, dock/taskbar badges и auto-update
  manifest placeholder. Tray/notifications читают Background Shell actions/candidates,
  `RunPackagedOSIntegrationAction("background:<action>")` делегирует в существующий
  Background Shell action contract, а frontend mirror
  `frontend/src/shell/packagedOSIntegration.ts` загружается через Wails v3 `Call.ByName`.
- Добавлен Native Tray/Notification Dev Gate без default-on поведения:
  `packaged_os_native.go` подключает Wails v3 systray, notifications и dock/taskbar badge
  только при одновременных env-gates `ARLECCHINO_PACKAGED_BUILD=1`,
  `ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE=1` и явном adapter flag. Tray menu показывает
  только текущие Background Shell actions, native notifications отправляют deduped
  notification candidates, а dock/taskbar badge отражает `AttentionCount`. Notification
  service стартует lazy, чтобы macOS bundle/signing ограничения не ломали app startup.
- Добавлен packaged binary smoke matrix без `.app` packaging:
  `./scripts/wails3-packaged-smoke-matrix-macos.sh` строит Wails v3 binary один раз и
  проверяет default report, `--open-file`, `file://`, `arlecchino://open?file=...`,
  `--open-preview`, `arlecchino://focus?...` и gated snapshot с single-instance,
  Window Lease и packaged OS spike flags.
- Добавлен dev-only packaged `.app` smoke harness:
  `./scripts/wails3-packaged-app-smoke-macos.sh` собирает Wails v3 binary, создает
  временный `.app` bundle с bundle id, URL scheme и document type declarations,
  запускает его через `open -n ... --args`, пишет JSON report во временную директорию и
  не оставляет tracked artifacts. Report теперь включает `appBundle`, shell
  capabilities, packaged OS adapters, Background Shell, `nativeDelivery`,
  `singleInstance`, `secondInstance`, Window Lease и `autoUpdate`.
- Packaged matrix теперь покрывает `.app` smoke cases для second-instance/open-file
  probe, `file://`, `arlecchino://open?file=...`, `arlecchino://open?preview=...`,
  `arlecchino://focus?...`, native tray/notification/dock badge projection из
  Background Shell и valid/invalid auto-update manifest read. Native delivery остается
  default-off и включается только explicit env flags.
- Auto-update gate реализован только как manifest read/validate/report:
  `no-manifest`, `invalid-manifest`, `valid-manifest-read`; установка обновлений
  намеренно disabled.
- Добавлен production-shaped `.app` packaging path:
  `./scripts/wails3-package-macos.sh` создает настоящий `.app` layout из tracked
  `build/darwin/Info.wails3.plist`, кладет Wails binary напрямую в `Contents/MacOS`
  как `CFBundleExecutable`, копирует icon resources и не оставляет tracked artifacts.
  `./scripts/wails3-sign-macos.sh` поддерживает local `adhoc` signing/verify и
  dormant `developer-id`/notarytool path через env без Apple Developer requirement.
- Добавлен real OS handoff smoke harness:
  `./scripts/wails3-real-os-smoke-macos.sh` собирает production-shaped `.app`,
  регистрирует bundle через LaunchServices, запускает live app с temp app data dir
  и пишет `ide:intent:open` trace. Текущий smoke выявил Red blocker: в ad-hoc temp
  bundle Wails v3 `ApplicationLaunchedWithUrl`/`ApplicationOpenedWithFile` event не
  дошел до open-intent trace для `arlecchino://open?file=...`; harness теперь
  фиксирует этот failure как gate evidence, а не как "parser success".
- Packaged app data path теперь не зависит от repo cwd:
  `internal/project.ResolveDBPath` оставляет `data/projects.db` для dev, но в packaged
  mode использует `ARLECCHINO_DATA_DIR` или user config dir.
- Real notification permission/delivery, real tray click, dock badge live smoke,
  auto-update download/apply и Window Lease helper expansion остаются next gates.
- Arlehub в этой реализации не трогается. Следующий план ниже описывает адаптацию уже
  готовых элементов на v3 без включения hub mode.
- Проверки checkpoint: `./scripts/wails3-generate-bindings.sh`,
  `node --test test-scripts/surface-runtime-contracts.test.mjs`, `tsc --noEmit`,
  `go test -run 'TestBackgroundShellStatusService|TestBuildShellCapabilities' .`,
  focused packaged/open-intent/window-lease Go tests,
  `./scripts/wails3-dev-macos.sh --build-only`,
  `./scripts/wails3-packaged-app-smoke-macos.sh`,
  `./scripts/wails3-packaged-smoke-matrix-macos.sh`,
  короткий smoke запуск собранного Wails v3 бинаря без `Binding call failed`,
  `git diff --check`.

## Decision Gate Matrix

Текущий статус перед Arlehub и перед default-on native delivery:

| Area | Status | Current Decision | Remaining Gate |
| --- | --- | --- | --- |
| Wails v3 lifecycle/dev runner | Green | `./scripts/wails3-dev-macos.sh` is the branch smoke path; runner owns child cleanup and stale output-scoped MCP shutdown. | Keep using v3 script; do not use global v2 `wails` CLI for this branch. |
| Bindings/service surface | Green | Shell capabilities, context menu, background shell, packaged OS and window lease methods exist behind the `App` service with runtime fallbacks. | Regenerate bindings only with `./scripts/wails3-generate-bindings.sh --write` and review generated churn separately. |
| Surface/Applet promotion | Green | In-window `floating`, `snap`, `fullscreen`, `return-to-main` works for existing panels/previews without detached windows. | Detached remains Window Lease territory, not part of in-window promotion. |
| Detached windows / Window Lease | Yellow | Browser Preview actual Wails detached window works only with `ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1`; return intent preserves preview identity/state; panel detach commands are now disabled/honest until native panel detach exists. | Manual preview detach/close smoke remains useful; then add Git/Problems/Terminal helper detach one by one. |
| Single instance/open-file | Yellow | Backend parser, frontend-ready queue and `ide:intent:open` dispatch are implemented behind `ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1`; packaged `.app` smoke now validates the second-instance parser/queue probe. | Real OS second-instance handoff from a launched packaged app before enabling capability by default. |
| Protocol/file associations | Yellow | `arlecchino://` and `file://` payloads normalize through strict open-intent allowlist; packaged `.app` smoke validates these payloads as launch args. | Real LaunchServices/Finder/browser registration smoke before moving capabilities out of `requires-build`. |
| Tray/notifications/dock badge | Yellow | Native delivery is wired to Background Shell only behind packaged spike env flags; `.app` smoke validates tray action projection, notification candidate projection, badge label and tracked failure states. | Signed/bundled notification permission smoke and real tray click smoke before default-on native delivery. |
| Auto-update manifest | Yellow | `.app` smoke reads and reports `no-manifest`, `invalid-manifest`, `valid-manifest-read`; install remains disabled. | Decide update channel/signature policy and implement installer only after release packaging is stable. |
| Packaging/release OS integration | Yellow | Production-shaped `.app` packaging and ad-hoc signing now exist; packaged smoke launches the real `CFBundleExecutable`, not a wrapper. | Developer ID/notarization remains inactive until credentials exist; real protocol/file LaunchServices handoff is still blocked by Wails event delivery smoke. |
| Real OS handoff | Red | `wails3-real-os-smoke-macos.sh` launches a registered ad-hoc `.app` and traces `ide:intent:open`, but current Wails URL/file application events do not reach the bridge in the temp bundle smoke. | Debug Wails macOS app event delivery or add an approved fallback before claiming browser/Finder handoff green. |

Blockers before Arlehub:

- Keep current shell contracts stable for surface read, open intent, Background Shell and Window Lease.
- Keep Browser Preview detached lifecycle under spike free of stale state or lost return-to-main.
- Avoid adding Arlehub timeline/UI until Flight Recorder and Background Shell remain readable without hub.

Blockers before default-on native delivery:

- Package and run a production-shaped signed app bundle with real macOS bundle identity.
- Resolve the current Red real OS handoff smoke for `ApplicationLaunchedWithUrl` and
  `ApplicationOpenedWithFile`.
- Verify notification permission/startup in the packaged app, not only in report projection.
- Verify tray menu executes only Background Shell actions and does not expose unrelated app controls.
- Verify protocol/file association payloads from Finder/browser reach `ide:intent:open`.
- Decide per-platform status for Windows/Linux instead of inheriting macOS results.

## 1. Surface Runtime

### Purpose

Surface Runtime - это единая модель для всех видимых рабочих поверхностей IDE: main
editor, Arlehub GUI hub, floating panels, snapped panels, preview windows, future detached
OS windows и fullscreen applets.

Сейчас проект уже имеет несколько похожих понятий: `PanelId`, `PreviewWindow`,
`FloatingPanel`, `PreviewWindowLayer`, `MainLayoutPanelRenderer`. Wails v3 multi-window
делает эту проблему важнее: если часть поверхностей станет настоящими OS windows, нельзя
держать логику только в React layout state.

### Why It Helps

Surface Runtime дает:

- общий lifecycle для applet независимо от host;
- перенос applet между main shell, floating panel, snapped panel, fullscreen и detached
  window без потери session state;
- единые правила focus, shortcuts, context menus, native menus и event routing;
- понятный контракт для agents: открыть surface, сфокусировать surface, переместить,
  закрыть, показать file/code/browser/chat/git helper.

Для Arlehub это критично: hub mode должен быть центральной GUI surface, а панели вокруг
него должны быть теми же applets, только в другом host.

### Current IDE Fit

Текущие опорные файлы:

- `frontend/src/components/layout/panelLayoutModel.ts`: уже описывает panel config,
  default sizes, floating/snapped positions и viewport-safe placement.
- `frontend/src/stores/previewWindowStore.ts`: уже хранит preview windows с surface type,
  mode, position, size, focus, pinned state и persistence.
- `frontend/src/components/layout/PreviewWindowLayer.tsx`: уже делает batching resize и
  рендерит preview windows как floating surfaces.
- `frontend/src/components/layout/MainLayoutPanelRenderer.tsx`: уже умеет рендерить
  explorer, terminal, AI chat, git, problems как `FloatingPanel`.
- `frontend/src/components/layout/useMainLayoutPanelDrag.ts`: уже содержит drag/drop
  логику между panels и preview windows, включая swap, snap и float.
- `docs/arlehub-architecture.md`: уже описывает host applet model и то, что shared
  applet body должен переживать host transitions.

### Wails v3 Fit

Wails v3 multi-window и window lifecycle позволяют сделать detached host реальным OS
window. Services/bindings дают typed backend API для surface operations, а Events нужны
для синхронизации state между windows.

Документация:

- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Window options](https://v3alpha.wails.io/features/windows/options/)
- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Events](https://v3alpha.wails.io/reference/events/)

### Development Shape

Практичная форма:

1. Ввести product model `SurfaceSession` отдельно от React placement state.
2. Связать существующие `PreviewWindow` и `PanelId` с `surfaceId`.
3. Оставить `FloatingPanel` и `PreviewWindowLayer` frontend host backends, а не главным
   источником истины.
4. Добавить Go service `SurfaceService` или выделить часть из `App` после стабилизации
   Wails v3 bindings.
5. Для detached windows добавить `windowId`, `surfaceId`, `role`, `ownerProjectId`,
   `appletKind`, `focusPolicy`.
6. Event contract: `surface:open`, `surface:focus`, `surface:move`, `surface:promote`,
   `surface:close`, `surface:state`.

Текущий реализованный slice: пункты 1-3 закрыты как adapter layer поверх существующих
React stores без изменения визуального поведения. Event contract уже выделен в отдельный
module и покрывает canonical payloads для open/focus/move/promote/close/state. Surface
Runtime v1 также имеет read/focus model и backend-facing MCP boundary через
`ide_ui.surface_read`. Полноценный Go `SurfaceService` остается следующим контрактным
шагом после стабилизации Wails v3 bindings; detached window lease spike начинается только
после этого.

### Risks And Checks

Главный риск - сделать слишком большой rewrite layout system. Начинать нужно с adapter
слоя поверх текущих stores. Проверки: open code panel через MCP tool, drag floating panel,
snap panel, reopen app, focus surface, open same surface in helper mode.

## 2. Window Lease System

### Purpose

Window Lease System - это правило владения detached windows. Каждое OS window должно иметь
lease: кто его открыл, зачем, что делать при закрытии, как возвращать state в main shell,
и кто имеет право его переиспользовать.

Без leases multi-window быстро превращается в набор окон без ownership: agent открыл
preview, пользователь закрыл main window, job продолжился, context menu указывает не туда.

### Why It Helps

Для IDE это дает:

- controlled detached applets;
- безопасное восстановление surface в main shell при закрытии detached window;
- поддержку "open file/project into existing app" через single instance;
- основу для detachable Git, browser preview, terminal, Arlehub chat, Problems.

### Current IDE Fit

Текущие зацепки:

- `frontend/src/stores/previewWindowStore.ts` уже имеет `pinned`, `focusWindow`,
  `closeWindow`, `updateWindow`, persisted storage и max/min sizes.
- `internal/mcp/service_bridge_tools.go` уже может открыть preview window или file panel
  с параметрами mode, position, size, line, content, language.
- `main.go` пока создает только одно окно `main`.
- `app.go` хранит `mainWindow` и `wailsApp`, но не имеет registry окон.

### Wails v3 Fit

Wails v3 supports multiple windows and lifecycle hooks. Single instance handling и file
associations позволяют направлять external open events в уже существующий процесс.

Документация:

- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Single instance](https://v3alpha.wails.io/guides/single-instance/)
- [File associations](https://v3alpha.wails.io/guides/file-associations/)

### Development Shape

Ввести backend registry:

- `WindowLease{WindowID, SurfaceID, Role, Owner, CreatedBy, ProjectPath, ClosePolicy}`;
- roles: `main`, `helper`, `detached-applet`, `preview`, `hub`, `modal-tool`;
- close policies: `return-to-main`, `destroy-session`, `keep-background`, `ask`;
- event routing: window close -> lease policy -> surface state update.

Frontend не должен сам решать, что detached window "умерло". Он должен получить событие
lease release и вернуть applet в корректный host.

Текущий реализованный slice:

- frontend lease registry/read model: `frontend/src/surfaces/windowLease.ts`;
- recognized lease roles: all `preview:*`, `panel:git`, `panel:problems`, `panel:terminal`;
- current native detach support: only `preview:*`; helper panels expose disabled
  `detach` with the Browser Preview-only reason until their native detach lifecycle is
  implemented;
- unsupported surfaces keep explicit disabled detach reason;
- policies: `close=return-to-main`, `focus=focus-detached-window`,
  `return=restore-main-host`, `stale=cleanup-return-target`;
- `SurfaceRuntimeReadModel.windowLeases` exposes supported/unsupported IDs, commands,
  lease records and stale lease IDs;
- `SurfaceRuntimeReadModel.promotion.commandsBySurfaceId[*].detach` is lease-aware:
  unsupported surfaces never enable, supported surfaces remain gated until Window Lease
  spike mode/package smoke enables detached windows;
- actual Wails detached window creation реализован пока только для Browser Preview и
  только при `ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1`;
- out of scope пока остаются native detach для Git/Problems/Terminal, Arlehub hub mode и
  production-default detach.

### Risks And Checks

Нужно проверить Wails v3 alpha lifecycle на macOS, Windows и Linux отдельно. Минимальный
spike: detached browser preview, detached Git panel, close window, reopen app, focus main,
restore surface.

## 3. Agent Flight Recorder

### Purpose

Agent Flight Recorder - это append-only журнал agent/UI/system событий. Он нужен для
объяснимости: что агент открыл, почему изменился layout, какие команды ушли в terminal,
какие files/panels были подняты, какие approvals были запрошены.

### Why It Helps

В Arlecchino agent сможет управлять UI через MCP tools, terminal guide, dispatcher,
context panels и future Arlehub. Без recorder невозможно нормально отлаживать "агент
сам открыл не то окно" или "почему терминал перешел в TUI mode".

### Current IDE Fit

Текущие точки:

- `internal/mcp/service_bridge_tools.go` уже содержит `ide_ui.emit_event`,
  request IDs, approvals и burst rate limits.
- `frontend/src/hooks/useIDEEvents.ts` уже нормализует MCP UI events и отправляет ack
  через `mcp:ui-event:ack`.
- `runtime_safe_log.go` уже безопасно emit/listen события со стороны Go.
- `docs/arlehub-architecture.md` уже описывает event log, projection graph,
  agent run event store и shared operator context.
- `frontend/src/stores/terminalStore.ts`, `terminal.go` и `internal/terminal/pty.go`
  уже имеют semantic terminal events, TUI mode detection и agent launch tracking.

### Wails v3 Fit

Wails v3 Events нужны как transport, но recorder не должен быть просто event bus. Event
bus доставляет события, recorder хранит историю и строит projections.

Документация:

- [Events](https://v3alpha.wails.io/reference/events/)
- [Services](https://v3alpha.wails.io/features/bindings/services/)

### Development Shape

Сделать `AgentEventStore` как Go service или internal package:

- append events: `agent.run.started`, `agent.ui.requested`, `surface.opened`,
  `terminal.command.detected`, `approval.requested`, `approval.resolved`;
- хранить correlation IDs между MCP tool call, frontend ack, terminal session и surface;
- дать frontend read model: timeline, current run state, last UI action, failed UI action;
- интегрировать с Arlehub GUI chat: каждое agent действие можно раскрыть в event trail.

Текущий реализованный slice:

- backend recorder: `internal/mcp/flight_recorder.go`;
- read tool: `ide_control.flight_recorder`;
- capability flags: `flightRecorderDiskPath`, `supportsFlightRecorderV1`;
- event types: `mcp.tool.completed`, `agent.ui.requested`, `agent.ui.acknowledged`,
  `approval.requested`, `approval.resolved`;
- redaction: `approval_code`, `content`, `data` и длинные string payloads проходят через
  общий audit sanitizer;
- guardrail cleanup: bridge helpers больше не делают повторный approval check внутри
  уже проверенного tool call path;
- out of scope пока остаются Arlehub timeline UI, terminal semantic ingestion и frontend
  recorder surface.

### Risks And Checks

Не логировать secrets, terminal input с tokens, env vars или clipboard payload. Нужен
redaction слой. Проверки: UI event ack записан, rejected event записан, terminal agent
launch записан, secrets не попадают в persisted log.

## 4. Shell Capabilities Service

### Purpose

Shell Capabilities Service - typed service, который сообщает frontend и applets, какие
native возможности доступны в текущем runtime: multi-window, native menus, context menus,
clipboard, notifications, tray, custom protocols, file associations, auto updates,
material/backdrop, badges.

### Why It Helps

Wails v3 alpha и cross-platform поведение будут отличаться по OS. Если frontend будет
зашивать проверки в компоненты, проект быстро получит хаос feature flags. Capabilities
service дает одну точку истины.

### Current IDE Fit

Текущий код уже нуждается в этом:

- `frontend/src/wails/runtime.ts` прячет Wails runtime wrappers.
- `app.go` хранит Wails app/window references и много shell-related сервисов.
- `shell_menu.go` уже зависит от native menu capability.
- `frontend/src/hooks/useApplicationMenuBridge.ts` синхронизирует shortcuts с backend.
- `frontend/src/components/BrowserPreview.tsx` использует `BrowserOpenURL`.
- `frontend/src/stores/terminalStore.ts` имеет power/security flags, которые лучше
  связать с shell capabilities.

### Wails v3 Fit

Services и generated bindings позволяют сделать typed capability API. Frontend runtime
покрывает clipboard/browser/window/application/events. Native menus, tray, notifications
и dialogs должны быть отражены как capabilities.

Документация:

- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Frontend runtime](https://v3alpha.wails.io/reference/frontend-runtime/)
- [Application menus](https://v3alpha.wails.io/features/menus/application/)
- [Context menus](https://v3alpha.wails.io/features/menus/context/)
- [Systray](https://v3alpha.wails.io/features/menus/systray/)

### Development Shape

Добавить typed model:

- `ShellCapabilities{MultiWindow, NativeMenu, ContextMenu, Tray, Notifications,
Clipboard, Dialogs, CustomProtocol, FileAssociations, AutoUpdate, MaterialBackdrop,
DockBadges}`;
- `ShellCapabilityStatus`: `available`, `unavailable`, `experimental`, `requires-build`,
  `requires-entitlement`, `platform-limited`;
- frontend hook `useShellCapabilities()` вместо точечных runtime guesses.

Текущий реализованный slice:

- backend model: `ShellCapabilityDescriptor`, `ShellCapabilitiesSnapshot`,
  `App.GetShellCapabilities()`;
- frontend model: `ShellCapabilityName`, `ShellCapabilityStatus`,
  `ShellCapabilitiesSnapshot`, `useShellCapabilities()`;
- fallback-first behavior для dev/test режима;
- backend sync через generated Wails v3 binding `GetShellCapabilities`;
- fallback sync через Wails v3 runtime `Call.ByName` для `main.App.GetShellCapabilities`
  и `arlecchino.App.GetShellCapabilities`;
- runtime payload normalization и stable revision semantics;
- repo-local regeneration script `./scripts/wails3-generate-bindings.sh`;
- generated bindings for `GetShellCapabilities`;
- capability gates для dialogs, browser open и clipboard;
- capability `backgroundStatus` сообщает, что read model для фоновых shell-состояний
  доступен, while `tray` и `notifications` остаются `unavailable`;
- Packaged OS adapters теперь имеют отдельный read model:
  `App.GetPackagedOSIntegrationStatus()` и frontend mirror
  `packagedOSIntegration.ts`; shell capabilities остаются conservative/default-off;
- contract tests для fallback, backend payload, invalid entries, stable revisions и
  operation events.

Важно: `./scripts/wails3-generate-bindings.sh` без `--write` не должен указывать на
`frontend/bindings`. Alpha Wails v3 `-dry` был замечен за cleanup output dir, поэтому
dry-run intentionally уходит во временную директорию.

### Risks And Checks

Не превращать service в dump конфигурации. Он должен отвечать на вопрос "можно ли сейчас
использовать capability". Проверки: macOS dev mode, packaged app, disabled capability,
fallback UI.

## 5. Native Context Menus As Command Surfaces

### Purpose

Native context menus должны стать command surfaces для explorer, editor tabs, Git,
Problems, terminal, browser preview и Arlehub messages. Это не просто UI polish:
context menu - быстрый способ открыть действие в правильном scope.

### Why It Helps

В IDE контекст важнее глобальной команды. Пользователь кликает файл, diff hunk, terminal
session, problem, chat message или preview URL. Native context menus дают привычное OS
поведение и позволяют держать команды рядом с объектом.

### Current IDE Fit

Текущие точки:

- `shell_menu.go` уже строит native application menu и accelerator actions.
- `frontend/src/utils/applicationMenu.ts` уже строит shortcut payload.
- `frontend/src/hooks/useApplicationMenuBridge.ts` уже dispatches native menu action
  обратно во frontend.
- `frontend/src/components/CommandDispatcher.tsx` и `frontend/src/hooks/useDispatcher.ts`
  уже дают командный слой.
- `internal/dispatcher/ide_handlers.go` уже умеет превращать IDE commands в UI events.

### Wails v3 Fit

Wails v3 имеет native application menus и context menus. Это позволяет не имитировать
каждое меню в DOM, особенно для OS-level expectations.

Документация:

- [Application menus](https://v3alpha.wails.io/features/menus/application/)
- [Context menus](https://v3alpha.wails.io/features/menus/context/)
- [Keyboard shortcuts](https://v3alpha.wails.io/features/keyboard/shortcuts/)

### Development Shape

Сделать `ContextMenuService`:

- frontend отправляет `contextKind`, `targetId`, `selection`, `surfaceId`;
- backend строит native menu по registry commands;
- menu item action возвращается как typed command event;
- dispatcher выполняет команду в том же scope.

Примеры:

- Explorer file: reveal, rename, duplicate, open in helper panel, open in detached window.
- Git hunk: stage hunk, discard hunk, open file panel at line, ask agent to explain.
- Problem: open file at diagnostic, copy message, ask agent to fix.
- Terminal session: split, rename, copy command, open preview, kill session.
- Arlehub message: copy, pin context, open referenced file, create task.

### Risks And Checks

Контекстное меню не должно дублировать весь command palette. Нужен небольшой scoped set.
Проверки: menu action сохраняет target scope, работает при focus в detached window,
shortcuts не конфликтуют.

## 6. Arlehub GUI Hub Mode With Floating Helpers

### Purpose

Arlehub GUI hub mode - центральный GUI-режим для orchestration, agent chat, provider
selection, run timeline, graph projections, memory/context и subagent control. Это
продуктовый режим, где editor уступает центр хабу, но не исчезает из системы.

Важно: это не TUI hub. Terminal-first режим остается для случаев, когда пользователь
запускает Codex/Claude/OpenCode/Qwen/etc в терминале. Arlehub - GUI.

### Why It Helps

Arlehub должен стать местом, где пользователь видит не только текстовый чат, но и
структуру работы:

- provider-backed chat;
- subagent runtime;
- event timeline;
- files/panels opened by agent;
- current project context;
- skill residency;
- sandbox/job state;
- graph/memory projections.

Floating panels вокруг Arlehub должны быть helpers: explorer, git, problems, terminal,
file/code panels, browser preview.

### Current IDE Fit

Текущие точки:

- `docs/arlehub-architecture.md` уже описывает Arlehub как host applet, projection graph,
  provider catalog, provider-backed chat, subagent runtime, skill residency, Docker
  sandbox и shared operator context.
- `frontend/src/components/AIChatPanel.tsx` сейчас фактически placeholder: есть локальные
  message states и mock response, но rendered UI показывает Coming Soon.
- `frontend/src/components/layout/MainLayoutPanelRenderer.tsx` уже рендерит `aiChat`
  panel через `FloatingPanel`.
- `frontend/src/stores/previewWindowStore.ts` уже имеет surface type `chat`.
- `frontend/src/components/layout/MainLayout.tsx` уже умеет скрывать dispatcher при
  TUI mode и поддерживает панели/preview layer.
- `internal/mcp/service_bridge_tools.go` уже позволяет agents открывать file/code panels
  и preview windows.

### Wails v3 Fit

Arlehub GUI mode не обязан сразу быть отдельным OS window. Но Wails v3 multi-window дает
future path: hub может быть fullscreen applet в main shell или detached `hub` window.
Services нужны для provider/runtime APIs, Events - для streaming state и cross-window
sync, native menus/context menus - для команды hub mode.

Документация:

- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Events](https://v3alpha.wails.io/reference/events/)
- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Application menus](https://v3alpha.wails.io/features/menus/application/)

### Development Shape

Сделать hub mode как surface, а не как отдельную страницу:

- `surfaceKind: "arlehub"` или `appletKind: "arlehub"`;
- host modes: `main-center`, `fullscreen`, `floating-helper`, `detached`;
- central hub UI replaces editor plane only while mode is active;
- helper panels keep working via current floating/snapped system;
- agent actions open helper panels through existing `ide_ui.open_file_panel` and
  `ide_ui.preview_open`;
- hub timeline reads from Agent Flight Recorder;
- provider chat uses typed backend service, not mock frontend state.

### Risks And Checks

Главный риск - смешать terminal TUI mode и Arlehub hub mode. Они должны быть разными
states: `tuiModeActive` в `terminalStore` остается terminal-first state, а Arlehub mode
должен жить в shell/surface store. Проверки: запуск Codex в terminal включает TUI mode;
включение Arlehub открывает GUI hub; explorer/git/file helper panels открываются вокруг
hub; выход из hub возвращает editor plane.

## 7. Surface Snapshots

### Purpose

Surface Snapshot - сохраненное состояние рабочего пространства: какие panels/windows
открыты, где они находятся, какие файлы сфокусированы, какой terminal session связан,
какой browser preview активен, какой Arlehub run открыт.

### Why It Helps

IDE часто используется в повторяющихся режимах: debug, review, agent run, frontend
preview, Git cleanup. Snapshot позволяет быстро вернуться к контексту и дать agent
возможность восстановить рабочий layout.

### Current IDE Fit

Текущий проект уже близко:

- `frontend/src/stores/previewWindowStore.ts` сохраняет windows в local storage и имеет
  `createCheckpoint`.
- `frontend/src/components/layout/panelLayoutModel.ts` умеет нормализовать размеры и
  positions.
- `frontend/src/stores/terminalStore.ts` хранит project layouts, sessions, panes,
  active session и TUI state.
- `frontend/src/hooks/useBrowserPreviewBridge.ts` связывает terminal semantic preview URL
  с browser preview window.

### Wails v3 Fit

Wails v3 services могут сохранять snapshots backend-side, а multi-window требует знать,
какие surfaces живут в каких windows. Events нужны для replay/restore state.

Документация:

- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Events](https://v3alpha.wails.io/reference/events/)
- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)

### Development Shape

Snapshot model:

- `SnapshotID`, `ProjectPath`, `CreatedAt`, `Reason`;
- `Surfaces[]` with kind, host, geometry, focus order, pinned state;
- terminal session links by stable session metadata, not raw PTY process IDs;
- browser preview links by project target and URL;
- Arlehub run link by run ID.

Start with manual snapshots and restore. Later add automatic snapshots around agent runs,
debug sessions and layout changes.

### Risks And Checks

Не сохранять volatile IDs как единственный source of truth. Проверки: restore after app
restart, restore after missing terminal session, restore after file moved, restore with
detached windows unavailable.

## 8. Protocol Router

### Purpose

Protocol Router обрабатывает `arlecchino://` links, file associations и external open
requests. Он должен уметь открыть project, file, symbol, theme, plugin, Arlehub run,
agent task или preview target в уже запущенной IDE.

### Why It Helps

Для desktop IDE это bridge между OS, браузером, docs, package files и агентами. Пользователь
может открыть `arlecchino://project/...`, theme file или plugin package, и IDE сама
решит, нужен ли existing window, new helper surface или hub mode.

### Current IDE Fit

Текущие точки:

- `main.go` пока не имеет single instance/protocol routing, но создает application и main
  window.
- `app.go` имеет `OpenProject`, `SelectDirectory` и project context wiring.
- `internal/mcp/service_bridge_tools.go` уже умеет открывать UI surfaces.
- `frontend/src/components/BrowserPreview.tsx` уже имеет URL navigation и external
  browser open через Wails runtime.
- `frontend/src/shell/openIntentRouter.ts` уже нормализует internal open intents и
  очередит их до готовности frontend dispatcher.

### Wails v3 Fit

Custom protocols, file associations и single instance handling прямо соответствуют этой
идее.

Документация:

- [Custom protocols](https://v3alpha.wails.io/guides/distribution/custom-protocols/)
- [File associations](https://v3alpha.wails.io/guides/file-associations/)
- [Single instance](https://v3alpha.wails.io/guides/single-instance/)

### Development Shape

Сделать backend `ProtocolRouter`:

- parse URI/file open request;
- validate scheme and payload;
- map to typed intent: `OpenProject`, `OpenFile`, `InstallTheme`, `InstallPlugin`,
  `OpenArlehubRun`, `OpenPreview`, `FocusSurface`;
- if app already running, route to existing process/window;
- if app cold-started, queue intent until frontend ready.

Текущий реализованный slice закрывает только internal in-app часть: `ide:intent:open`
и MCP `ide_ui.open_intent` маршрутизируют `openProject`, `openFile`, `openPreview` и
`focusSurface` через существующие layout/project handlers. Packaged custom protocol,
file associations и Wails single-instance integration остаются отдельным spike после
стабилизации текущего shell layer.

Single-instance spike теперь добавлен, но gated: `ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1`
включает Wails v3 `SingleInstanceOptions`, парсит second-instance launch args (`--open-project`,
`--open-file`, `--open-preview`, first existing path или http(s) URL) и отправляет typed
intent в существующий `ide:intent:open`. Initial launch args проходят тот же parser, но
backend держит pending queue до frontend-ready. Это еще не включает packaged custom protocol
или file associations как default-on capability.

Protocol/File Association packaged probe теперь добавлен поверх того же parser:
`arlecchino://open?project=...`, `arlecchino://open/file?path=...`,
`arlecchino://open?preview=https://...`, `arlecchino://focus?surface=panel:git`,
bare file paths и `file://...` payloads нормализуются в `openProject`, `openFile`,
`openPreview` или `focusSurface`. Это проверяет strict routing contract до OS registration;
`customProtocol` и `fileAssociations` остаются `requires-build`, пока packaged app smoke не
подтвердит настоящую регистрацию и delivery от macOS/Windows/Linux.

### Risks And Checks

Нельзя выполнять arbitrary commands из protocol payload. Нужна строгая allowlist intents.
Проверки: cold start with file, already running open file, unsupported scheme rejected,
malformed payload rejected, theme/plugin flow asks for confirmation.

## 9. Applet Promotion Chain

### Purpose

Applet Promotion Chain - единое поведение, когда applet можно последовательно перевести:
inline/helper -> floating -> snapped -> fullscreen -> detached OS window -> back to main.

### Why It Helps

Это делает floating panels не временным UI, а настоящей системой surfaces. Пользователь
может начать с маленькой Git helper panel, развернуть ее, вынести в окно, вернуть обратно.
Agent может открыть code panel рядом с hub и не ломать layout.

### Current IDE Fit

Текущие точки:

- `frontend/src/components/layout/useMainLayoutPanelDrag.ts` уже умеет drag, snap, float,
  swap между panel и preview window.
- `frontend/src/components/layout/panelLayoutModel.ts` уже содержит позиции, размеры и
  placement heuristics.
- `frontend/src/stores/previewWindowStore.ts` уже имеет mode `floating`/`snapped`,
  position и pinned state.
- `docs/arlehub-architecture.md` прямо говорит, что applet body должен переживать host
  transitions.

### Wails v3 Fit

Wails v3 multiple windows добавляет последнюю ступень promotion chain - detached native
window. Native menus/context menus дают команды "Move to Window", "Return to Main",
"Pin Helper", "Fullscreen Hub".

Документация:

- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Application menus](https://v3alpha.wails.io/features/menus/application/)
- [Context menus](https://v3alpha.wails.io/features/menus/context/)

### Development Shape

Ввести promotion commands:

- `surface.promoteFloating(surfaceId)`;
- `surface.snap(surfaceId, side)`;
- `surface.fullscreen(surfaceId)`;
- `surface.detach(surfaceId, windowRole)`;
- `surface.returnToMain(surfaceId)`.

Для первого этапа не нужно переписывать UI. Можно добавить commands поверх текущих
`openWindow`, `updateWindow`, `openPanel`, drag state. Detached window сделать позже.

Текущий реализованный slice:

- frontend contract: `frontend/src/surfaces/surfacePromotion.ts`;
- read model: `SurfaceRuntimeReadModel.promotion`;
- commands: `promote-floating`, `snap`, `fullscreen`, `return-to-main`, `detach`;
- event route: `ide:surface:promote` принимает `{ surfaceId, kind, position? }`;
- in-window executor меняет существующие `PanelConfig` и `PreviewWindow`, сохраняя
  applet identity/state; fullscreen остается floating geometry `0/0/full workspace`;
- `detach` теперь lease-aware: unsupported surfaces disabled, supported applets остаются
  gated до Window Lease spike/package smoke;
- return-layout hook: `updateSurfacePromotionReturnTargets()` запоминает предыдущий
  `SurfaceSession` при host-mode transition и очищает target при возврате или закрытии;
- out of scope пока остаются native detached windows и Arlehub host mode.

### Risks And Checks

Сложность в сохранении внутреннего applet state. Не надо размонтировать тяжелые applets
без необходимости. Проверки: file panel cursor/scroll state, Git selection, browser URL,
Arlehub chat scroll, terminal session link после promotion.

## 10. Background Job Broker

### Purpose

Background Job Broker - service для долгих задач: indexing, agent runs, builds, updates,
plugin installs, language server setup, execution profiles, sandbox jobs. Он должен
давать unified status, notifications, tray actions и optional dock/taskbar badges.

### Why It Helps

Сейчас разные задачи живут в разных местах. Wails v3 tray/notifications/menus позволяют
сделать desktop-grade feedback: job started, job failed, open logs, cancel, retry, show in
Arlehub.

### Current IDE Fit

Текущие точки:

- `app.go` стартует MCP bridge, configs, LSP installer, language detector и project context.
- `internal/execution/service.go` уже нормализует execution profiles и missing tools.
- `execution_bindings.go` exposes execution request binding.
- `frontend/src/stores/terminalStore.ts` имеет power profile, pause flags и security
  policy для terminal/agent behavior.
- `docs/arlehub-architecture.md` описывает agent run event store и sandbox jobs.

### Wails v3 Fit

Wails v3 systray, notifications, native menus и services подходят для job status surface.
Auto update docs также относятся к этой зоне, но auto-updates нужно отложить до stable
shell.

Документация:

- [Systray](https://v3alpha.wails.io/features/menus/systray/)
- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Events](https://v3alpha.wails.io/reference/events/)
- [Auto updates](https://v3alpha.wails.io/guides/distribution/auto-updates/)

### Development Shape

Job model:

- `JobID`, `Kind`, `OwnerSurfaceID`, `ProjectPath`, `Status`, `Progress`,
  `Cancelable`, `StartedAt`, `UpdatedAt`;
- frontend surfaces: compact job strip, Arlehub run timeline, tray menu, notification;
- actions: cancel, retry, open logs, reveal related surface.

Start with non-invasive broker that observes existing jobs, then move ownership gradually.

Текущий реализованный slice:

- backend model/service: `BackgroundShellStatusService`,
  `BackgroundShellStatusSnapshot`, `BackgroundShellJob`, `BackgroundShellEvent`,
  `BackgroundShellNotificationCandidate`, `BackgroundShellAction`;
- backend binding: `App.GetBackgroundShellStatus()` возвращает snapshot without enabling
  native tray or native notification delivery;
- action binding: `App.RunBackgroundShellAction(actionID)` исполняет contract actions
  without enabling tray UI: `cancel-job` переводит cancelable active job в `canceled`,
  `focus-surface` фокусит main window и эмитит `ide:intent:open`/`focusSurface`;
- observed sources: project indexing, LSP installer progress and MCP bridge lifecycle;
- summary counters distinguish transient active jobs from persistent services, so MCP
  bridge does not look like a running user job;
- notification candidates are generated only from terminal-status job transitions and deduped with
  cooldown; native delivery remains off;
- frontend mirror: `frontend/src/shell/backgroundShellStatus.ts` normalizes camelCase and
  PascalCase payloads, keeps stable revisions, listens to `shell:background:status` and
  can load backend snapshot through Wails v3 `Call.ByName`; it also exposes
  `runBackgroundShellAction()` for future tray/notification/menu consumers;
- packaged OS bridge: `RunPackagedOSIntegrationAction("background:<action>")` routes
  future tray/notification/menu actions into the same Background Shell action contract;
- `frontend/src/App.tsx` starts the bridge without rendering new tray UI;
- contract coverage lives in `background_shell_status_test.go` and
  `frontend/test-scripts/surface-runtime-contracts.test.mjs`.

### Risks And Checks

Не показывать notifications для слишком частых internal events. Нужен debounce/rate limit.
Проверки: long execution job, LSP install job, failed job, cancel job, tray action focuses
correct surface.

## 11. Native Window Roles

### Purpose

Native Window Roles - набор window presets: `main`, `hub`, `helper`, `preview`,
`terminal`, `debug`, `modal-tool`. Каждая роль задает размеры, decorations, menu policy,
shortcut policy, close behavior, transparency/material options.

### Why It Helps

Detached windows не должны все быть одинаковыми. Git helper и Arlehub hub имеют разные
ожидания. Terminal window должен иметь другой shortcut/focus behavior, чем browser preview.

### Current IDE Fit

Текущие точки:

- `main.go` задает одно окно `main` с frameless, transparent, maximised и platform-specific
  options.
- `shell_menu.go` задает menu behavior на app level.
- `frontend/src/components/layout/MainLayoutPanelRenderer.tsx` уже имеет special handling
  для terminal TUI active viewport positioning.
- `frontend/src/stores/previewWindowStore.ts` уже знает surface type, но не знает native
  window role.

### Wails v3 Fit

Wails v3 window options и multi-window позволяют задать разные native windows. Menus и
shortcuts могут зависеть от active window/surface.

Документация:

- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Window options](https://v3alpha.wails.io/features/windows/options/)
- [Application menus](https://v3alpha.wails.io/features/menus/application/)
- [Keyboard shortcuts](https://v3alpha.wails.io/features/keyboard/shortcuts/)

### Development Shape

Создать presets:

- `main`: full IDE shell, full menu, full shortcuts;
- `hub`: Arlehub center, chat/run menus, helper promotion actions;
- `helper`: compact tool window, scoped shortcuts, return-to-main;
- `preview`: browser/file preview, minimal menu;
- `terminal`: terminal-first shortcuts, paste/clear/split/session actions;
- `modal-tool`: dialogs/settings/import flows.

### Risks And Checks

Window roles не должны стать CSS themes. Это native shell policy. Проверки: focus role,
menu role, close role, shortcut role, restore role.

## 12. Cross-Window Focus Arbiter

### Purpose

Focus Arbiter - сервис, который знает, какая surface сейчас active, какой editor/file
context считается current, куда идут shortcuts, где открывать helper panels и какой
window должен получить agent UI action.

### Why It Helps

С одним window focus можно держать во frontend. С Wails v3 multi-window это уже не
сработает. Команда `open file panel` должна знать: открыть рядом с Arlehub hub, в main
editor, в detached Git helper или в active preview window.

### Current IDE Fit

Текущие точки:

- `frontend/src/stores/previewWindowStore.ts` имеет `activeWindowId` и `focusWindow`.
- `frontend/src/components/layout/MainLayout.tsx` вычисляет visible snapped panel/preview
  window и wire events.
- `frontend/src/hooks/useIDEEvents.ts` принимает external UI events и dispatches их.
- `frontend/src/hooks/useDispatcher.ts` blocks dispatcher when paused and handles command
  execution.
- `frontend/src/stores/terminalStore.ts` имеет `tuiModeActive`, `tuiActiveSessionId` и
  pause flags.

### Wails v3 Fit

Window lifecycle/events и keyboard shortcuts должны быть синхронизированы с focus state.
Native menus тоже должны выполнять action в правильном focused surface.

Документация:

- [Events](https://v3alpha.wails.io/reference/events/)
- [Keyboard shortcuts](https://v3alpha.wails.io/features/keyboard/shortcuts/)
- [Application menus](https://v3alpha.wails.io/features/menus/application/)
- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)

### Development Shape

Arbiter state:

- `activeWindowId`;
- `activeSurfaceId`;
- `activeProjectPath`;
- `activeEditorFile`;
- `activeTerminalSessionId`;
- `activeHubRunId`;
- `shortcutContext`;
- `commandTargetPolicy`.

Frontend sends focus events; backend validates and broadcasts canonical focus state.

### Risks And Checks

Не делать focus arbiter слишком медленным: focus changes могут быть частыми. Проверки:
switch between main/hub/detached, menu action target, shortcut target, agent action target.

## 13. Power Profiles

### Purpose

Power Profiles - user-facing режимы интенсивности IDE: normal, agent-heavy,
terminal-first, low-power, focus mode. Они управляют background jobs, LSP/indexer pressure,
dispatcher availability, preview refresh, notifications и agent autonomy.

### Why It Helps

Agentic IDE легко перегружает систему: terminal agent, indexer, LSP, preview reload,
Arlehub graph, build jobs. Power profiles дают понятную ручку управления без множества
разрозненных toggles.

### Current IDE Fit

Текущие точки:

- `frontend/src/stores/terminalStore.ts` уже имеет `powerProfile`, `isDispatcherPaused`,
  `isArlePaused`, `isLSPPaused`, `setPowerProfile`.
- `frontend/src/hooks/useDispatcher.ts` уже закрывает/блокирует dispatcher when paused.
- `frontend/src/components/layout/MainLayout.tsx` скрывает dispatcher в TUI mode и при
  pause logic.
- `terminal.go` и `internal/terminal/agent_launch.go` уже распознают agent CLI launches.

### Wails v3 Fit

Wails v3 notifications/tray/menu shortcuts могут отображать и переключать power profile
на уровне desktop shell. Services дают typed API для profile state.

Документация:

- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Systray](https://v3alpha.wails.io/features/menus/systray/)
- [Application menus](https://v3alpha.wails.io/features/menus/application/)

### Development Shape

Сделать profile policy table:

- `normal`: все включено в обычном режиме;
- `terminal-first`: dispatcher paused, terminal helper UI prioritized, Arlehub not active;
- `hub`: Arlehub GUI center, helpers allowed, terminal TUI independent;
- `low-power`: reduce preview auto-refresh, background indexing pressure, notifications;
- `agent-heavy`: allow more job visibility, event recorder, helper panels.

### Risks And Checks

Профиль не должен неожиданно выключать важные IDE функции. UI должен показывать активный
profile явно. Проверки: starting Codex sets terminal-first behavior, entering Arlehub sets
hub behavior, leaving restores previous profile.

## 14. Event Contract Tests

### Purpose

Event Contract Tests - набор тестов, которые фиксируют shape и behavior событий между
Go, Wails runtime, frontend hooks, MCP tools, dispatcher и panels.

### Why It Helps

Wails v3 migration изменит runtime imports, generated bindings, event normalization и
window routing. Без contract tests легко сломать invisible behavior: event пришел как
array вместо object, ack потерял request ID, panel opened without focus.

### Current IDE Fit

Текущие точки:

- `frontend/src/wails/runtime.ts` нормализует event data к legacy arrays.
- `runtime_safe_log.go` нормализует Go-side event data.
- `frontend/src/hooks/useIDEEvents.ts` нормализует MCP payload и отправляет ack.
- `internal/mcp/service_bridge_tools.go` ожидает confirmed events и rate limits.
- `internal/dispatcher/ide_handlers.go` emits IDE events for panels, preview, editor,
  git, app actions.

### Wails v3 Fit

Wails v3 Events и frontend runtime являются внешним API, который может изменяться в alpha.
Contract tests должны защищать адаптеры, а не Wails internals.

Документация:

- [Events](https://v3alpha.wails.io/reference/events/)
- [Frontend runtime](https://v3alpha.wails.io/reference/frontend-runtime/)

### Development Shape

Добавить scoped tests:

- runtime event normalization test;
- `useIDEEvents` payload/ack test;
- MCP `ide_ui.open_file_panel` event shape test;
- dispatcher action -> event shape test;
- future multi-window event routing test.

### Risks And Checks

Не писать brittle tests на exact UI layout pixels. Фиксировать contract payloads,
required fields и side effects.

## 15. Applet Marketplace Contract

### Purpose

Applet Marketplace Contract - формат, по которому internal/future external applets
описывают capabilities, surfaces, menus, commands, settings, permissions и lifecycle.

### Why It Helps

Если Arlecchino будет расширяться через plugins/themes/provider applets, нужно заранее
не привязывать applet к одному DOM месту. Applet должен объявлять, где он может жить:
floating helper, snapped side, hub center, detached window.

### Current IDE Fit

Текущие точки:

- `app.go` уже регистрирует plugin registry и language framework plugins.
- `docs/arlehub-architecture.md` описывает provider catalog, provider registry,
  subagent runtime и skill residency.
- `frontend/src/stores/previewWindowStore.ts` и `panelLayoutModel.ts` уже фактически
  являются host model для internal applets.
- `internal/mcp/service_bridge_tools.go` уже может открывать UI applets/panels через tools.

### Wails v3 Fit

Wails v3 services/type-safe bindings помогают сделать applet manifest validation и typed
host APIs. Native context menus/menus/shortcuts должны быть частью declared capabilities.

Документация:

- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Context menus](https://v3alpha.wails.io/features/menus/context/)
- [Keyboard shortcuts](https://v3alpha.wails.io/features/keyboard/shortcuts/)
- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)

### Development Shape

Manifest fields:

- `id`, `kind`, `displayName`;
- `allowedHosts`: `main-center`, `floating`, `snapped`, `fullscreen`, `detached`;
- `commands`, `contextMenus`, `shortcuts`;
- `permissions`: filesystem, terminal, network, project metadata, clipboard;
- `statePersistence`: none, session, project, global;
- `agentAddressable`: whether MCP/agent can open/control it.

### Risks And Checks

Не открывать plugin sandbox раньше, чем есть permissions model. Сначала применить contract
к internal applets: Git, Problems, Browser Preview, Arlehub, Terminal helper.

## 16. Browser Preview As Dev Instrument

### Purpose

Browser Preview должен быть не просто embedded browser surface, а development instrument:
понимать terminal semantic events, dev server URLs, reload policy, external browser open,
agent annotations и preview ownership.

### Why It Helps

Для desktop IDE frontend/web workflows важны: user запускает dev server в terminal,
IDE распознает URL, открывает preview, agent может открыть конкретную страницу, Arlehub
может показывать результат run.

### Current IDE Fit

Текущие точки:

- `frontend/src/hooks/useBrowserPreviewBridge.ts` уже слушает terminal semantic events
  `preview_url`, строит preview input и может auto-open/reuse browser preview.
- `frontend/src/components/BrowserPreview.tsx` уже умеет navigate, refresh,
  open external URL через Wails runtime и auto-refresh on `file-saved`.
- `frontend/src/components/PreviewWindowSurface.tsx` рендерит browser preview surface.
- `internal/terminal/pty.go` уже парсит semantic terminal events.
- `internal/terminal/agent_launch.go` уже распознает preview candidate commands.

### Wails v3 Fit

Wails v3 `Browser` runtime, multi-window и events позволяют browser preview быть helper
surface или detached preview window. Context menu может дать actions refresh/open external/
copy URL/inspect route.

Документация:

- [Frontend runtime](https://v3alpha.wails.io/reference/frontend-runtime/)
- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Context menus](https://v3alpha.wails.io/features/menus/context/)

### Development Shape

Добавить ownership:

- preview opened by terminal session;
- preview opened by Arlehub run;
- preview opened manually;
- preview opened by protocol link.

Добавить small dev toolbar actions as commands, not one-off button logic. Later support
detached preview window through Surface Runtime.

### Risks And Checks

URL allowlist already matters. Не расширять browser preview до arbitrary unsafe navigation
без confirmation. Проверки: localhost URL detected, non-local URL policy, refresh on file
save, detached preview return to main.

## 17. Agent-Controllable UI With Guardrails

### Purpose

Agent-controllable UI - возможность agent открывать panels, files, previews, focus targets
и hub context. Guardrails нужны, чтобы эти действия были объяснимыми, ограниченными и
подтверждаемыми там, где есть риск.

### Why It Helps

Arlecchino как agentic IDE выигрывает, когда agent может не только отвечать текстом, но
и собрать рабочую поверхность: открыть файл, показать diff, поднять preview, выделить
diagnostic, открыть terminal helper. Но без guardrails это раздражает и опасно.

### Current IDE Fit

Текущие точки:

- `internal/mcp/service_bridge_tools.go` уже exposes UI tools, request confirmation,
  rate limiting и event payloads.
- `frontend/src/hooks/useIDEEvents.ts` уже ack events and dispatches panel/window actions.
- `frontend/src/stores/previewWindowStore.ts` уже может открыть/focus/close preview window.
- `terminal.go` и `internal/terminal/agent_guide.go` уже объясняют агентам IDE control
  tools и правила.
- `docs/arlehub-architecture.md` уже описывает shared operator context.

### Wails v3 Fit

Wails v3 services/events/multi-window делают agent UI actions cross-window. Native
notifications/tray могут показывать background agent state. Context menus могут дать
user-initiated "ask agent about this" action.

Документация:

- [Services](https://v3alpha.wails.io/features/bindings/services/)
- [Events](https://v3alpha.wails.io/reference/events/)
- [Multiple windows](https://v3alpha.wails.io/features/windows/multiple/)
- [Notifications and tray via Wails feature areas](https://v3alpha.wails.io/features/menus/systray/)

### Development Shape

Guardrail model:

- allow low-risk actions: focus existing surface, open file read-only, open preview;
- confirmation for disruptive actions: close many surfaces, install plugin/theme,
  run external task, detach many windows;
- rate limit bursts;
- record every agent UI action in Agent Flight Recorder;
- expose undo/return-to-previous-layout for layout-changing actions.

### Risks And Checks

Главный риск - agent steals focus. Focus Arbiter должен ограничивать target policy.
Проверки: repeated open panel is deduped/focused, burst is limited, confirmation blocks
risky action, user can return layout.

## Recommended Implementation Order

1. Done: stabilize Wails v3 tooling around repo-local scripts. `./scripts/wails3-dev-macos.sh`
   is the valid smoke path for this branch; the global `wails` CLI path must not be used
   for v3 verification.
2. Done: lock generated bindings policy with `./scripts/wails3-generate-bindings.sh`.
   Generated bindings are written only with `--write`; default dry-run uses temp output.
3. Done: regenerate typed bindings for current shell surface methods and connect
   `GetShellCapabilities` through generated imports.
4. Done: finish first Shell Capabilities integration points: directory dialogs,
   browser open fallback and clipboard runtime fallback.
5. Done: add Event Contract Tests around Surface Runtime operations: open, focus, move,
   promote, close, state, dedupe and failure payloads.
6. Done: wire Surface Runtime events into the existing panel/preview actions so the
   public session boundary is observable without changing current UI behavior.
7. Done: Baseline v3 hardening. Dev runner now owns app lifecycle cleanup, shuts down
   stale output-scoped `mcp-server` processes, and exposes a dev/packaged launch target
   for UI automation.
8. Done: Surface Runtime v1 read/focus boundary. Frontend exposes active surface state,
   focus history and indexed read model; MCP can read it through `ide_ui.surface_read`
   with frontend acknowledgement result payload.
9. Done: Native context menu adapter foundation. Existing scoped DOM menus now share a
   capability-aware adapter that can open transient Wails native menus and dispatch the
   selected action back to frontend, while keeping DOM fallback.
10. Done: adapt ready existing elements to Wails v3 shell capabilities first, with Arlehub
    intentionally out of scope until the base shell layer is stable.
11. Done: add internal Protocol/Open Intent router for current in-app actions only.
12. Later: build Arlehub GUI hub mode as central surface using existing floating helpers.
13. Done: add Agent Flight Recorder v1 on MCP/backend side; Arlehub timeline UI remains later.
14. Done: add Applet Promotion Chain up to fullscreen/floating/snapped first.
15. Done: add Window Lease System foundation for detached-capable applets; native
    detached window creation remains gated/off by default.
16. Done: add packaged OS integration adapter/read model for custom protocol, file
    associations, single-instance/open-file handoff, tray, notifications and badges.
17. Done: add Background Shell Status v1 as read model for future tray/notifications
    without enabling native tray or native notification delivery.
18. Done: prepare real tray, native notification and dock/taskbar badge adapters as
    default-off consumers of Background Shell state; native delivery remains off.
19. Done: add auto-update manifest-read placeholder; material/backdrop remains later.
20. Done: add packaged smoke harness. `wails3-packaged-smoke` and
    `./scripts/wails3-packaged-smoke-macos.sh` produce one report for shell
    capabilities, packaged OS adapters, Background Shell actions, single-instance gate,
    launch/open-intent probe and current Window Lease status without enabling native
    delivery by default.
21. Done: add Window Lease v2 native detached Browser Preview spike. Actual Wails
    detached windows are available only under `ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1`;
    close returns the preview to main through the Open Intent router. Git/Problems/
    Terminal remain lease-supported but not native-detachable yet.
22. Done: add Protocol/File Association packaged probe. Custom protocol URLs and
    `file://`/file-association payloads normalize into the Open Intent allowlist, while
    OS registration capabilities remain `requires-build`.
23. Done: add Native Tray/Notification Dev Gate. Real Wails v3 tray, notification and
    dock/taskbar badge delivery now consume Background Shell state only behind explicit
    packaged spike env flags; native delivery remains default-off.
24. Done: record Decision Gate Matrix. Lifecycle, bindings, promotion, detached windows,
    single-instance, protocol/file-open, tray/notifications and packaging now have
    explicit green/yellow/red status plus blockers before Arlehub or default-on native
    delivery.
25. Done: add packaged binary smoke matrix. The new macOS matrix script validates the
    existing v3 binary smoke path across default, open-file, file URL, custom protocol,
    preview, focus and gated snapshot cases without creating tracked artifacts.
26. Done: harden detached Browser Preview return lifecycle. The return-to-main intent is
    now a pure helper contract that preserves preview identity, current URL payload,
    pinned state and return host/position.
27. Done: add production-shaped Wails v3 `.app` packaging and signing scripts. The bundle
    uses tracked Info.plist metadata, direct Wails binary executable, icon resources,
    ad-hoc local signing and dormant Developer ID/notarization config.
28. In progress: add real OS handoff smoke. The harness is present and detects the current
    blocker: LaunchServices/AppleEvent URL/file delivery does not yet appear in
    `ide:intent:open` trace for the ad-hoc temp `.app`.

## Next Plan: Adapt Existing Elements To Wails v3, No Arlehub

Цель следующего этапа - не строить новые режимы, а перевести уже существующие элементы на
capability-driven v3 shell layer. Это снижает риск перед detached windows и Arlehub.

1. Done: Surface events for existing actions. Подключить `surfaceRuntimeEvents.ts` к текущим
   действиям `open/focus/move/promote/close` в `previewWindowStore`, `MainLayout` и MCP
   UI event handlers. Результат: каждый уже существующий panel/preview transition имеет
   canonical event payload.
2. Done: Surface Runtime read/focus contract. Добавить active surface state, focus history,
   indexed read model и read-only MCP tool `ide_ui.surface_read` через подтвержденный
   frontend ack payload. Detached windows остаются out of scope.
3. Done: Native context menu adapter. `ContextActionMenu` теперь capability-aware:
   существующие File Explorer, editor tab, Git и Problems context menus получают native
   route при usable `contextMenu`, а иначе остаются на DOM/Radix fallback. Browser Preview
   URL остается на audit-доработку вместе с clipboard/browser-open проверкой.
4. Done: Dialog, clipboard and browser URL audit. Текущие вызовы `SelectDirectory`,
   runtime clipboard и browser open идут через `shellDialogs.ts`, `utils/clipboard.ts`
   и `shell/browser.ts`, а не напрямую из компонентов. Browser Preview external-open
   path теперь capability-aware и отклоняет non-http(s) URL payloads.
5. Done: Protocol/open intent router. `ide:intent:open` и MCP `ide_ui.open_intent`
   покрывают `open project`, `open file`, `open preview URL`, `focus surface`; packaged
   custom protocols and file associations остаются gated как `requires-build`.
6. Done: Single-instance/open-file spike. `ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1`
   включает gated Wails v3 single-instance options, launch arg parser и backend queue до
   `ide:frontend:ready`; default capability остается выключенной до packaged smoke.
7. Done: Background shell status. Job/status model для tray/notifications подготовлен
   without enabling tray yet: `backgroundStatus` available, `tray`/`notifications`
   unavailable, UI получает честное состояние через `shell:background:status`, а future
   consumers могут исполнять `cancel-job`/`focus-surface` через action contract.
8. Done: Agent Flight Recorder and guardrails v1. MCP/UI tool calls, UI ack path and live
   approval path пишутся в bounded timeline + append-only disk log; secrets redacted;
   duplicate approval checks in bridge helpers removed.
9. Done: Applet Promotion Chain v1. Surface Runtime exposes promotion commands and
   return targets, and `ide:surface:promote` now applies in-window promotion for
   existing panels/preview windows. Detached windows remain gated for Window Lease.
10. Done: Window Lease System foundation. Surface Runtime exposes lease-supported
    surfaces, close/focus/return/stale policies and lease-aware detach commands for
    preview, Git, Problems and Terminal helper surfaces. Native detached Wails windows
    remain off by default until the spike/package smoke layer.
11. Done: Packaged OS integration adapters. Custom protocol/file associations/tray/
    notifications/dock badges/auto-update now have default-off read models and focused
    tests; Background Shell actions are routable for future tray/notification surfaces.
12. Done: Packaged smoke harness. The Wails v3 spike binary can dump a dev-only smoke
    report through `wails3-packaged-smoke`, and the macOS helper script builds the v3
    target before running the same report with packaged spike env enabled.
13. Done: Native detached Browser Preview spike. Window Lease v2 now creates a real
    Wails window for `preview:*` under explicit spike env, keeps applet identity/payload,
    reports active leases to Surface Runtime and restores the preview to main on close.
14. Done: Protocol/File Association packaged probe. `arlecchino://` and `file://`
    launch payloads now normalize through the backend Open Intent parser, with strict
    allowlist semantics and `requires-build` capabilities until packaged OS smoke.
15. Done: Native Tray/Notification Dev Gate. Tray menu mirrors only Background Shell
    actions, notifications use existing dedupe candidates, and dock/taskbar badge mirrors
    attention count only when packaged spike env flags explicitly enable native delivery.
16. Done: Decision Gate doc. Current Wails v3 shell migration status is captured as a
    green/yellow/red matrix with blockers before Arlehub and before default-on native OS
    integrations.
17. Done: Packaged binary smoke matrix. `./scripts/wails3-packaged-smoke-matrix-macos.sh`
    builds the v3 binary once and validates default/open-file/file-url/protocol/preview/
    focus/gated report paths; `.app` packaging remains next gate.
18. Done: Detached preview lifecycle hardening. Browser Preview close/return now keeps
    `surfaceId`, `previewWindowId`, URL payload, title, pinned state and return target
    intact through the Open Intent router.

Arlehub можно начинать только после пунктов 1-5: тогда hub будет использовать уже
готовые surface events, command routing и capability checks, а не создавать параллельную
shell-модель.

## Non-Goals For The Next Phase

- Do not build Diagnostics Donut 2.0.
- Do not make Arlehub a TUI hub.
- Do not rewrite the entire layout system before adding an adapter layer.
- Do not hand-edit generated Wails bindings.
- Do not make auto-updates the first migration driver.
- Do not expose plugin applets to external code before permissions and manifest contracts.

## Minimal Definition Of Done For Wails v3 Shell Work

For each new shell capability:

- It has a typed Go service or a documented adapter boundary.
- It has a frontend wrapper/hook instead of direct scattered runtime calls.
- It has a fallback when capability is unavailable.
- It has a narrow test or smoke check.
- It records or emits enough state for Arlehub/agents to explain what happened.
- It does not conflate terminal TUI mode with Arlehub GUI hub mode.
