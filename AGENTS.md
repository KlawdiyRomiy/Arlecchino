# AGENTS.md

## Purpose

- Этот файл задает короткую исполняемую политику для агентов в репозитории Arlecchino.
- Держи его как рабочий набор правил, а не как энциклопедию.

## Priority Order

1. Safety, tool reality, and ask-first boundaries.
2. Direct user instructions.
3. Default mode: one-shot complete implementation.
4. Verification before claiming success.
5. Style and preferences.

Если правила конфликтуют:
- предпочитай доступные инструменты недоступным;
- предпочитай узкие проверки тяжелым full-suite прогонам;
- задай один короткий вопрос только если неоднозначность меняет результат.

## Commands (Start Here)

### Fast, file-scoped checks (prefer these)
```bash
# Go (from project root)
go fmt ./path/to/file.go
go vet ./internal/indexer/brain/...
go test ./internal/predictive/...
go test -run TestName ./internal/predictive/

# Frontend (from frontend/)
npx prettier --check "src/path/to/file.tsx"
npx prettier --write "src/path/to/file.tsx"
npx playwright test tests/smoke.spec.ts
```

### Full project commands (only when explicitly requested)
```bash
# Development (from project root)
wails dev
wails build

# Go (from project root)
go test ./internal/...
go vet ./...
go fmt ./...

# Frontend (from frontend/)
npm run dev
npm run build
npm run test:smoke
npx prettier --check "src/**/*.{ts,tsx}"
npx prettier --write "src/**/*.{ts,tsx}"
```

Rule: prefer fast, file-scoped commands. Full builds/tests only when explicitly requested or when broad final verification is actually needed.

## Default Mode: One-Shot

- Если задача ясна и локальна, выполняй ее одним цельным implementation pass.
- Сначала быстро прочитай релевантные файлы и существующий паттерн.
- Затем сделай минимальное, но полностью законченное end-to-end изменение.
- Не останавливайся на scaffolding, если оставшаяся работа очевидна и выполнима сейчас.
- Не оставляй placeholder logic, TODO-only patches или наполовину подключенное поведение.
- Не сообщай об успехе без релевантной проверки.

### One-shot means

- один законченный diff, а не серия полу-правок;
- functional completeness, а не подготовка заготовок;
- минимальный change set, а не разрастание scope;
- проверка до финального ответа.

## Execution Flow

1. Прочитай релевантные файлы и посмотри текущие изменения в затронутой области.
2. Проверь, не попадает ли задача в `Ask First`.
3. Если задача простая и ясная, реализуй ее сразу в one-shot режиме.
4. Если задача нетривиальная, составь короткий план; используй todo tool, если он доступен, и спрашивай пользователя только если без этого меняется решение.
5. Запусти самые узкие релевантные проверки.
6. Коротко отчитайся: что изменено, что проверено, какие риски остались.
7. Сохраняй долгоживущие решения, багфиксы и полезные паттерны в `mnemonic`.

## Ask First

- Add or upgrade dependencies (`go get`, `npm install`).
- Change database schema or persistence contracts.
- Modify `wails.json`, `go.mod`, `go.sum`, release config, or CI config.
- Regenerate Wails bindings.
- Delete or move files.
- Run full build/test suites.
- Perform git write operations (`git add`, `commit`, `push`, `pull`, `merge`, `rebase`).

## Never Do

- Edit `frontend/wailsjs/**` manually.
- Touch `node_modules/`, `vendor/`, or `.git/`.
- Add AI/LLM dependencies.
- Use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Delete failing tests to make the suite pass.
- Commit secrets (`.env`, credentials, tokens).
- Invent APIs or guess uncertain external signatures when docs are available.
- Ignore error handling when validation or propagation is needed.
- Leave partial implementation when the local task can be finished now.
- Claim completion without relevant verification.
- Use `useEffect` for derived state or local bookkeeping. Use it only to synchronize with external systems.

## Bug Fix Rule

- Если пользователь сообщает о баге, сначала воспроизведи его focused test-ом, когда это практически возможно.
- Затем исправь root cause и докажи фикс проходящим тестом.
- Используй subagents выборочно: для неясной root cause или шумного multi-file investigation, если они доступны.

## Tool Preferences

- Prefer `Read`, `Grep`, and `Glob` for file reading and search.
- Prefer file-scoped and package-scoped commands over repo-wide commands.
- Use Context7 for unfamiliar external APIs when available.
- Use Tree-sitter, SQLite, and Playwright only when задача действительно выигрывает от них.
- Use subagents for self-contained side investigations; не превращай их в ритуал.
- Avoid `cat`, `head`, `tail`, `find`, and `grep` via bash when dedicated tools exist.

## Verification

- Всегда запускай самые узкие релевантные проверки для затронутых файлов или пакетов.
- `internal/predictive/**`: run `go test ./internal/predictive/...`.
- `internal/indexer/**`: run `go test ./internal/indexer/...` or narrower.
- `frontend/src/**`: from `frontend/`, run `npx prettier --check` for changed files.
- Visible UI changes: verify with Playwright or screenshot evidence if the app is running and the change affects visible behavior.
- Unfamiliar external APIs: verify docs before coding when a docs tool is available.
- Если tools for diagnostics are available, use them; не делай недоступный инструмент обязательным блокером.
- Перед завершением задачи обязательно дай diff summary: files changed, intent, checks run, remaining risks.

## Critical Files

- `app.go`
- `completion.go`
- `internal/indexer/core/store.go`
- `internal/indexer/brain/prediction.go`
- `frontend/src/components/CodeEditor.tsx`
- `frontend/src/hooks/useSmartComplete.ts`

If you touch these files:
- explain why in the final report;
- run narrow relevant checks;
- record a significant decision, bug fix, or pattern in `mnemonic`.

## Communication Style

- Язык: русский.
- По умолчанию отвечай кратко, прямо и по делу.
- Если пользователь просит объяснение или изменение рискованное, объясняй подробнее и с причинами.
- Без пустых фраз и лишнего ритуала.
- Сам код должен быть самодокументируемым; комментарии оставляй редкими и полезными.

## Code Style Defaults

- Keep diffs minimal and localized to the task.
- Prefer existing adapters, plugins, and project patterns before adding new abstractions.
- Write deterministic code and avoid speculative architecture.
- Think about edge cases, performance, and security, but не раздувай diff без необходимости.
- TypeScript must stay strict; avoid `any` unless there is a documented, unavoidable reason.
- For hot paths and proven bottlenecks, prefer fewer allocations, explicit slice capacities, and straightforward data flow.

## UI Defaults

- Prefer fast, clear interactions, visible loading states, larger hit targets, minimal tooltips, and honest cancel paths.
- Preserve the existing product style unless the user explicitly asks for redesign.

## Project Notes

- Arlecchino is a Wails desktop IDE: Go backend + React frontend + SQLite + Tree-sitter.
- Predictive and indexing flows are sensitive; prefer minimal changes in `completion.go`, `internal/indexer/**`, and `internal/predictive/**`.
- Generated frontend bindings live in `frontend/wailsjs/**`.
