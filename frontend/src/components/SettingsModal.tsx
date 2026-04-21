import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { Settings, X } from "lucide-react";

import { useTheme } from "../hooks/useTheme";
import { useBrowserPreviewStore } from "../stores/browserPreviewStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import type { Theme } from "../types/theme";

const panelCardClass =
  "rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const themeOptions: Array<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const SwitchRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  controlLabel?: string;
}> = ({ title, description, checked, onCheckedChange, controlLabel }) => (
  <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="pr-4">
      <div className="text-sm font-medium text-[var(--text-primary)]">
        {title}
      </div>
      <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
        {description}
      </div>
    </div>
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={controlLabel ?? title}
      className="relative h-6 w-11 shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-3)] transition-colors focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] data-[state=checked]:border-[var(--text-primary)] data-[state=checked]:bg-[var(--text-primary)]"
    >
      <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-[var(--surface-canvas)] shadow-sm transition-transform data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  </div>
);

type TabId = "appearance" | "editor" | "diagnostics" | "browser-preview";

interface Tab {
  id: TabId;
  label: string;
}

const tabs: Tab[] = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "browser-preview", label: "Browser Preview" },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>("appearance");

  const { theme, setTheme } = useTheme();
  const {
    uiScale,
    editorFontSize,
    minFontSize,
    maxFontSize,
    showInlineDiagnostics,
    showCompactDiagnostics,
    showMinimap,
    setUiScale,
    setEditorFontSize,
    resetZoom,
    setShowInlineDiagnostics,
    setShowCompactDiagnostics,
    setShowMinimap,
  } = useEditorSettingsStore();
  const {
    autoOpenFromTerminal,
    reuseWindowPerSession,
    closeAutoOpenedOnTerminalExit,
    setAutoOpenFromTerminal,
    setReuseWindowPerSession,
    setCloseAutoOpenedOnTerminalExit,
  } = useBrowserPreviewStore();

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-[8px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] flex h-[min(84vh,760px)] w-[min(92vw,960px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[18px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)] outline-none"
          data-testid="settings-modal"
        >
          <div className="flex w-[252px] flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-1)]">
            <div className="border-b border-[var(--border-subtle)] px-5 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                  <Settings size={14} />
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Workspace
                  </div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    Settings
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex h-8 w-full items-center rounded-[10px] border px-3 text-sm transition-colors ${
                      activeTab === tab.id
                        ? "border-[var(--border-default)] bg-[var(--surface-2)] font-medium text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="relative flex flex-1 flex-col bg-[var(--surface-overlay)]">
            <div className="absolute right-4 top-4 z-10">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
                  aria-label="Close settings"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-10 py-9">
              {activeTab === "appearance" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Appearance
                    </div>
                    <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                      Appearance
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
                      Customize the look and feel of the editor.
                    </p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <div className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                        Theme
                      </div>
                      <RadioGroup.Root
                        value={theme}
                        onValueChange={(value) => setTheme(value as Theme)}
                        className="grid gap-3 sm:grid-cols-3"
                      >
                        {themeOptions.map((option) => (
                          <label
                            key={option.value}
                            className={`${panelCardClass} flex cursor-pointer items-center gap-3 px-4 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)]`}
                          >
                            <RadioGroup.Item
                              value={option.value}
                              className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-default)]"
                            >
                              <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-[var(--text-primary)]" />
                            </RadioGroup.Item>
                            {option.label}
                          </label>
                        ))}
                      </RadioGroup.Root>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "editor" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Editor
                    </div>
                    <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                      Editor
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      Core editor settings and scaling.
                    </p>
                  </div>

                  <div className="space-y-8">
                    <div className="space-y-4">
                      <label className="block">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          Editor Font Size
                        </div>
                        <div className="mb-3 mt-1 text-xs text-[var(--text-muted)]">
                          Adjust the text size in the code editor.
                        </div>
                        <div
                          className={`${panelCardClass} flex items-center gap-4 px-4 py-3`}
                        >
                          <input
                            type="range"
                            min={minFontSize}
                            max={maxFontSize}
                            value={editorFontSize}
                            onChange={(event) =>
                              setEditorFontSize(Number(event.target.value))
                            }
                            className="w-full"
                          />
                          <span className="w-12 text-right font-mono text-sm text-[var(--text-primary)]">
                            {editorFontSize}px
                          </span>
                        </div>
                      </label>
                    </div>

                    <div className="space-y-4">
                      <label className="block">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          UI Scale
                        </div>
                        <div className="mb-3 mt-1 text-xs text-[var(--text-muted)]">
                          Adjust the overall size of the application interface.
                        </div>
                        <div
                          className={`${panelCardClass} flex items-center gap-4 px-4 py-3`}
                        >
                          <input
                            type="range"
                            min={0.8}
                            max={1.4}
                            step={0.05}
                            value={uiScale}
                            onChange={(event) =>
                              setUiScale(Number(event.target.value))
                            }
                            className="w-full"
                          />
                          <span className="w-12 text-right font-mono text-sm text-[var(--text-primary)]">
                            {Math.round(uiScale * 100)}%
                          </span>
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={resetZoom}
                        className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
                      >
                        Reset Zoom
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "diagnostics" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Diagnostics
                    </div>
                    <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                      Diagnostics
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      Configure how errors and warnings are displayed.
                    </p>
                  </div>

                  <div className={`${panelCardClass} px-4`}>
                    <SwitchRow
                      title="Show minimap"
                      description="Display the code minimap in the editor gutter for supported file sizes."
                      checked={showMinimap}
                      onCheckedChange={setShowMinimap}
                    />
                    <SwitchRow
                      title="Show inline diagnostics"
                      description="Render squiggles, line emphasis, and inline problem messages inside the editor."
                      checked={showInlineDiagnostics}
                      onCheckedChange={setShowInlineDiagnostics}
                    />
                    <SwitchRow
                      title="Show compact diagnostics"
                      description="Keep the project-wide problems badge visible in the status bar."
                      checked={showCompactDiagnostics}
                      onCheckedChange={setShowCompactDiagnostics}
                    />
                  </div>
                </div>
              )}

              {activeTab === "browser-preview" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Browser Preview
                    </div>
                    <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                      Browser Preview
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      Manage integrated browser preview behavior.
                    </p>
                  </div>

                  <div className={`${panelCardClass} px-4`}>
                    <SwitchRow
                      title="Auto-open Preview"
                      description="Open browser preview automatically when the terminal reports a local URL."
                      checked={autoOpenFromTerminal}
                      onCheckedChange={setAutoOpenFromTerminal}
                    />
                    <SwitchRow
                      title="Reuse Session Window"
                      description="Keep one preview window per terminal session instead of spawning new ones."
                      checked={reuseWindowPerSession}
                      onCheckedChange={setReuseWindowPerSession}
                    />
                    <SwitchRow
                      title="Close on Session Exit"
                      description="Close auto-opened preview windows when the terminal session ends."
                      checked={closeAutoOpenedOnTerminalExit}
                      onCheckedChange={setCloseAutoOpenedOnTerminalExit}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
