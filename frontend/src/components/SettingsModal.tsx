import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Switch from "@radix-ui/react-switch";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Code2,
  Globe,
  Keyboard,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";

import { useTheme } from "../hooks/useTheme";
import {
  type MarkdownLinkOpenMode,
  useBrowserPreviewStore,
} from "../stores/browserPreviewStore";
import { useAutoUpdateStatus } from "../shell/autoUpdate";
import { runAutoUpdateCheckWithNotification } from "../shell/manualUpdateNotifications";
import {
  useEditorSettingsStore,
  type ProjectWindowMode,
} from "../stores/editorSettingsStore";
import { useKeybindingsStore } from "../stores/keybindingsStore";
import { themeOptions as builtInThemeOptions } from "../styles/themes";
import type { Theme } from "../types/theme";
import {
  eventToShortcut,
  formatShortcut,
  getEffectiveShortcuts,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  type ShortcutGroup,
} from "../utils/keyboard";
import { MAX_UI_SCALE, MIN_UI_SCALE, UI_SCALE_STEP } from "../utils/uiScale";

const settingsPanelClass =
  "overflow-hidden rounded-[24px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_98%,transparent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_24px_-22px_rgba(0,0,0,0.85)]";
const settingsInsetClass =
  "overflow-hidden rounded-[22px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)]";
const settingsPillClass =
  "inline-flex min-h-[30px] items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)] px-3 text-[11px] font-medium text-[var(--text-secondary)]";
const settingsIconButtonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-40";
const settingsActionButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)] px-3 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-45";
const settingsDropdownTriggerClass =
  "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)] px-4 text-left text-[13px] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-default)] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] data-[state=open]:border-[var(--border-default)]";
const settingsDropdownContentClass =
  "z-[130] overflow-y-auto overscroll-contain rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-overlay)_98%,transparent)] p-2 shadow-[var(--shadow-overlay)] backdrop-blur-xl";
const settingsDropdownItemClass =
  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[14px] px-4 text-[15px] text-[var(--text-secondary)] outline-none transition-colors data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--text-primary)]";

const projectWindowModeOptions: Array<{
  value: ProjectWindowMode;
  label: string;
  description: string;
}> = [
  {
    value: "projects",
    label: "Projects",
    description: "Open projects in this window.",
  },
  {
    value: "windows",
    label: "Windows",
    description: "Open each project in a separate macOS window.",
  },
];

const markdownLinkOpenModeOptions: Array<{
  value: MarkdownLinkOpenMode;
  label: string;
}> = [
  { value: "browser", label: "Browser" },
  { value: "preview", label: "Preview" },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const settingsThemeOptions: Array<{
  value: Theme;
  label: string;
  appearance: "auto" | "light" | "dark";
}> = [
  { value: "system", label: "System", appearance: "auto" },
  ...builtInThemeOptions,
];

type TabId =
  | "appearance"
  | "editor"
  | "diagnostics"
  | "browser-preview"
  | "keybindings";

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const tabs: Tab[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: Code2 },
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: AlertCircle,
  },
  {
    id: "browser-preview",
    label: "Browser Preview",
    icon: Globe,
  },
  {
    id: "keybindings",
    label: "Keybindings",
    icon: Keyboard,
  },
];

const shortcutGroups: Array<"All" | ShortcutGroup> = [
  "All",
  "Panels",
  "App",
  "Window",
  "Editor",
  "Terminal",
];

const SettingHeader: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => (
  <div>
    <h2 className="text-[26px] font-semibold text-[var(--text-primary)]">
      {title}
    </h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
      {description}
    </p>
  </div>
);

const SwitchRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  controlLabel?: string;
}> = ({ title, description, checked, onCheckedChange, controlLabel }) => (
  <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="pr-4">
      <div className="text-sm font-semibold text-[var(--text-primary)]">
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
      className="relative h-7 w-12 shrink-0 rounded-full border border-[var(--switch-border)] bg-[var(--switch-track)] transition-colors focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] data-[state=checked]:border-[var(--switch-border-checked)] data-[state=checked]:bg-[var(--switch-track-checked)]"
    >
      <Switch.Thumb className="block h-6 w-6 translate-x-0.5 rounded-full bg-[var(--switch-thumb)] shadow-sm transition-transform data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  </div>
);

const ShortcutPill: React.FC<{ shortcut: string; active?: boolean }> = ({
  shortcut,
  active = false,
}) => (
  <span
    className={`inline-flex min-h-[28px] items-center rounded-full border px-3 font-mono text-[10px] font-semibold uppercase text-[var(--text-secondary)] ${
      active
        ? "border-[var(--focus-ring)] bg-[color-mix(in_srgb,var(--focus-ring)_14%,var(--surface-2))] text-[var(--text-primary)]"
        : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)]"
    }`}
  >
    {formatShortcut(shortcut)}
  </span>
);

const ProjectOpeningModeControl: React.FC<{
  value: ProjectWindowMode;
  onChange: (value: ProjectWindowMode) => void;
}> = ({ value, onChange }) => (
  <div className={`${settingsPanelClass} p-4`}>
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          Project opening
        </div>
        <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
          Choose whether new projects stay in the current IDE window or open as
          separate macOS project windows.
        </div>
      </div>
      <div
        role="group"
        aria-label="Project opening"
        className="shell-cluster-soft inline-flex min-h-[42px] items-center gap-1 px-1.5 py-1"
      >
        {projectWindowModeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            title={option.description}
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors ${
              value === option.value
                ? "border-[var(--border-default)] bg-[var(--surface-active)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  </div>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>("appearance");
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [customThemeStatus, setCustomThemeStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [shortcutGroup, setShortcutGroup] = useState<"All" | ShortcutGroup>(
    "All",
  );
  const [recordingActionId, setRecordingActionId] =
    useState<ShortcutActionId | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const customThemeInputRef = useRef<HTMLInputElement | null>(null);

  const { theme, setTheme, previewTheme, customThemes, addCustomTheme } =
    useTheme();
  const {
    uiScale,
    editorFontSize,
    minFontSize,
    maxFontSize,
    showInlineDiagnostics,
    showCompactDiagnostics,
    showMinimap,
    showRainbowBrackets,
    zenModeEnabled,
    projectWindowMode,
    setUiScale,
    setEditorFontSize,
    resetZoom,
    setShowInlineDiagnostics,
    setShowCompactDiagnostics,
    setShowMinimap,
    setShowRainbowBrackets,
    setZenModeEnabled,
    setProjectWindowMode,
  } = useEditorSettingsStore();
  const {
    autoOpenFromTerminal,
    reuseWindowPerSession,
    closeAutoOpenedOnTerminalExit,
    markdownLinkOpenMode,
    setAutoOpenFromTerminal,
    setReuseWindowPerSession,
    setCloseAutoOpenedOnTerminalExit,
    setMarkdownLinkOpenMode,
  } = useBrowserPreviewStore();
  const overrides = useKeybindingsStore((state) => state.overrides);
  const setShortcut = useKeybindingsStore((state) => state.setShortcut);
  const resetShortcut = useKeybindingsStore((state) => state.resetShortcut);
  const resetAllShortcuts = useKeybindingsStore(
    (state) => state.resetAllShortcuts,
  );
  const autoUpdateStatus = useAutoUpdateStatus();
  const buildInfo = autoUpdateStatus.current;
  const autoUpdateBusy =
    autoUpdateStatus.state === "checking" ||
    autoUpdateStatus.state === "downloading" ||
    autoUpdateStatus.state === "applying";

  const filteredShortcuts = useMemo(() => {
    const query = shortcutQuery.trim().toLowerCase();

    return SHORTCUT_DEFINITIONS.filter((definition) => {
      if (shortcutGroup !== "All" && definition.group !== shortcutGroup) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        definition.label,
        definition.description,
        definition.group,
        ...getEffectiveShortcuts(definition.id, overrides),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [overrides, shortcutGroup, shortcutQuery]);

  const customThemeOptions = useMemo(
    () =>
      customThemes.map((customTheme) => ({
        value: customTheme.id as Theme,
        label: customTheme.name,
        appearance: customTheme.appearance,
      })),
    [customThemes],
  );

  const selectedThemeLabel = useMemo(() => {
    const options = [...settingsThemeOptions, ...customThemeOptions];
    return options.find((option) => option.value === theme)?.label ?? "System";
  }, [customThemeOptions, theme]);

  const clearThemePreview = () => {
    previewTheme(null);
  };

  const handleThemeSelect = (nextTheme: Theme) => {
    setTheme(nextTheme);
  };

  const handleCustomThemeFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    try {
      const rawTheme = JSON.parse(await file.text());
      const importedTheme = addCustomTheme(rawTheme, file.name);
      handleThemeSelect(importedTheme.id as Theme);
      setCustomThemeStatus({
        tone: "success",
        message: `Added ${importedTheme.name}`,
      });
    } catch (error) {
      setCustomThemeStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Unable to import theme.",
      });
    }
  };

  useEffect(() => {
    if (recordingActionId) {
      document.body.dataset.shortcutRecording = "true";
      return () => {
        delete document.body.dataset.shortcutRecording;
      };
    }

    delete document.body.dataset.shortcutRecording;
  }, [recordingActionId]);

  useEffect(() => {
    if (!recordingActionId) {
      return;
    }

    const handleShortcutCapture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.key === "Escape") {
        setRecordingActionId(null);
        setRecordingError(null);
        return;
      }

      const shortcut = eventToShortcut(event);
      if (!shortcut) {
        return;
      }

      const result = setShortcut(recordingActionId, shortcut);
      if (result.ok) {
        setRecordingActionId(null);
        setRecordingError(null);
        return;
      }

      setRecordingError(
        result.conflict
          ? `Already used by ${result.conflict.label}`
          : (result.error ?? "Unsupported shortcut"),
      );
    };

    window.addEventListener("keydown", handleShortcutCapture, true);
    return () =>
      window.removeEventListener("keydown", handleShortcutCapture, true);
  }, [recordingActionId, setShortcut]);

  const renderKeybindings = () => (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SettingHeader
          title="Keybindings"
          description="Customize workspace panel shortcuts and app actions."
        />
        <button
          type="button"
          onClick={() => {
            resetAllShortcuts();
            setRecordingActionId(null);
            setRecordingError(null);
          }}
          className={settingsActionButtonClass}
        >
          <RotateCcw size={14} />
          Reset all
        </button>
      </div>

      <div className={`${settingsPanelClass} p-3`}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="shell-cluster-soft flex min-h-[42px] min-w-0 items-center gap-2 px-3">
            <Search size={15} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={shortcutQuery}
              onChange={(event) => setShortcutQuery(event.target.value)}
              placeholder="Search shortcuts"
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </label>
          <div className="shell-cluster-soft inline-flex min-h-[42px] flex-wrap items-center gap-1 px-1.5 py-1">
            {shortcutGroups.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => setShortcutGroup(group)}
                className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors ${
                  shortcutGroup === group
                    ? "border-[var(--border-default)] bg-[var(--surface-active)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                }`}
              >
                {group}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`${settingsPanelClass} divide-y divide-[var(--border-subtle)]`}
      >
        {filteredShortcuts.map((definition) => {
          const effectiveShortcuts = getEffectiveShortcuts(
            definition.id,
            overrides,
          );
          const isRecording = recordingActionId === definition.id;
          const hasOverride = Boolean(overrides[definition.id]?.length);

          return (
            <div
              key={definition.id}
              className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              data-testid={`keybinding-row-${definition.id}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                    {definition.label}
                  </span>
                  <span className={settingsPillClass}>{definition.group}</span>
                  {definition.scope === "terminal" ? (
                    <span className={settingsPillClass}>Terminal scope</span>
                  ) : null}
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                  {definition.description}
                </div>
                {isRecording && recordingError ? (
                  <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--status-error)]">
                    <AlertCircle size={13} />
                    {recordingError}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {isRecording ? (
                  <ShortcutPill shortcut="Press keys" active />
                ) : (
                  effectiveShortcuts.map((shortcut) => (
                    <ShortcutPill key={shortcut} shortcut={shortcut} />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRecordingActionId(definition.id);
                    setRecordingError(null);
                  }}
                  className={settingsIconButtonClass}
                  aria-label={`Edit shortcut for ${definition.label}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetShortcut(definition.id);
                    if (recordingActionId === definition.id) {
                      setRecordingActionId(null);
                    }
                    setRecordingError(null);
                  }}
                  disabled={!hasOverride}
                  className={settingsIconButtonClass}
                  aria-label={`Reset shortcut for ${definition.label}`}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
          );
        })}

        {filteredShortcuts.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)]">
              <Search size={18} />
            </div>
            <div className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">
              No shortcuts found
            </div>
            <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
              Try another query or filter.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-[10px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] flex h-[min(86vh,800px)] w-[min(94vw,1080px)] overflow-hidden rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-canvas)] shadow-[var(--shadow-overlay)] outline-none"
          data-testid="settings-modal"
          style={{
            transform: `translate(-50%, -50%) scale(${uiScale})`,
            transformOrigin: "center",
            width: `min(${94 / uiScale}vw, 1080px)`,
            height: `min(${86 / uiScale}vh, 800px)`,
          }}
        >
          <div className="flex w-[276px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)] p-3">
            <div className="shell-cluster-soft mb-3 flex min-h-[58px] w-full items-center gap-3 px-3 py-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                <Settings size={17} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold text-[var(--text-primary)]">
                  Settings
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`group grid min-h-[46px] w-full grid-cols-[34px_minmax(0,1fr)] items-center gap-3 rounded-[18px] border px-2.5 text-left transition-colors ${
                      active
                        ? "border-[var(--border-default)] bg-[var(--surface-active)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-[14px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)]">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold">
                        {tab.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative flex min-w-0 flex-1 flex-col bg-[var(--surface-overlay)]">
            <div className="absolute right-4 top-4 z-10">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={settingsIconButtonClass}
                  aria-label="Close settings"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7 sm:px-9">
              {activeTab === "appearance" && (
                <div className="mx-auto max-w-3xl space-y-7">
                  <SettingHeader
                    title="Appearance"
                    description="Customize the look and feel of the editor."
                  />

                  <ProjectOpeningModeControl
                    value={projectWindowMode}
                    onChange={setProjectWindowMode}
                  />

                  <div className={`${settingsPanelClass} p-4`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        Theme
                      </div>
                      <span className={settingsPillClass}>
                        {selectedThemeLabel}
                      </span>
                    </div>

                    <DropdownMenu.Root
                      open={themeDropdownOpen}
                      onOpenChange={(open) => {
                        setThemeDropdownOpen(open);
                        if (!open) {
                          clearThemePreview();
                        }
                      }}
                    >
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          className={settingsDropdownTriggerClass}
                          aria-label="Select theme"
                          data-testid="theme-dropdown-trigger"
                        >
                          <span className="min-w-0 truncate">
                            {selectedThemeLabel}
                          </span>
                          <ChevronDown
                            size={15}
                            className="shrink-0 text-[var(--text-muted)]"
                          />
                        </button>
                      </DropdownMenu.Trigger>

                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="start"
                          sideOffset={8}
                          className={settingsDropdownContentClass}
                          data-testid="theme-dropdown-content"
                          data-shell-menu-content
                          onPointerLeave={clearThemePreview}
                          style={{
                            width: "var(--radix-dropdown-menu-trigger-width)",
                            maxHeight:
                              "min(480px, var(--radix-dropdown-menu-content-available-height))",
                          }}
                        >
                          <DropdownMenu.Label className="px-4 py-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                            Built-in themes
                          </DropdownMenu.Label>
                          {settingsThemeOptions.map((option) => (
                            <DropdownMenu.Item
                              key={option.value}
                              onPointerEnter={() => previewTheme(option.value)}
                              onFocus={() => previewTheme(option.value)}
                              onSelect={() => handleThemeSelect(option.value)}
                              className={settingsDropdownItemClass}
                            >
                              <Check
                                size={14}
                                className={
                                  theme === option.value
                                    ? "text-[var(--text-primary)]"
                                    : "text-transparent"
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {option.label}
                              </span>
                              <span className="text-[13px] capitalize text-[var(--text-muted)]">
                                {option.appearance}
                              </span>
                            </DropdownMenu.Item>
                          ))}

                          <DropdownMenu.Separator className="my-2 h-px bg-[var(--shell-inline-divider)]" />
                          <DropdownMenu.Label className="px-4 py-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                            Custom themes
                          </DropdownMenu.Label>
                          {customThemeOptions.length > 0 ? (
                            customThemeOptions.map((option) => (
                              <DropdownMenu.Item
                                key={option.value}
                                onPointerEnter={() =>
                                  previewTheme(option.value)
                                }
                                onFocus={() => previewTheme(option.value)}
                                onSelect={() => handleThemeSelect(option.value)}
                                className={settingsDropdownItemClass}
                              >
                                <Check
                                  size={14}
                                  className={
                                    theme === option.value
                                      ? "text-[var(--text-primary)]"
                                      : "text-transparent"
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {option.label}
                                </span>
                                <span className="text-[13px] capitalize text-[var(--text-muted)]">
                                  {option.appearance}
                                </span>
                              </DropdownMenu.Item>
                            ))
                          ) : (
                            <div className="px-4 py-2 text-[13px] text-[var(--text-muted)]">
                              No custom themes added
                            </div>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>

                  <div className={`${settingsPanelClass} p-4`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">
                          Add custom theme
                        </div>
                        <div className="mt-1 text-[12px] text-[var(--text-muted)]">
                          JSON theme file
                        </div>
                      </div>
                      <button
                        type="button"
                        className={settingsActionButtonClass}
                        onClick={() => customThemeInputRef.current?.click()}
                      >
                        <Plus size={14} />
                        ADD
                      </button>
                    </div>
                    <input
                      ref={customThemeInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleCustomThemeFile}
                    />
                    {customThemeStatus && (
                      <div
                        className={`mt-3 rounded-[14px] border px-3 py-2 text-[12px] ${
                          customThemeStatus.tone === "success"
                            ? "border-[color-mix(in_srgb,var(--status-success)_35%,transparent)] text-[var(--status-success)]"
                            : "border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] text-[var(--status-error)]"
                        }`}
                      >
                        {customThemeStatus.message}
                      </div>
                    )}
                  </div>

                  <div className={settingsPanelClass}>
                    <SwitchRow
                      title="Zen Mode"
                      description="Hide the top bar, status bar, and snapped panels until their edge is hovered."
                      checked={zenModeEnabled}
                      onCheckedChange={setZenModeEnabled}
                    />
                    <SwitchRow
                      title="Rainbow brackets"
                      description="Color nested brackets with fixed depth colors. Turn off to use the current theme's bracket styling."
                      checked={showRainbowBrackets}
                      onCheckedChange={setShowRainbowBrackets}
                    />
                  </div>
                </div>
              )}

              {activeTab === "editor" && (
                <div className="mx-auto max-w-3xl space-y-7">
                  <SettingHeader
                    title="Editor"
                    description="Core editor settings and UI zoom."
                  />

                  <div className="space-y-4">
                    <label className={`${settingsPanelClass} block p-4`}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-[var(--text-primary)]">
                            Editor Font Size
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-muted)]">
                            Adjust the text size in the code editor.
                          </div>
                        </div>
                        <span className="font-mono text-sm text-[var(--text-primary)]">
                          {editorFontSize}px
                        </span>
                      </div>
                      <div className={`${settingsInsetClass} mt-4 px-4 py-3`}>
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
                      </div>
                    </label>

                    <div className={`${settingsPanelClass} p-4`}>
                      <label className="block">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              UI Scale
                            </div>
                            <div className="mt-1 text-xs text-[var(--text-muted)]">
                              Adjust the overall zoom of the application
                              interface.
                            </div>
                          </div>
                          <span className="font-mono text-sm text-[var(--text-primary)]">
                            {Math.round(uiScale * 100)}%
                          </span>
                        </div>
                        <div className={`${settingsInsetClass} mt-4 px-4 py-3`}>
                          <input
                            type="range"
                            min={MIN_UI_SCALE}
                            max={MAX_UI_SCALE}
                            step={UI_SCALE_STEP}
                            value={uiScale}
                            onChange={(event) =>
                              setUiScale(Number(event.target.value))
                            }
                            className="w-full"
                          />
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={resetZoom}
                        className={`${settingsActionButtonClass} mt-4`}
                      >
                        <RotateCcw size={14} />
                        Reset UI Zoom
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "diagnostics" && (
                <div className="mx-auto max-w-3xl space-y-7">
                  <SettingHeader
                    title="Diagnostics"
                    description="Configure how errors and warnings are displayed."
                  />

                  <div className={settingsPanelClass}>
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

                  <div className={`${settingsPanelClass} p-4`}>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      Build identity
                    </div>
                    <div className="mt-3 grid gap-2 text-[12px] text-[var(--text-secondary)]">
                      {[
                        ["Mode", buildInfo.mode ?? "dev"],
                        ["Version", buildInfo.version ?? "unknown"],
                        ["Build", buildInfo.build ?? "unknown"],
                        ["Commit", buildInfo.gitSha ?? "unknown"],
                        ["Channel", buildInfo.channel ?? "alpha"],
                        [
                          "Package",
                          buildInfo.packaged ? "packaged" : "development",
                        ],
                        [
                          "Bundle",
                          buildInfo.bundlePath ?? "not running from .app",
                        ],
                        [
                          "Update manifest",
                          buildInfo.updateManifestUrl ?? "not configured",
                        ],
                        [
                          "Update status",
                          `${autoUpdateStatus.state}${
                            autoUpdateStatus.reason
                              ? `: ${autoUpdateStatus.reason}`
                              : ""
                          }`,
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="grid gap-2 rounded-[14px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] px-3 py-2 sm:grid-cols-[128px_minmax(0,1fr)]"
                        >
                          <span className="text-[var(--text-muted)]">
                            {label}
                          </span>
                          <span className="min-w-0 break-words font-mono text-[11px] text-[var(--text-primary)]">
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={`${settingsActionButtonClass} mt-4`}
                      disabled={autoUpdateBusy}
                      onClick={() => {
                        void runAutoUpdateCheckWithNotification();
                      }}
                    >
                      <RefreshCw size={14} />
                      Check for Updates
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "browser-preview" && (
                <div className="mx-auto max-w-3xl space-y-7">
                  <SettingHeader
                    title="Browser Preview"
                    description="Manage integrated browser preview behavior."
                  />

                  <div className={settingsPanelClass}>
                    <div className="grid gap-4 border-b border-[var(--border-subtle)] px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <div className="min-w-0 pr-4">
                        <div className="text-sm font-semibold text-[var(--text-primary)]">
                          Markdown links
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                          Choose whether Markdown preview links open directly in
                          the system browser or first inside Browser Preview.
                        </div>
                      </div>
                      <div
                        role="group"
                        aria-label="Markdown links"
                        className="shell-cluster-soft inline-flex min-h-[42px] items-center gap-1 px-1.5 py-1"
                      >
                        {markdownLinkOpenModeOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={markdownLinkOpenMode === option.value}
                            onClick={() =>
                              setMarkdownLinkOpenMode(option.value)
                            }
                            className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors ${
                              markdownLinkOpenMode === option.value
                                ? "border-[var(--border-default)] bg-[var(--surface-active)] text-[var(--text-primary)]"
                                : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
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

              {activeTab === "keybindings" && renderKeybindings()}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
