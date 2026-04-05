import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { Settings, X } from "lucide-react";
import {
  GetCurrentProjectPath,
  GetDependencySyncPlan,
  SyncProjectDependencies,
} from "../../wailsjs/go/main/App";
import { depsync } from "../../wailsjs/go/models";

import { useTheme } from "../hooks/useTheme";
import { useBrowserPreviewStore } from "../stores/browserPreviewStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import type { Theme } from "../types/theme";

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
      <div className="mt-1 text-xs text-[var(--text-muted)]">{description}</div>
    </div>
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={controlLabel ?? title}
      className="relative h-6 w-11 shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] transition-colors data-[state=checked]:bg-[var(--accent-primary)]"
    >
      <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  </div>
);

type DependencySyncMode = "manual" | "safe-auto" | "full-auto";

type TabId =
  | "appearance"
  | "editor"
  | "autocomplete"
  | "diagnostics"
  | "browser-preview";

interface Tab {
  id: TabId;
  label: string;
}

const tabs: Tab[] = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "autocomplete", label: "Autocomplete" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "browser-preview", label: "Browser Preview" },
];

const dependencySyncModeOptions: Array<{
  value: DependencySyncMode;
  label: string;
  description: string;
}> = [
  {
    value: "manual",
    label: "Manual",
    description: "Preview dependency actions only. Nothing runs automatically.",
  },
  {
    value: "safe-auto",
    label: "Safe Auto",
    description:
      "Allow restore/install commands only, without aggressive upgrades.",
  },
  {
    value: "full-auto",
    label: "Full Auto",
    description:
      "Allow install plus update/upgrade commands. Best for explicit opt-in.",
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>("appearance");
  const [planLoading, setPlanLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncPlan, setSyncPlan] = useState<depsync.Plan | null>(null);
  const [syncResult, setSyncResult] = useState<Record<string, string> | null>(
    null,
  );

  const { theme, setTheme } = useTheme();
  const {
    uiScale,
    editorFontSize,
    minFontSize,
    maxFontSize,
    showInlineDiagnostics,
    showCompactDiagnostics,
    showDiagnosticsDonut,
    showMinimap,
    dependencySyncMode,
    autoSyncOnProjectOpen,
    autoSyncOnManifestChange,
    askBeforeDependencyUpdates,
    showDependencySyncPlanBeforeRun,
    setUiScale,
    setEditorFontSize,
    resetZoom,
    setShowInlineDiagnostics,
    setShowCompactDiagnostics,
    setShowDiagnosticsDonut,
    setShowMinimap,
    setDependencySyncMode,
    setAutoSyncOnProjectOpen,
    setAutoSyncOnManifestChange,
    setAskBeforeDependencyUpdates,
    setShowDependencySyncPlanBeforeRun,
  } = useEditorSettingsStore();
  const {
    autoOpenFromTerminal,
    reuseWindowPerSession,
    closeAutoOpenedOnTerminalExit,
    setAutoOpenFromTerminal,
    setReuseWindowPerSession,
    setCloseAutoOpenedOnTerminalExit,
  } = useBrowserPreviewStore();

  const loadDependencyPlan = async () => {
    setPlanLoading(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const currentProjectPath = await GetCurrentProjectPath();
      if (!currentProjectPath) {
        setSyncError("Open a project before previewing dependency sync.");
        setSyncPlan(null);
        return;
      }

      const plan = await GetDependencySyncPlan(dependencySyncMode);
      setSyncPlan(plan);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
      setSyncPlan(null);
    } finally {
      setPlanLoading(false);
    }
  };

  const runDependencySync = async () => {
    setRunLoading(true);
    setSyncError(null);
    try {
      const currentProjectPath = await GetCurrentProjectPath();
      if (!currentProjectPath) {
        setSyncError("Open a project before running dependency sync.");
        setSyncResult(null);
        return;
      }

      if (askBeforeDependencyUpdates && dependencySyncMode === "full-auto") {
        const confirmed = window.confirm(
          "Full Auto may run dependency update commands. Continue?",
        );
        if (!confirmed) {
          return;
        }
      }

      if (showDependencySyncPlanBeforeRun && !syncPlan) {
        await loadDependencyPlan();
      }

      const result = await SyncProjectDependencies(dependencySyncMode);
      setSyncResult(result);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
      setSyncResult(null);
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-transparent" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] flex h-[min(80vh,700px)] w-[min(90vw,900px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-[0_24px_60px_-15px_rgba(0,0,0,0.5)] outline-none"
          data-testid="settings-modal"
        >
          {/* Sidebar */}
          <div className="flex w-64 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
            <div className="flex h-14 items-center gap-3 px-5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                <Settings size={14} />
              </div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Settings
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <div className="space-y-0.5">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center rounded-md px-3 py-1.5 text-sm transition-colors ${
                      activeTab === tab.id
                        ? "bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="relative flex flex-1 flex-col bg-[var(--bg-secondary)]">
            <div className="absolute right-4 top-4 z-10">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  aria-label="Close settings"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-10 py-10">
              {activeTab === "appearance" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                      Appearance
                    </h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Customize the look and feel of the editor.
                    </p>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)] mb-3">
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
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)]"
                          >
                            <RadioGroup.Item
                              value={option.value}
                              className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-strong)]"
                            >
                              <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
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
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                      Editor
                    </h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Core editor settings and scaling.
                    </p>
                  </div>

                  <div className="space-y-8">
                    <div className="space-y-4">
                      <label className="block">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          Editor Font Size
                        </div>
                        <div className="text-xs text-[var(--text-muted)] mt-1 mb-3">
                          Adjust the text size in the code editor.
                        </div>
                        <div className="flex items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
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
                        <div className="text-xs text-[var(--text-muted)] mt-1 mb-3">
                          Adjust the overall size of the application interface.
                        </div>
                        <div className="flex items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
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
                        className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                      >
                        Reset Zoom
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "autocomplete" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                      Autocomplete
                    </h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Tune dependency sync behavior for richer external library
                      completions.
                    </p>
                  </div>

                  <div className="space-y-8">
                    <div>
                      <div className="mb-3 text-sm font-medium text-[var(--text-primary)]">
                        Dependency Sync Mode
                      </div>
                      <RadioGroup.Root
                        value={dependencySyncMode}
                        onValueChange={(value) =>
                          setDependencySyncMode(value as DependencySyncMode)
                        }
                        className="space-y-3"
                      >
                        {dependencySyncModeOptions.map((option) => (
                          <RadioGroup.Item
                            key={option.value}
                            value={option.value}
                            asChild
                          >
                            <button
                              type="button"
                              aria-label={option.label}
                              className="flex w-full items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
                            >
                              <span
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                  option.value === dependencySyncMode
                                    ? "border-white"
                                    : "border-[var(--border-strong)]"
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`block h-2 w-2 rounded-full transition-opacity ${
                                    option.value === dependencySyncMode
                                      ? "bg-white opacity-100"
                                      : "opacity-0"
                                  }`}
                                />
                              </span>
                              <span>
                                <span className="text-sm font-medium text-[var(--text-primary)]">
                                  {option.label}
                                </span>
                                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                                  {option.description}
                                </span>
                              </span>
                            </button>
                          </RadioGroup.Item>
                        ))}
                      </RadioGroup.Root>
                    </div>

                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4">
                      <SwitchRow
                        title="Auto-run on project open"
                        description="Prepare dependency metadata automatically when a project becomes active."
                        checked={autoSyncOnProjectOpen}
                        onCheckedChange={setAutoSyncOnProjectOpen}
                      />
                      <SwitchRow
                        title="Auto-run on manifest change"
                        description="Refresh dependency data when package manifests or lockfiles change."
                        checked={autoSyncOnManifestChange}
                        onCheckedChange={setAutoSyncOnManifestChange}
                      />
                      <SwitchRow
                        title="Ask before dependency updates"
                        description="Require confirmation before running update-grade commands in Full Auto mode."
                        checked={askBeforeDependencyUpdates}
                        onCheckedChange={setAskBeforeDependencyUpdates}
                      />
                      <SwitchRow
                        title="Show sync plan before run"
                        description="Preview the detected managers and commands before executing sync."
                        checked={showDependencySyncPlanBeforeRun}
                        onCheckedChange={setShowDependencySyncPlanBeforeRun}
                      />
                    </div>

                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 space-y-4">
                      <div>
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          Dependency Sync Preview
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          Inspect the backend plan and run it for the currently
                          opened project.
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={loadDependencyPlan}
                          disabled={planLoading || runLoading}
                          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {planLoading ? "Loading plan..." : "Preview plan"}
                        </button>
                        <button
                          type="button"
                          onClick={runDependencySync}
                          disabled={runLoading || planLoading}
                          className="rounded-md border border-[var(--border-subtle)] bg-[var(--accent-primary)]/10 px-4 py-2 text-sm font-medium text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {runLoading ? "Running sync..." : "Run now"}
                        </button>
                      </div>

                      {syncError && (
                        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                          {syncError}
                        </div>
                      )}

                      {syncPlan && (
                        <div className="space-y-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                          <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                            Plan for {syncPlan.projectPath}
                          </div>
                          <div className="text-xs text-[var(--text-muted)]">
                            Mode:{" "}
                            <span className="text-[var(--text-primary)]">
                              {syncPlan.mode}
                            </span>
                          </div>
                          <div className="space-y-3">
                            {syncPlan.managers.map(
                              (manager: depsync.Manager, index: number) => (
                                <div
                                  key={`${manager.ecosystem}-${manager.tool}-${index}`}
                                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3"
                                >
                                  <div className="text-sm font-medium text-[var(--text-primary)]">
                                    {manager.ecosystem} · {manager.tool}
                                  </div>
                                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                                    Manifest: {manager.manifest}
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    {manager.commands.map(
                                      (
                                        command: depsync.Command,
                                        commandIndex: number,
                                      ) => (
                                        <div
                                          key={`${manager.tool}-${command.label}-${commandIndex}`}
                                          className="rounded border border-[var(--border-subtle)] px-3 py-2 text-xs"
                                        >
                                          <div className="font-medium text-[var(--text-primary)]">
                                            {command.label}
                                          </div>
                                          <div className="mt-1 break-all font-mono text-[var(--text-muted)]">
                                            {command.executable} {command.args}
                                          </div>
                                          <div className="mt-1 text-[var(--text-muted)]">
                                            {command.safe
                                              ? "Safe"
                                              : "Potentially mutating"}
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}

                      {syncResult && (
                        <div className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                          <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                            Last Sync Result
                          </div>
                          {Object.entries(syncResult).map(([key, value]) => (
                            <div
                              key={key}
                              className="rounded border border-[var(--border-subtle)] px-3 py-2 text-xs"
                            >
                              <div className="font-medium text-[var(--text-primary)]">
                                {key}
                              </div>
                              <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[var(--text-muted)]">
                                {value || "ok"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "diagnostics" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                      Diagnostics
                    </h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Configure how errors and warnings are displayed.
                    </p>
                  </div>

                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4">
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
                    <SwitchRow
                      title="Show file donut indicator"
                      description="Display the per-file donut near the editor minimap and view chrome."
                      checked={showDiagnosticsDonut}
                      onCheckedChange={setShowDiagnosticsDonut}
                    />
                  </div>
                </div>
              )}

              {activeTab === "browser-preview" && (
                <div className="mx-auto max-w-2xl space-y-8">
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                      Browser Preview
                    </h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      Manage integrated browser preview behavior.
                    </p>
                  </div>

                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4">
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
