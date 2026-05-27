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

const svgNamespace = "http://www.w3.org/2000/svg";
type SearchIconName = "search" | "chevron-up" | "chevron-down";

const createSearchIcon = (
  name: SearchIconName,
  size: number,
): SVGSVGElement => {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  if (name === "search") {
    const circle = document.createElementNS(svgNamespace, "circle");
    circle.setAttribute("cx", "11");
    circle.setAttribute("cy", "11");
    circle.setAttribute("r", "8");
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", "m21 21-4.3-4.3");
    svg.append(circle, path);
    return svg;
  }

  const polyline = document.createElementNS(svgNamespace, "polyline");
  polyline.setAttribute(
    "points",
    name === "chevron-up" ? "18 15 12 9 6 15" : "6 9 12 15 18 9",
  );
  svg.append(polyline);
  return svg;
};

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
  icon: SearchIconName,
  title: string,
  onClick: () => void,
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.name = name;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.append(createSearchIcon(icon, 16));
  button.addEventListener("click", onClick);
  return button;
};

class CodeMirrorFileSearchPanel implements Panel {
  readonly dom: HTMLElement;

  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly searchIcon: SVGSVGElement;
  private readonly matchCount: HTMLSpanElement;
  private readonly searchNavigation: HTMLDivElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly handleDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.dom.contains(target)) return;
    closeSearchPanel(this.view);
  };
  private readonly handleWindowKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeSearchPanel(this.view);
    this.view.focus();
  };

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom = document.createElement("div");
    this.dom.className = "cm-search cm-mini-search";
    this.dom.dataset.testid = "editor-file-search";
    this.dom.addEventListener("keydown", (event) => this.handleKeyDown(event));

    const field = document.createElement("div");
    field.className = "cm-mini-search-field";

    this.searchIcon = createSearchIcon("search", 14);
    this.searchIcon.classList.add("cm-mini-search-icon");

    this.searchField = document.createElement("input");
    this.searchField.type = "text";
    this.searchField.name = "search";
    this.searchField.value = this.query.search;
    this.searchField.placeholder = "Search...";
    this.searchField.className = "cm-textfield";
    this.searchField.setAttribute("aria-label", "Search in file");
    this.searchField.setAttribute("main-field", "true");
    this.searchField.dataset.testid = "editor-file-search-input";
    this.searchField.addEventListener("input", () => this.commit());

    this.matchCount = document.createElement("span");
    this.matchCount.className = "cm-mini-search-count";
    this.matchCount.dataset.testid = "editor-file-search-count";
    this.matchCount.setAttribute("aria-live", "polite");

    this.previousButton = createButton(
      "prev",
      "chevron-up",
      "Previous match",
      () => findPrevious(this.view),
    );
    this.nextButton = createButton("next", "chevron-down", "Next match", () =>
      findNext(this.view),
    );

    this.searchNavigation = document.createElement("div");
    this.searchNavigation.className = "cm-mini-search-nav";
    this.searchNavigation.setAttribute(
      "aria-label",
      "Search result navigation",
    );
    this.searchNavigation.append(this.previousButton, this.nextButton);

    field.append(
      this.searchIcon,
      this.searchField,
      this.matchCount,
      this.searchNavigation,
    );
    this.dom.append(field);
    this.syncSearchStatus();
  }

  mount(): void {
    document.addEventListener(
      "pointerdown",
      this.handleDocumentPointerDown,
      true,
    );
    window.addEventListener("keydown", this.handleWindowKeyDown, true);
    this.searchField.select();
  }

  destroy(): void {
    document.removeEventListener(
      "pointerdown",
      this.handleDocumentPointerDown,
      true,
    );
    window.removeEventListener("keydown", this.handleWindowKeyDown, true);
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
    const hasQuery = Boolean(this.query.search);
    this.dom.dataset.invalid =
      this.query.search && !this.query.valid ? "true" : "false";
    this.searchIcon.toggleAttribute("hidden", hasQuery);
    this.matchCount.hidden = !hasQuery;
    this.searchNavigation.hidden = !hasQuery;

    if (!hasQuery || !this.query.valid) {
      this.matchCount.textContent = hasQuery ? "0/0" : "0";
      this.matchCount.setAttribute("aria-label", "No search matches");
      this.previousButton.disabled = true;
      this.nextButton.disabled = true;
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
    const displayIndex = total > 0 ? Math.max(activeIndex, 1) : 0;
    this.matchCount.textContent = `${displayIndex}/${totalLabel}`;
    this.matchCount.setAttribute(
      "aria-label",
      `${this.matchCount.textContent} search matches`,
    );
    this.previousButton.disabled = total === 0;
    this.nextButton.disabled = total === 0;
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
