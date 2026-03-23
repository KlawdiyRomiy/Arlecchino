# AGENTS.md

## Commands (Start Here)

### Fast, file-scoped checks (prefer these)
```bash
# Go (single file / package)
go fmt ./internal/predictive/ast.go
go vet ./internal/indexer/brain/...
go test -run TestASTAnalyzer_PHP ./internal/predictive/
go test -v -run TestExtractPrefixWithAccessChain ./internal/predictive/
go test ./internal/predictive/...

# Frontend (from frontend/)
npx prettier --check "src/path/to/file.tsx"
npx prettier --write "src/path/to/file.tsx"
npx playwright test tests/smoke.spec.ts
```
# Wails Build
wails build

### Full project commands (only when explicitly requested)
```bash
# Development (from project root)
wails dev                          # Live dev with hot reload (frontend at :5173, backend at :34115)

# Build
wails build                        # Production build

# Go tests (from project root)
go test ./internal/...             # All internal tests

# Frontend (from frontend/)
npm run dev                        # Vite dev server
npm run build                      # TypeScript + Vite build
npm run test:smoke                 # Playwright smoke tests

# Lint / Format
go vet ./...                       # Go static analysis (from project root)
go fmt ./...                       # Go formatting (from project root)
npx prettier --check "src/**/*.{ts,tsx}"  # TypeScript format check (from frontend/)
npx prettier --write "src/**/*.{ts,tsx}"  # TypeScript format fix (from frontend/)
```

**Rule:** Always prefer fast, file-scoped commands. Full builds/tests only when explicitly requested or before final delivery.

## One-Shot Execution Contract

- По умолчанию выполняй задачу одним цельным implementation pass, если scope ясен и локален.
- Не оставляй код в промежуточном состоянии, если оставшаяся работа очевидна и выполнима сейчас.
- Не разбивай одну логически завершённую задачу на несколько полу-правок.
- Сначала быстро изучи релевантные файлы и существующий паттерн.
- Затем сделай минимальное, но полностью законченное end-to-end изменение.
- После правок обязательно проверь результат узкими проверками и только потом завершай задачу.
- Завершённая задача = рабочее изменение, доказанное проверками, готовое к review.

### One-shot means
- один цельный diff, а не серия полуфабрикатов;
- без placeholder logic;
- без TODO-only patches;
- без “я подготовил структуру” вместо полной реализации;
- без остановки до functional completeness;
- без claim of success без проверки.

---

## Boundaries (Always / Ask / Never)

**Default operating mode:** minimal complete implementation in one coherent pass.

### ✅ Always Do
- Делай не частичные шаги, а минимальное полное решение: explore briefly → implement fully → verify → report.
- Keep diffs minimal and localized to the task.
- Use `Read`, `Grep`, `Glob` for file/search operations (avoid `cat`/`find`/`grep` via bash).
- Prefer existing adapters/plugins before adding new logic.
- Use deterministic logic (no probabilistic/LLM dependencies).
- Write your code changes into your memory (mnemonic).
- When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.
- If you use subagent and he return zero information or didn't work - you must delegate work to another available agent.
- Пиши только код (без markdown-фенсинга, если не просят явно).
- Если нужно объяснить — делай это кратко и только по запросу.
- Учитывай существующий стиль проекта.
- Делай код robust: думай об edge cases, производительности, безопасности.
- Стремитесь к тому, чтобы код невозможно было отличить от написанного топовым human-разработчиком.
- Пиши код с актуальной версией языка или библиотеки.
- Доводи все до конца, ничего не должно быть оставлено на потом. Как ты спланировал делать - так и делай, строго до конца.
- Старайся делать один законченный reviewable diff вместо серии мелких незавершённых правок.
- Если решение очевидно из текущего контекста, не останавливайся на scaffolding — доводи до полной реализации.
- Считай задачу незавершённой, пока поведение не реализовано end-to-end и не подтверждено проверками.

### ⚠️ Ask First
- Add or upgrade dependencies (`go get`, `npm install`).
- Change database schema (`internal/indexer/core/store.go`).
- Modify `wails.json`, `go.mod`, `go.sum`, or CI config.
- Regenerate Wails bindings or edit generated code.
- Delete or move files.
- Run full build/test suites.

### 🚫 Never Do
- - STOP USING 'useEffect' DO NOT USE 'useEffect"! UNLESS ABSOLUTELY NECESSARY. YOU CAN USE A [prevState, setPrevState] = useState()'PARADIGM AND CHECK FOR CHANGES BETWEEN THE PREVIOUS VALUE AND CURRENT VALUE IN THE RENDER FUNCTION.
- Edit generated files in `frontend/wailsjs/**` manually.
- Touch `node_modules/`, `vendor/`, or `.git/`.
- Add AI/LLM dependencies.
- Use `as any`, `@ts-ignore`, `@ts-expect-error`.
- Delete failing tests to make the suite pass.
- Commit secrets (`.env`, credentials).
- Писать избыточные или очевидные комментарии (типа "# Initialize variable" или "# Loop through list").
- Делать код verbose: используй ранние возвраты, тернарные операторы, идиоматичные конструкции языка.
- Добавлять лишние переменные или шаги — стремись к минимализму и читаемости.
- Использовать несуществующие функции/API — всегда проверяй реальность.
- Игнорировать обработку ошибок: всегда добавляй валидацию, meaningful ошибки.
- Дублировать код — создавай функции/классы для переиспользования.
- Импортировать лишние библиотеки или использовать тяжёлые конструкции для простых задач.
- Следовать шаблонным паттернам (переупотребление comprehensions, switch и т.д.) — выбирай наиболее естественный для языка подход.
- Писать слишком «чистый» и generic код без характера — добавляй идиоматичность и небольшие оптимизации, как это делает опытный дев.
- Hardcode значения — используй конфиги/константы.
- Оставлять partial implementation, если остальная часть задачи локальна и понятна.
- Останавливаться после wiring/scaffolding, если можно закончить рабочую реализацию сейчас.
- Описывать, что нужно изменить, вместо того чтобы реально изменить код, если доступ к правке есть.
- Сообщать о завершении, если код не проверен релевантными командами.

### Critical Files (extra caution)
- `app.go`, `completion.go`, `internal/indexer/core/store.go`, `internal/indexer/brain/prediction.go`
- `frontend/src/components/CodeEditor.tsx`, `frontend/src/hooks/useSmartComplete.ts`

If you touch these files: explain why, run narrow tests, and document the change in `mnemonic`.

---

## Evidence Checklist (Definition of Done)
**Изменение должно быть доведено до полностью reviewable состояния за текущий проход работы.**

**Перед завершением задачи обязательно:**
- `lsp_diagnostics` on changed files → **must be clean**.
- Run the narrowest relevant tests and paste output.
- Provide a diff summary (files changed + intent).
- Confirm that no placeholder/stub/TODO-only implementation remains in touched code.
- Update mnemonic memory with decisions/bugs/patterns.

**If you touched:**
- `internal/predictive/**` → run `go test ./internal/predictive/...`.
- `internal/indexer/**` → run `go test ./internal/indexer/...` (or narrower).
- `frontend/src/**` → run `npx prettier --check` for changed files.
- UI/UX behavior → `Playwright: browser_snapshot` + `browser_take_screenshot` для доказательства.
- Autocomplete logic → `SQLite MCP: SELECT` по symbols/entries для проверки данных.
- Незнакомый API → `Context7: query-docs` перед использованием, не после бага.

---

## Workflow: Plan Before Code (memory-first)

### MANDATORY
1. **Read** relevant files first.
2. **Create a plan** using `todowrite` (not a file in repo).
3. **Confirm plan** with user if scope is non-trivial.
4. **Execute** tasks and mark items complete.
4.1. Перед завершением убедись, что не оставлено промежуточных состояний, заглушек, временного кода или незакрытых веток логики.
5. **Record learnings** in `mnemonic` after completion (decisions/bugs/patterns).
6. Если задача ясна и локальна — план должен вести к одному цельному implementation pass, а не к серии частичных правок.

**Важно:** Не создавать `tasks/todo.md` или временные план-файлы. План и прогресс ведутся через `todowrite`, знания — через `mnemonic`.
**Также важно:** Design for testability using "functional core, imperative shell": keep pure business logic separate from code that does IO.

### Plan Mode
- План должен быть максимально кратким; допускается телеграфный стиль ради краткости.
- В конце плана — список нерешённых вопросов (если есть).

---

## Failure Recovery Protocol

- После 1-й ошибки: перечитать лог, проверить правильный файл.
- После 2-й ошибки: остановиться, проверить `lsp_diagnostics`, откатить плохую правку.
- После 3-й ошибки: прекратить изменения, описать попытки, запросить уточнение или консультацию (Oracle).

---

## Tool Usage Rules

### Prefer
- `Read` (чтение файлов)
- `Grep` (поиск по содержимому)
- `Glob` (поиск файлов)
- `lsp_*` (ссылки, определения, диагностика)
- `Edit` (правки)
- `Context7` (документация библиотек — Wails, React, CodeMirror, GORM, Tree-sitter)
- `SQLite MCP` (отладка БД индексера, проверка символов/записей)
- `Tree-sitter MCP` (AST-анализ, поиск паттернов, complexity)
- `Playwright MCP` (визуальная верификация UI, E2E-тесты)

### Avoid
- `cat`, `head`, `tail`, `find`, `grep` через bash.
- `webfetch` для документации библиотек — используй Context7 вместо этого.
- Ручной парсинг AST — используй Tree-sitter MCP.

---

## MCP Tools — Правила использования

### Context7 (документация)
**Когда**: Перед написанием кода с API, в котором не уверен на 100%.
**Как**: `resolve-library-id` → `query-docs` с конкретным вопросом.
**Ключевые библиотеки**:
- `/wailsapp/wails` — runtime, bindings, events, dialogs
- `/go-gorm/gorm` — queries, preload, associations
- `/codemirror/dev` — extensions, state, view, autocomplete
- `/facebook/react` — hooks, effects, React 19 features
- `/nicbarker/clay` — если нужна UI-библиотека

**Правило**: Не угадывай сигнатуры API. Один запрос к Context7 дешевле чем баг от неправильного вызова.

### SQLite MCP (отладка индексера)
**Когда**: Дебаг автокомплита, проверка что индексер записал данные корректно.
**Как**: `open_database` → `execute_read_query` с SELECT.
**Путь к БД**: `data/projects.db` (проекты), `data/*.db` (индексы).
**Типичные запросы**:
```sql
-- Проверить символы после индексации
SELECT name, kind, language FROM symbols WHERE project_id = ? AND name LIKE ?
-- Проверить что проект записан
SELECT * FROM projects WHERE path LIKE ?
-- Оптимизация запросов
EXPLAIN QUERY PLAN SELECT ...
```
**Правило**: Только READ-запросы для отладки. WRITE-запросы — только через Go-код индексера.

### Tree-sitter MCP (AST-анализ)
**Когда**: Рефакторинг, поиск паттернов в коде, анализ сложности.
**Как**: Проект зарегистрирован как `arlecchino`, пути относительно корня репо (например `app.go`).
**Инструменты**:
- `get_ast` — структура файла без чтения целиком
- `find_text` — regex-поиск по всем файлам проекта
- `run_query` — tree-sitter queries (например "все функции с context.Context")
- `analyze_complexity` — метрики сложности файла
**Ограничение**: `get_symbols` не работает (баг в Python bindings). Используй `get_ast` + `find_text` как замену.

### Playwright MCP (UI-верификация)
**Когда**: После изменений в frontend/src/**, перед утверждением UI-изменений.
**Как**: `wails dev` должен быть запущен → `browser_navigate` localhost:34115.
**Workflow**:
1. `browser_snapshot` — accessibility tree, структура DOM
2. `browser_take_screenshot` — визуальная проверка
3. `browser_type` / `browser_click` — интерактивное тестирование
4. `browser_console_messages` — ошибки/warnings
5. `browser_network_requests` — IPC-вызовы к Go backend
**Правило**: Каждое UI-изменение ДОЛЖНО быть подтверждено скриншотом или snapshot. Не принимать "выглядит ок" без доказательства.

---

## Context Management

- Всегда начинай с `git log`, `git diff`, `mnemonic search`, `todoread`.
- После каждого изменения **обязательно** обновляй память (`mnemonic mode="add"`).
- Если контекст неясен — читай код, не гадай.
- Если задача сложная — уточняй требования до начала кодинга.

---
## Rules of UI
> every interaction happens in 100ms
> no product tours
> not more than 3 colors
> less but visible scrollbars
> skeleton loading states
> copy paste from clipboard
> larger hit targets for buttons/inputs
> honest one click cancel
> very minimal tooltips
> optical alignment vs geometric
> optimized for L to R reading
> reassurance about loss

## IMPORTANT: Как оптимизировать приложение и улучшить производительность (делать такое всегда!). При генерации, ревью или оптимизации любого Go-кода обязательно соблюдай следующие правила:

- Запрещай лишние конверсии типов. Никогда не используй string(b), []byte(s) и подобные в циклах/hot-path. Работай только в одном типе данных.
- Обязательно переиспользуй буферы. Для bytes.Buffer, strings.Builder и временных структур используй sync.Pool или переиспользуй один экземпляр. Новое создание — только если без него никак.
- Всегда указывай capacity слайсов. При создании слайса с известным размером пиши make([]T, 0, n). Без capacity — запрещено.
- Контролируй escape-анализ. Перед коммитом проверяй go build -gcflags=-m. Всё, что уходит в heap, должно быть обоснованно. Максимально держи данные в стеке.
- Оптимизируй конкатенацию строк. Никогда не используй s += part в циклах. Только strings.Builder (или strings.Join при возможности).

!!! Главное твое правило:
Меньше аллокаций = меньше работы GC = ниже latency и выше стабильность.
Всегда начинай анализ производительности с метрик памяти (allocs/op, B/op, heap), а не с CPU.

## Project Overview

**Arlecchino** — High-performance polyglot IDE built with Wails (Go backend + React frontend). No AI dependencies. Focus on predictive code intelligence and framework-aware tooling.

**Stack**: Go 1.26 (previosly was 1.23 but now we working on 1.26 ver.) | React 19 | TypeScript | CodeMirror | SQLite (GORM/WAL) | Tree-sitter | Wails v2.11

---

## Project Structure

```
./
├── app.go                    # Main App struct, Wails bindings entry
├── completion.go             # Autocomplete API (GetEditorCompletions)
├── definition.go             # Go-to-definition API
├── lsp_bindings.go           # LSP Wails bindings
├── system_bindings.go        # System operations bindings
├── filesystem.go             # File system operations
├── internal/
│   ├── indexer/
│   │   ├── core/             # Core indexer engine (SQLite store, scheduler)
│   │   ├── brain/            # PredictionBrain - autocomplete aggregator
│   │   ├── adapters/         # Language adapters (php.go, go.go, typescript.go, python.go, laravel.go)
│   │   └── lsp/              # LSP client management
│   ├── predictive/           # AST analysis, context detection, pattern matching (6,383 LOC)
│   ├── plugins/              # Framework plugins (laravel/, django/, rails/, common/)
│   ├── composer/             # Composer.json integration
│   ├── terminal/             # PTY terminal management
│   └── project/              # Project management, DB storage
└── frontend/
    ├── src/
    │   ├── components/       # React components (CodeEditor, FileExplorer, TerminalPanel, etc.)
    │   ├── hooks/            # Custom hooks (useSmartComplete, useLaravelIndexing, etc.)
    │   ├── stores/           # Zustand stores (editorStore, projectStore, explorerStore)
    │   ├── utils/            # CodeMirror extensions, helpers
    │   └── App.tsx           # Root component
    ├── wailsjs/go/main/      # Generated Wails Go bindings
    └── tests/                # Playwright tests
```

---

## Architecture

### Data Flow: Autocomplete
```
Frontend GetEditorCompletions(ctx)
  → PredictionBrain.ExtractPrefix() [Tree-sitter]
  → brain.Complete(ctx)
      ├─ fromLocal()      → current file symbols
      ├─ fromPredictive() → patterns + scaffolds
      ├─ fromIndex()      → SQLite DB query
      ├─ fromLSP()        → language server
      └─ fromVirtual()    → pending symbols
      → Deduplicate → Rank → Limit(50)
  → Frontend CodeMirror/CompletionPopup
```

### Symbol Sources (priority order)
`LSP > Predictive > Index > Local > Virtual`

### Plugin System
- `internal/plugins/plugin.go` — Plugin interface
- Plugins: `laravel`, `django`, `rails`, `common` (git)
- Plugins implement: `IsApplicable()`, `Init()`, terminal commands, pending entries

---

## Code Style

### Go
- Go 1.23 features (range over func, etc.)
- Errors via return, never panic
- Tests: `*_test.go` next to source
- Table-driven tests with `t.Run()`
- Use `t.Fatalf` for fatal errors, `t.Errorf` for assertions
- Struct receivers: `(a *App)`, `(e *Engine)`
- Internal packages: unexported by default

### TypeScript/React
- React 19 functional components
- Strict TypeScript (`strict: true` in tsconfig)
- Zustand for state (`stores/`)
- TailwindCSS v4 for styling
- Hooks in `hooks/` directory
- Wails bindings: `import * as App from '../wailsjs/go/main/App'`

### Imports
```go
// Go: stdlib, then external, then internal
import (
    "context"
    "fmt"

    "github.com/wailsapp/wails/v2/pkg/runtime"

    "arlecchino/internal/indexer/core"
)
```

```typescript
// TypeScript: react, external, internal, relative
import React, { useState } from 'react';
import { useStore } from 'zustand';
import * as App from '../wailsjs/go/main/App';
import { useEditorStore } from '../stores/editorStore';
```

---

## Code Examples (Good vs Bad)

### Go: Guard clauses + cache in completions
✅ Good (фрагмент из `internal/indexer/brain/prediction.go`):
```go
if ctx.InComment {
	return nil
}

if b.completionCache != nil {
	if cached, ok := b.completionCache.Get(ctx); ok {
		return cached
	}
}

b.mu.RLock()
stringCompletions := b.stringCompletions
importCompletions := b.importCompletions
b.mu.RUnlock()

if ctx.InImport && importCompletions != nil {
	impSuggestions := importCompletions.GetCompletions(ctx)
	if len(impSuggestions) > 0 {
		return impSuggestions
	}
}

if ctx.InString {
	if ctx.StringContextType != "" && stringCompletions != nil {
		strSuggestions := stringCompletions.GetCompletions(ctx)
		if len(strSuggestions) > 0 {
			return strSuggestions
		}
	}
	return nil
}
```

❌ Bad (делает работу в комментариях/строках и игнорирует кэш):
```go
suggestions := b.fromIndex(ctx)
if ctx.InComment || ctx.InString {
	return suggestions
}
return suggestions
```

### Go: Defaults only when unset
✅ Good (фрагмент из `internal/indexer/brain/prediction.go`):
```go
if config.MaxSuggestions == 0 {
	config.MaxSuggestions = 50
}
if config.MinConfidence == 0 {
	config.MinConfidence = 0.1
}
if config.VirtualTTL == 0 {
	config.VirtualTTL = 5 * time.Minute
}
```

❌ Bad (перетирает конфиг пользователя):
```go
config.MaxSuggestions = 50
config.MinConfidence = 0.1
config.VirtualTTL = 5 * time.Minute
```

### React/TypeScript: Null guards + safe updates
✅ Good (фрагмент из `frontend/src/hooks/useSmartComplete.ts`):
```ts
const clearGhostText = useCallback(() => {
  const editorInstance = editorRef.current;
  if (editorInstance && ghostDecorationsRef.current.length > 0) {
    ghostDecorationsRef.current = editorInstance.deltaDecorations(
      ghostDecorationsRef.current,
      []
    );
  }
  stateRef.current = {
    ...stateRef.current,
    isVisible: false,
    ghostText: "",
    currentItem: null,
    insertRange: { startColumn: 0, endColumn: 0, lineNumber: 0 },
  };
}, [editorRef]);
```

❌ Bad (нет проверок и ломает инварианты состояния):
```ts
const clearGhostText = () => {
  editorRef.current.deltaDecorations(ghostDecorationsRef.current, []);
  stateRef.current.isVisible = false;
};
```

---

## Conventions

### File Organization
- Business logic: `internal/` packages
- Wails bindings: root `*.go` files
- Language adapters: `internal/indexer/adapters/`
- Framework plugins: `internal/plugins/<framework>/`
- React components: `frontend/src/components/`
- CodeMirror extensions: `frontend/src/utils/`

### Naming
- Go: `CamelCase` exported, `camelCase` unexported
- TypeScript: `PascalCase` components, `camelCase` functions/hooks
- Test functions: `TestFunctionName_Scenario`
- Hooks: `use<Name>.ts`
- Stores: `<name>Store.ts`

### Testing
- Go: Table-driven tests with descriptive names
- Frontend: Playwright for smoke/integration, use `data-testid` attributes
- Tests in same directory as source (Go) or `tests/` (Playwright)

### Database
- SQLite with WAL mode
- GORM for ORM
- Schema in `internal/indexer/core/store.go`
- Symbols table: indexed on ProjectID, Name, Kind, Language, Namespace

---

## Safety

### Never
- `as any`, `@ts-ignore`, `@ts-expect-error` — fix the type
- Empty catch blocks — handle or propagate errors
- Delete failing tests to pass — fix the root cause
- Panic in library code — return errors
- Commit `.env`, credentials, or secrets

### Git Operations
- Read-only allowed: `git status`, `git diff`, `git log`, `git show`, `git branch -l`
- Write operations require explicit user request: `git add`, `commit`, `push`, `pull`, `merge`, `rebase`

### Performance
- Debounce IPC calls (100-200ms)
- SQLite queries: use indexed columns (ProjectID, Name, Kind)
- React: `React.memo` for heavy components, `useMemo`/`useCallback` to prevent re-renders
- Lazy loading for non-essential modules

---

## Git Workflow (GitHub)

> Проект публикуется на GitHub: https://github.com/KlawdiyRomiy/Arlecchino
> Все правила ниже написаны с учётом пуша на удалённый репозиторий.

### Ветки
| Ветка | Назначение |
|-------|-----------|
| `main` | Всегда рабочий код. То, что можно собрать и отдать. |
| `feat/<name>` | Новая фича. От main → в main. |
| `fix/<name>` | Баг-фикс. От main → в main. |

Отдельная ветка для тестов **не нужна** — тесты живут в feature/fix ветках.

### Ежедневная работа
```bash
git checkout -b feat/<name>          # 1. Новая ветка от main
# ... пишешь код, коммитишь ...
git checkout main                    # 2. Переключиться на main
git merge feat/<name>                # 3. Merge (или squash merge)
git push origin main                 # 4. Push на GitHub
git branch -d feat/<name>            # 5. Удалить локальную ветку
```

### Коммиты — Conventional Commits
```
feat: add terminal tab support
fix: prevent page reload on binding regeneration
refactor: extract completion cache to separate module
docs: update AGENTS.md with new workflow
chore: update dependencies
test: add tests for PHP adapter
```
Формат: `<type>: <описание на английском>`. Без заглавной буквы после двоеточия, без точки в конце.

### Релизы
```bash
git tag v0.1.0                       # Семантическое версионирование
git push origin v0.1.0               # Push тега
# wails build → create-dmg → GitHub Release для этого тега
```

### Хотфиксы после релиза
```bash
git checkout -b fix/<name>           # От main
# ... фиксишь ...
git checkout main && git merge fix/<name>
git tag v0.1.1                       # Патч-версия
# Новый билд → новый DMG → новый GitHub Release
```

### Запрещено
- Коммитить напрямую в main — всегда через ветку → merge
- `git push --force` в main (исключение: одноразовая инициализация репо)
- Копить огромные ветки неделями — мержить часто, маленькими порциями

---

## Communication Style

- Язык: ТОЛЬКО русский
- Объяснения: подробные, для джуна — объяснять ПОЧЕМУ, не только ЧТО
- Без пустых фраз ("отличный вопрос", "конечно", "с удовольствием")
- Краткость в коде, подробность в объяснениях
- Самодокументируемый код — понятные имена вместо комментариев
- Use Read tool for file reading, not `cat`/`head`/`tail`

---

## Mnemonic — Долгосрочная память

### Типы памяти

| Уровень | Scope | Что хранится | Когда сохранять |
|---------|-------|--------------|-----------------|
| **PERMANENT** | user | Preferences, стиль работы | При явном "запомни" |
| **PROJECT** | project | Архитектура, решения, баги | После завершения задачи |
| **SESSION** | project | Текущая работа, TODO | Перед compaction |

### Workflow: Начало работы

**ПЕРЕД началом любой задачи:**
```
1. git log -5 --oneline          # Понять что было недавно
2. git diff                       # Есть ли незакоммиченные изменения
3. mnemonic mode="search" scope=project  # Загрузить проектный контекст
4. todoread                       # Есть ли незавершённые задачи
```

### Workflow: После изменений

**ПОСЛЕ каждого изменения файла:**
```
1. go build / npm run build / wails build  # Проверить билд
2. go test ./... / npm test               # Запустить тесты
3. lsp_diagnostics                         # Проверить ошибки
```

### Автосохранение в память

Автоматически сохранять после успешного завершения:
- **Архитектурные решения**: почему выбран подход X вместо Y
- **Исправленные баги**: причина + решение (чтобы не повторять)
- **Паттерны которые сработали**: для переиспользования
- **Не докладывай пользователю что ты сохранил. Он видит твои сохранения, так что вместо сообщений про "Сохранил значимые записи" пиши подробные отчеты.

```
mnemonic mode="add" scope=project type="learned-pattern" content="..."
```

---

## Agent Usage (Parallel Execution)

**ALWAYS use parallel agents for complex tasks.** Main agent handles core work, sub-agents handle specialized tasks simultaneously.

**AND ALWAYS MAKE A TO-DO LIST BEFORE CODING OR REFACTORING.

### Strategy
```
Main Agent (orchestrator):
  ├─ Launches 5-15 background agents in parallel
  ├─ Handles critical/complex fixes directly
  ├─ Collects and synthesizes agent results
  └─ Makes final decisions

Sub-Agents (specialists):
  ├─ explore: Codebase search, pattern discovery
  ├─ debugger: Root cause analysis, fix verification
  ├─ bug-hunter: Code review, bug identification
  ├─ brahma-investigator: Deep investigation with think protocol
  ├─ security-auditor: State isolation, data flow review
  ├─ code-quality-reviewer: Thread safety, code smells
  └─ frontend-developer: React/TypeScript/CodeMirror work
```

### Rules
1. **Fire early, fire many** — launch agents at task start, not as fallback
2. **Full context** — pass expected behavior, current bugs, specific files
3. **Structured output** — request specific format (ROOT CAUSE, FIX, VERIFICATION)
4. **No waiting** — continue main work while agents analyze
5. **Synthesize** — combine agent findings before implementation

### Example Prompt Structure
```
## TASK: [specific goal]
### EXPECTED BEHAVIOR: [user's vision]
### CURRENT BUG: [symptoms with logs]
### FILES TO ANALYZE: [paths]
### OUTPUT FORMAT: [structured template]
```

### When to Use
- Multi-file bugs → launch explore agents per module
- Unknown root cause → brahma-investigator + debugger
- Code quality concerns → code-quality-reviewer + security-auditor
- Frontend work → frontend-developer (ALWAYS delegate visual changes)

---

## Key Files Reference

| Purpose | File |
|---------|------|
| App entry, bindings | `app.go` |
| Autocomplete API | `completion.go` |
| Core indexer | `internal/indexer/core/engine.go` |
| Prediction brain | `internal/indexer/brain/prediction.go` |
| AST analysis | `internal/predictive/ast.go` |
| Plugin interface | `internal/plugins/plugin.go` |
| Laravel plugin | `internal/plugins/laravel/plugin.go` |
| React root | `frontend/src/App.tsx` |
| Code editor | `frontend/src/components/CodeEditor.tsx` |
| CodeMirror completions | `frontend/src/hooks/useSmartComplete.ts` |

---

## Project Vision

Arlecchino — детерминированный автокомплит, агентский хаб для оркестровки и управление IDE через MCP Tool для полного контроля IDE и даже переделку его через этот tool.

**Философия**: "Faster than Zed, smarter than JetBrains"

**Отличия от конкурентов**:
- Работает offline, без API задержек
- Предсказуемое поведение (нет галлюцинаций)
- Низкое потребление ресурсов
- Framework-aware (понимает Laravel/Django/Rails conventions)

**Уникальные фичи**:
- Predictive Engine (6,383 LOC) — контекстный анализ без ML
- Terminal Predictions — ghost text для artisan/manage.py
- Virtual Store — autocomplete для несохранённых файлов
- Hybrid Parsing — regex (быстро) + Tree-sitter (точно)

---

## Stack

### Go Version
- **Текущий**: 1.26.1

### Dependencies
- React 19.2.1, Zustand 5.0.8, Tailwind 4.1.17 — актуальны
- Tree-sitter — проверить обновления грамматик
