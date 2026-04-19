import React, { useEffect, useRef } from "react";

import type { Tab } from "./EditorTabs";

interface TabSwitcherOverlayProps {
  tabs: Tab[];
  selectedTabId: string | null;
  activeTabId: string | null;
  projectPath: string;
}

const normalizePath = (value: string): string => value.replace(/\\/g, "/");

const getTabDirectoryLabel = (tab: Tab, projectPath: string): string => {
  const normalizedPath = normalizePath(tab.path);
  const normalizedProjectPath = normalizePath(projectPath).replace(/\/$/, "");
  const relativePath =
    normalizedProjectPath &&
    normalizedPath.startsWith(`${normalizedProjectPath}/`)
      ? normalizedPath.slice(normalizedProjectPath.length + 1)
      : normalizedPath;

  const segments = relativePath.split("/");
  if (segments.length <= 1) {
    return "Current project";
  }

  segments.pop();
  return segments.join("/");
};

export const TabSwitcherOverlay: React.FC<TabSwitcherOverlayProps> = ({
  tabs,
  selectedTabId,
  activeTabId,
  projectPath,
}) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const listElement = listRef.current;
    const selectedElement = selectedItemRef.current;
    if (!listElement || !selectedElement) {
      return;
    }

    selectedElement.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedTabId]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/42" />

      <div className="relative w-full max-w-[680px]">
        <div className="overflow-hidden rounded-[16px] border border-[var(--border-default)] bg-[color:rgba(10,10,10,0.96)] shadow-[0_28px_72px_rgba(0,0,0,0.58)] backdrop-blur-[6px]">
          <div ref={listRef} className="max-h-[420px] overflow-y-auto p-2">
            {tabs.map((tab) => {
              const isSelected = tab.id === selectedTabId;
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  ref={isSelected ? selectedItemRef : null}
                  className={[
                    "flex min-h-[56px] scroll-mt-2 items-center gap-3 rounded-[12px] px-4 py-3 transition-all duration-150",
                    isSelected
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                      : "text-[var(--text-secondary)]",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[17px] leading-6 text-[var(--text-primary)]">
                        {tab.label}
                      </span>
                      {tab.isDirty ? (
                        <span className="h-2 w-2 rounded-full bg-[var(--text-primary)]" />
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-[var(--text-secondary)]">
                      {getTabDirectoryLabel(tab, projectPath)}
                    </div>
                  </div>

                  {isActive ? (
                    <div
                      className={[
                        "shrink-0 rounded-[999px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                        isSelected
                          ? "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[var(--text-primary)]"
                          : "border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] text-[var(--text-secondary)]",
                      ].join(" ")}
                    >
                      Current
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
