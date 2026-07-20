import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/wails/runtime", () => ({
  EventsOn: vi.fn(() => () => undefined),
}));

import {
  useDiagnosticsStore,
  type DiagnosticsEventPayload,
} from "../../src/stores/diagnosticsStore";

const makeItems = (count: number, messagePrefix = "problem") =>
  Array.from({ length: count }, (_, index) => ({
    range: {
      start: { line: index, character: 0 },
      end: { line: index, character: 1 },
    },
    severity: 1,
    message: `${messagePrefix} ${index}`,
    source: "test",
    code: `T${index}`,
  }));

const makeEvent = (
  filePath: string,
  count: number,
): DiagnosticsEventPayload => ({
  projectPath: "/workspace",
  generation: 1,
  filePath,
  language: "typescript",
  items: makeItems(count),
});

describe("diagnostics bulk ingest", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().reset();
    useDiagnosticsStore.getState().setProjectScope("/workspace", 1);
  });

  it("applies a multi-file burst with a single state notification", () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      makeEvent(`/workspace/src/file-${index}.ts`, 3),
    );

    let notifications = 0;
    const unsubscribe = useDiagnosticsStore.subscribe(() => {
      notifications += 1;
    });

    useDiagnosticsStore.getState().ingestDiagnosticsEvents(events);
    unsubscribe();

    const state = useDiagnosticsStore.getState();
    expect(notifications).toBe(1);
    expect(state.byFile.size).toBe(50);
    expect(state.projectSummary.total).toBe(150);
    expect(state.projectSummary.errors).toBe(150);
  });

  it("keeps per-file aggregates and clears files on empty items", () => {
    useDiagnosticsStore.getState().ingestDiagnosticsEvents([
      makeEvent("/workspace/src/a.ts", 2),
      makeEvent("/workspace/src/b.ts", 4),
    ]);
    useDiagnosticsStore.getState().ingestDiagnosticsEvents([
      { ...makeEvent("/workspace/src/a.ts", 0), items: [] },
    ]);

    const state = useDiagnosticsStore.getState();
    expect(state.byFile.has("/workspace/src/a.ts")).toBe(false);
    expect(state.byFile.get("/workspace/src/b.ts")?.summary.total).toBe(4);
    expect(state.projectSummary.total).toBe(4);
  });

  it("does not notify when the burst changes nothing", () => {
    useDiagnosticsStore.getState().ingestDiagnosticsEvents([
      makeEvent("/workspace/src/a.ts", 2),
    ]);

    let notifications = 0;
    const unsubscribe = useDiagnosticsStore.subscribe(() => {
      notifications += 1;
    });
    useDiagnosticsStore.getState().ingestDiagnosticsEvents([
      makeEvent("/workspace/src/a.ts", 2),
      makeEvent("/workspace/src/b.ts", 0),
    ]);
    unsubscribe();

    expect(notifications).toBe(0);
  });

  it("filters events from other projects", () => {
    useDiagnosticsStore.getState().ingestDiagnosticsEvents([
      { ...makeEvent("/elsewhere/src/a.ts", 5), projectPath: "/elsewhere" },
    ]);

    const state = useDiagnosticsStore.getState();
    expect(state.byFile.size).toBe(0);
    expect(state.projectSummary.total).toBe(0);
  });
});
