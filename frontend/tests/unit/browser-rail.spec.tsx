import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BrowserRail } from "../../src/components/layout/BrowserRail";
import { useEditorStore } from "../../src/stores/editorStore";

const makePanels = () => ({
  explorer: false,
  git: false,
  problems: false,
  terminal: false,
  aiChat: false,
});

const makeProps = () => ({
  projectPath: "/workspace/demo",
  panels: makePanels(),
  aiChatAvailable: true,
  onToggleExplorer: vi.fn(),
  onToggleGit: vi.fn(),
  onToggleProblems: vi.fn(),
  onToggleTerminal: vi.fn(),
  onToggleAIChat: vi.fn(),
  onOpenCommandBar: vi.fn(),
});

describe("BrowserRail", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useEditorStore.setState({
      tabs: new Map(),
      panes: [{ id: "pane-main", tabIds: [], activeTabId: "" }],
      activePaneId: "pane-main",
    });
  });

  it("renders space chip and panel shortcuts", () => {
    const props = makeProps();
    render(<BrowserRail {...props} />);

    expect(screen.getByTestId("browser-rail")).toBeTruthy();
    expect(screen.getByLabelText("Toggle Explorer")).toBeTruthy();
    expect(screen.getByLabelText("Toggle Git panel")).toBeTruthy();
    expect(screen.getByLabelText("Toggle Problems panel")).toBeTruthy();
    expect(screen.getByLabelText("Toggle Terminal panel")).toBeTruthy();
    expect(screen.getByLabelText("Toggle AI Chat panel")).toBeTruthy();
    expect(screen.getByLabelText("Open command bar")).toBeTruthy();
  });

  it("invokes panel toggle callbacks", () => {
    const props = makeProps();
    render(<BrowserRail {...props} />);

    fireEvent.click(screen.getByLabelText("Toggle Git panel"));
    fireEvent.click(screen.getByLabelText("Toggle Problems panel"));
    fireEvent.click(screen.getByLabelText("Open command bar"));

    expect(props.onToggleGit).toHaveBeenCalledTimes(1);
    expect(props.onToggleProblems).toHaveBeenCalledTimes(1);
    expect(props.onOpenCommandBar).toHaveBeenCalledTimes(1);
  });

  it("reflects active panel state", () => {
    const props = makeProps();
    props.panels.git = true;
    render(<BrowserRail {...props} />);

    expect(
      screen.getByLabelText("Toggle Git panel").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByLabelText("Toggle Explorer").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("renders open editor tabs and activates them on click", () => {
    const tab = {
      id: "tab-src-app-ts",
      path: "/workspace/demo/src/app.ts",
      name: "app.ts",
      content: "const a = 1;",
      isDirty: true,
      language: "typescript",
    };
    useEditorStore.setState({
      tabs: new Map([[tab.id, tab]]),
      panes: [{ id: "pane-main", tabIds: [tab.id], activeTabId: "" }],
      activePaneId: "pane-main",
    });

    render(<BrowserRail {...makeProps()} />);

    const tabButton = screen.getByLabelText("app.ts");
    expect(tabButton.textContent).toContain("TS");
    fireEvent.click(tabButton);
    expect(useEditorStore.getState().panes[0]?.activeTabId).toBe(
      "tab-src-app-ts",
    );
  });

  it("hides the AI Chat button when the panel is unavailable", () => {
    const props = makeProps();
    props.aiChatAvailable = false;
    render(<BrowserRail {...props} />);

    expect(screen.queryByLabelText("Toggle AI Chat panel")).toBeNull();
  });
});
