import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  search,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, type Extension } from "@codemirror/state";
import {
  EditorView,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { EDITOR_FIND_IN_FILE_EVENT } from "./searchEvents";

const maxCountedMatches = 999;
export { EDITOR_FIND_IN_FILE_EVENT };

export const shouldHandleEditorFindInFile = (view: EditorView): boolean => {
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLElement && view.dom.contains(activeElement)
  );
};

export const openEditorFileSearch = (view: EditorView): boolean => {
  return openSearchPanel(view);
};

const createButton = (
  name: string,
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.name = name;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
};

class CodeMirrorFileSearchPanel implements Panel {
  readonly dom: HTMLElement;

  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly matchCount: HTMLSpanElement;

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom = document.createElement("div");
    this.dom.className = "cm-search cm-mini-search";
    this.dom.dataset.testid = "editor-file-search";
    this.dom.addEventListener("keydown", (event) => this.handleKeyDown(event));

    this.searchField = document.createElement("input");
    this.searchField.type = "text";
    this.searchField.name = "search";
    this.searchField.value = this.query.search;
    this.searchField.placeholder = "Find in file";
    this.searchField.className = "cm-textfield";
    this.searchField.setAttribute("aria-label", "Find in file");
    this.searchField.setAttribute("main-field", "true");
    this.searchField.dataset.testid = "editor-file-search-input";
    this.searchField.addEventListener("input", () => this.commit());

    this.matchCount = document.createElement("span");
    this.matchCount.className = "cm-mini-search-count";
    this.matchCount.dataset.testid = "editor-file-search-count";
    this.matchCount.setAttribute("aria-live", "polite");

    const previousButton = createButton("prev", "↑", "Previous match", () =>
      findPrevious(this.view),
    );
    const nextButton = createButton("next", "↓", "Next match", () =>
      findNext(this.view),
    );

    const closeButton = createButton("close", "x", "Close search", () => {
      closeSearchPanel(this.view);
      this.view.focus();
    });

    this.dom.append(
      this.searchField,
      this.matchCount,
      previousButton,
      nextButton,
      closeButton,
    );
    this.syncSearchStatus();
  }

  mount(): void {
    this.searchField.select();
  }

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
        }
      }
    }

    if (update.docChanged || update.selectionSet) {
      this.syncSearchStatus();
    }
  }

  get pos(): number {
    return 80;
  }

  get top(): boolean {
    return true;
  }

  private querySpec() {
    return {
      search: this.searchField.value,
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    };
  }

  private commit(): void {
    const nextQuery = new SearchQuery(this.querySpec());
    if (nextQuery.eq(this.query)) {
      return;
    }

    this.query = nextQuery;
    this.dispatchQuery();
  }

  private dispatchQuery(): void {
    this.view.dispatch({ effects: setSearchQuery.of(this.query) });
    this.activateFirstMatch();
    this.syncSearchStatus();
  }

  private setQuery(query: SearchQuery): void {
    this.query = query;
    this.searchField.value = query.search;
    this.syncSearchStatus();
  }

  private syncSearchStatus(): void {
    this.dom.dataset.invalid =
      this.query.search && !this.query.valid ? "true" : "false";

    if (!this.query.search || !this.query.valid) {
      this.matchCount.textContent = "0";
      this.matchCount.setAttribute("aria-label", "No search matches");
      return;
    }

    const selection = this.view.state.selection.main;
    let total = 0;
    let activeIndex = 0;
    const cursor = this.query.getCursor(this.view.state, 0);

    for (;;) {
      const next = cursor.next();
      if (next.done) {
        break;
      }

      total += 1;
      if (
        !selection.empty &&
        next.value.from === selection.from &&
        next.value.to === selection.to
      ) {
        activeIndex = total;
      }
      if (total >= maxCountedMatches) {
        break;
      }
    }

    const totalLabel =
      total >= maxCountedMatches ? `${maxCountedMatches}+` : String(total);
    this.matchCount.textContent = `${activeIndex}/${totalLabel}`;
    this.matchCount.setAttribute(
      "aria-label",
      `${this.matchCount.textContent} search matches`,
    );
  }

  private activateFirstMatch(): void {
    if (!this.query.search || !this.query.valid) {
      return;
    }

    const next = this.query.getCursor(this.view.state, 0).next();
    if (next.done) {
      return;
    }

    const selection = EditorSelection.single(next.value.from, next.value.to);
    this.view.dispatch({
      selection,
      effects: EditorView.scrollIntoView(selection.main),
      userEvent: "select.search",
    });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      if (event.shiftKey) {
        findPrevious(this.view);
      } else {
        findNext(this.view);
      }
    }
  }
}

export const codeMirrorFileSearchExtension: Extension = search({
  top: true,
  createPanel: (view) => new CodeMirrorFileSearchPanel(view),
});
