import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Switch from "@radix-ui/react-switch";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  Boxes,
  Check,
  ChevronDown,
  Code2,
  Database,
  FileText,
  Globe,
  Keyboard,
  KeyRound,
  Layers,
  Monitor,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  AIGetConsentPolicy,
  AIGetPredictionStatus,
  AIListEgressRecords,
  AIListProviders,
  AISaveConsentPolicy,
  AISavePredictionSettings,
  AISaveProviderSettings,
  AITestProvider,
  GetAutocompleteLanguageCapabilities,
  InstallLSPServer,
  IsLSPInstalling,
  type AIPredictionMode,
  type AIPredictionSettings,
  type AIPredictionStatus,
} from "../wails/app";
import { EventsOn } from "../wails/runtime";
import type { AutocompleteLanguageCapability } from "../../bindings/arlecchino/internal/app/models";
import type {
  AIConsentPolicy,
  AIEgressRecord,
} from "../../bindings/arlecchino/internal/ai/models";
import type {
  AIProviderDescriptor,
  AIProviderSettings,
} from "../../bindings/arlecchino/internal/ai/providers/models";
import { useTheme } from "../hooks/useTheme";
import {
  type MarkdownLinkOpenMode,
  useBrowserPreviewStore,
} from "../stores/browserPreviewStore";
import {
  clearPrivateUpdateToken,
  getPrivateUpdateAuthStatus,
  savePrivateUpdateToken,
  type PrivateUpdateAuthStatus,
  useAutoUpdateStatus,
} from "../shell/autoUpdate";
import {
  getMCPSettings,
  saveMCPSettings,
  type MCPSettings,
  type MCPSettingsStatus,
  type MCPToolSettingsEntry,
} from "../shell/mcpSettings";
import { runAutoUpdateCheckWithNotification } from "../shell/manualUpdateNotifications";
import {
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  DEFAULT_UI_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  useEditorSettingsStore,
  type AppIconAppearance,
  type AIChatDefaultContextPrefs,
  type AIChatDisplayPreferences,
  type AIChatWorkflowPreferences,
  type CustomFontFaceDefinition,
  type AIChatSendShortcut,
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
import { isAppNotificationInteractionEvent } from "../utils/appNotificationTargets";
import { MAX_UI_SCALE, MIN_UI_SCALE, UI_SCALE_STEP } from "../utils/uiScale";
import { MotionDropdownContent } from "./ui/MotionDropdownContent";
import {
  SHELL_DIALOG_OVERLAY_TRANSITION,
  SHELL_DIALOG_PANEL_TRANSITION,
} from "./ui/motionContracts";

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
const settingsSwitchRootClass =
  "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-[var(--border-default)] bg-[var(--surface-3)] p-0.5 transition-colors focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-[var(--text-primary)] data-[state=checked]:bg-[var(--text-primary)]";
const settingsSwitchThumbClass =
  "block h-6 w-6 translate-x-0 rounded-full bg-[var(--text-secondary)] shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-[var(--surface-canvas)]";
const settingsDropdownTriggerClass =
  "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)] px-4 text-left text-[13px] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-default)] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] data-[state=open]:border-[var(--border-default)]";
const settingsDropdownContentClass =
  "z-[130] overflow-y-auto overscroll-contain rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-overlay)_98%,transparent)] p-2 shadow-[var(--shadow-overlay)] backdrop-blur-xl";
const settingsDropdownItemClass =
  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[14px] px-4 text-[15px] text-[var(--text-secondary)] outline-none transition-colors data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--text-primary)]";
const settingsInputClass =
  "h-9 min-w-0 rounded-[16px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)] px-3 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-default)] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-45";

const autocompleteTierOrder = [
  "native",
  "hybrid",
  "lsp-only",
  "syntax-only",
  "unknown",
] as const;

const autocompleteTierLabels: Record<string, string> = {
  native: "Native",
  hybrid: "Hybrid",
  "lsp-only": "LSP only",
  "syntax-only": "Syntax",
  unknown: "Unknown",
};

const autocompleteImportLevelLabels: Record<string, string> = {
  native: "Auto-import: Native",
  "partial-native": "Auto-import: Partial",
  "lsp-only": "Auto-import: LSP",
  none: "Auto-import: None",
};

const autocompleteSourceLabels: Array<
  [keyof AutocompleteLanguageCapability["sources"], string]
> = [
  ["index", "Index"],
  ["local", "Local"],
  ["predictive", "Predictive"],
  ["keywords", "Keywords"],
  ["fillAll", "Fill"],
];

const autocompleteBadgeClass = (active: boolean) =>
  `${settingsPillClass} min-h-[26px] px-2.5 ${
    active
      ? "border-[color-mix(in_srgb,var(--status-success)_45%,var(--border-subtle))] text-[var(--status-success)]"
      : "opacity-45"
  }`;

const autocompleteImportLevelKey = (
  level: AutocompleteLanguageCapability["autoImportLevel"],
) => String(level || "none");

const autocompleteImportLevelLabel = (
  level: AutocompleteLanguageCapability["autoImportLevel"],
) =>
  autocompleteImportLevelLabels[autocompleteImportLevelKey(level)] ||
  "Auto-import: None";

type LSPInstallEvent = {
  id?: string;
  lspId?: string;
  stage?: string;
  percent?: number;
  message?: string;
  error?: string;
};

type LocalLSPInstallState = {
  stage: string;
  percent: number;
  message: string;
  error: string;
  running: boolean;
};

const autocompleteTierRank = (tier: string) => {
  const rank = autocompleteTierOrder.indexOf(
    tier as (typeof autocompleteTierOrder)[number],
  );
  return rank === -1 ? autocompleteTierOrder.length : rank;
};

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

const appIconAppearanceOptions: Array<{
  value: AppIconAppearance;
  label: string;
  description: string;
}> = [
  {
    value: "system",
    label: "System",
    description: "Use the macOS icon style chosen in System Settings.",
  },
  {
    value: "light",
    label: "Light",
    description: "Use the light app icon while Arlecchino is running.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Use the dark app icon while Arlecchino is running.",
  },
];

const editorFontFamilyPresets: Array<{
  label: string;
  value: string;
}> = [
  {
    label: "Fira Code",
    value: DEFAULT_EDITOR_FONT_FAMILY,
  },
  {
    label: "JetBrains Mono",
    value: '"JetBrains Mono", "SF Mono", Menlo, monospace',
  },
  {
    label: "Berkeley Mono",
    value: '"Berkeley Mono", "SF Mono", Menlo, monospace',
  },
  {
    label: "Commit Mono",
    value: '"Commit Mono", "SF Mono", Menlo, monospace',
  },
  {
    label: "Cascadia Code",
    value: '"Cascadia Code", "SF Mono", Menlo, monospace',
  },
  {
    label: "Iosevka",
    value: 'Iosevka, "SF Mono", Menlo, monospace',
  },
  {
    label: "SF Mono",
    value: '"SF Mono", Menlo, Monaco, monospace',
  },
  {
    label: "Menlo",
    value: "Menlo, Monaco, monospace",
  },
  {
    label: "Monaco",
    value: "Monaco, Menlo, monospace",
  },
  {
    label: "Consolas",
    value: 'Consolas, "SF Mono", Menlo, monospace',
  },
];

const uiFontFamilyPresets: Array<{
  label: string;
  value: string;
}> = [
  {
    label: "Inter",
    value: DEFAULT_UI_FONT_FAMILY,
  },
  {
    label: "SF Pro",
    value: '"SF Pro", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    label: "Helvetica Neue",
    value: '"Helvetica Neue", Arial, sans-serif',
  },
  {
    label: "Avenir Next",
    value: '"Avenir Next", Avenir, sans-serif',
  },
  {
    label: "IBM Plex Sans",
    value: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    label: "Roboto",
    value: "Roboto, -apple-system, BlinkMacSystemFont, sans-serif",
  },
];

const commonSystemFontFamilies = [
  "SF Pro",
  "SF Pro Display",
  "SF Pro Text",
  "Avenir Next",
  "Helvetica Neue",
  "Arial",
  "Inter",
  "Roboto",
  "IBM Plex Sans",
  "JetBrains Mono",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Fira Code",
  "Cascadia Code",
  "Iosevka",
  "Consolas",
];

type FontOption = {
  label: string;
  value: string;
  sampleFamily: string;
};

type LocalFontAccessNavigator = Navigator & {
  queryLocalFonts?: () => Promise<
    Array<{ family?: string; fullName?: string }>
  >;
};

const CUSTOM_FONT_MAX_BYTES = 5 * 1024 * 1024;

const quoteFontFamily = (fontFamily: string): string =>
  `"${fontFamily.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const trimFontLabel = (label: string): string =>
  label
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const buildUiFontValue = (fontFamily: string): string =>
  `${quoteFontFamily(fontFamily)}, -apple-system, BlinkMacSystemFont, sans-serif`;

const buildEditorFontValue = (fontFamily: string): string =>
  `${quoteFontFamily(fontFamily)}, "SF Mono", Menlo, Monaco, monospace`;

const uniqueFontOptions = (options: FontOption[]): FontOption[] => {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const customFontOptions = (
  customFonts: CustomFontFaceDefinition[],
  valueForFamily: (fontFamily: string) => string,
): FontOption[] =>
  customFonts.map((font) => ({
    label: font.label,
    value: valueForFamily(font.fontFamily),
    sampleFamily: quoteFontFamily(font.fontFamily),
  }));

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Font file could not be read."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Font file could not be read."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });

const markdownLinkOpenModeOptions: Array<{
  value: MarkdownLinkOpenMode;
  label: string;
}> = [
  { value: "browser", label: "Browser" },
  { value: "preview", label: "Preview" },
];

const mcpApprovalTtlOptions: Array<{
  value: number;
  label: string;
}> = [
  { value: 300, label: "5 min" },
  { value: 900, label: "15 min" },
  { value: 3600, label: "60 min" },
];

const aiChatSendShortcutOptions: Array<{
  value: AIChatSendShortcut;
  label: string;
  description: string;
}> = [
  {
    value: "enter",
    label: "Enter",
    description: "Enter sends; Shift+Enter inserts a new line.",
  },
  {
    value: "mod-enter",
    label: "Cmd+Enter",
    description: "Enter inserts a new line; Cmd+Enter sends.",
  },
];

const aiChatDisplayPreferenceRows: Array<{
  key: keyof AIChatDisplayPreferences;
  title: string;
  description: string;
}> = [
  {
    key: "autoScroll",
    title: "Auto-scroll transcript",
    description:
      "Keep the active run visible while tokens and artifacts arrive.",
  },
  {
    key: "compactCards",
    title: "Compact cards",
    description: "Use tighter transcript cards in dense sidebar layouts.",
  },
  {
    key: "showActivity",
    title: "Runtime activity",
    description: "Show compact runtime state in the AI Chat header.",
  },
];

const aiChatWorkflowPreferenceRows: Array<{
  key: keyof AIChatWorkflowPreferences;
  title: string;
  description: string;
}> = [
  {
    key: "autoReviewAfterBuild",
    title: "Auto review large Builds",
    description:
      "Run a quiet linked Review only for large plan-linked Build results.",
  },
];

const aiChatContextPreferenceRows: Array<{
  key: keyof AIChatDefaultContextPrefs;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    key: "workspace",
    title: "Workspace",
    description: "Include indexed project snippets by default.",
    icon: Layers,
  },
  {
    key: "currentFile",
    title: "Current file",
    description: "Include the active editor file by default.",
    icon: FileText,
  },
  {
    key: "terminalLogs",
    title: "Terminal logs",
    description: "Include recent terminal input by default.",
    icon: Monitor,
  },
  {
    key: "mnemonic",
    title: "Mnemonic",
    description: "Allow reviewed project memory by default.",
    icon: Database,
  },
  {
    key: "continuity",
    title: "Continuity",
    description: "Allow session resume capsules by default.",
    icon: RefreshCw,
  },
  {
    key: "mcp",
    title: "MCP",
    description: "Allow MCP context providers by default.",
    icon: SlidersHorizontal,
  },
  {
    key: "skills",
    title: "Skills",
    description: "Allow selected skills as default context.",
    icon: Boxes,
  },
];

const aiPredictionModeOptions: Array<{
  value: Exclude<AIPredictionMode, "off">;
  label: string;
  description: string;
}> = [
  {
    value: "subtle",
    label: "Subtle",
    description: "Wait longer and request fewer background predictions.",
  },
  {
    value: "eager",
    label: "Eager",
    description: "Use the same hard budget with a more responsive idle delay.",
  },
];

const predictionBackgroundOptInSource = "editor_prediction_background";
const remoteBYOKProviderKind = "openai-compatible";
const defaultRemoteBYOKProviderID = "openai-compatible-byok";

type RemoteBYOKConsentPolicy = AIConsentPolicy & {
  remoteByokProvidersAccepted?: boolean;
};

type PredictionEgressRecord = AIEgressRecord & {
  budgetDecision?: string;
  budgetReason?: string;
};

type RemoteBYOKSetupState = {
  providerId: string;
  endpoint: string;
  model: string;
  apiKey: string;
  consentAccepted: boolean;
  statusTone: "idle" | "success" | "error";
  statusMessage: string;
};

type ProviderClassificationSource = {
  kind?: string;
  endpointClass?: string;
  local?: boolean;
  frontier?: boolean;
  externalAccount?: boolean;
  billingMode?: string;
  status?: string;
  reason?: string;
  authConfigured?: boolean;
  requiresAuth?: boolean;
};

const defaultRemoteBYOKSetupState = (): RemoteBYOKSetupState => ({
  providerId: defaultRemoteBYOKProviderID,
  endpoint: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  consentAccepted: false,
  statusTone: "idle",
  statusMessage: "",
});

const normalizeProviderIDInput = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isBackgroundPredictionEgress = (
  record: AIEgressRecord,
): record is PredictionEgressRecord =>
  record.optInSource === predictionBackgroundOptInSource ||
  record.source === predictionBackgroundOptInSource ||
  String(record.capability) === "line_prediction";

const mergePredictionEgressRecord = (
  records: PredictionEgressRecord[],
  record: PredictionEgressRecord,
) => {
  const withoutDuplicate = records.filter((item) => item.id !== record.id);
  return [record, ...withoutDuplicate]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
};

const describeProviderClass = (
  source: ProviderClassificationSource | null | undefined,
) => {
  if (!source) {
    return {
      label: "Not configured",
      detail: "No prediction provider is selected.",
      tone: "warning" as const,
    };
  }
  if (
    source.externalAccount ||
    source.endpointClass === "local_process_external_account" ||
    source.billingMode === "provider_account"
  ) {
    return {
      label: "External account",
      detail:
        "Provider-account adapters are unavailable for passive prediction.",
      tone: "error" as const,
    };
  }
  if (source.frontier) {
    return {
      label: "Frontier unavailable",
      detail:
        "Frontier prediction adapters need a separate legal adapter path.",
      tone: "error" as const,
    };
  }
  if (
    source.endpointClass === "remote_byok" ||
    (!source.local && source.kind)
  ) {
    return {
      label: "Remote API key",
      detail: source.authConfigured
        ? "Uses a user-supplied API key and remote provider terms."
        : "Requires a user-supplied API key before predictions can run.",
      tone: source.authConfigured ? ("success" as const) : ("warning" as const),
    };
  }
  if (source.local) {
    return {
      label: "Local",
      detail: "Runs against a local provider endpoint.",
      tone: "success" as const,
    };
  }
  return {
    label: "Unknown endpoint",
    detail: "Provider endpoint class is not verified.",
    tone: "warning" as const,
  };
};

const providerClassTone = (tone: "success" | "warning" | "error") => {
  switch (tone) {
    case "success":
      return "text-[var(--status-success)]";
    case "error":
      return "text-[var(--status-error)]";
    default:
      return "text-[var(--status-warning)]";
  }
};

const formatPredictionEgressTime = (createdAt: string) => {
  if (!createdAt) {
    return "unknown time";
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatPredictionEgressTokens = (record: PredictionEgressRecord) => {
  const total = record.totalTokens || record.inputTokens || record.outputTokens;
  if (!total) {
    return "tokens n/a";
  }
  return `${total}${record.estimatedTokens ? " est." : ""} tokens`;
};

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
  | "ai"
  | "diagnostics"
  | "mcp"
  | "browser-preview"
  | "keybindings";

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

interface SettingsSearchEntry {
  id: string;
  tab: TabId;
  label: string;
  description: string;
  keywords: string[];
  suggested?: boolean;
}

const tabs: Tab[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: Code2 },
  {
    id: "ai",
    label: "AI",
    icon: Sparkles,
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: AlertCircle,
  },
  {
    id: "mcp",
    label: "MCP",
    icon: Shield,
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

const tabLabelById = new Map(tabs.map((tab) => [tab.id, tab.label]));

const settingsSearchEntries: SettingsSearchEntry[] = [
  {
    id: "project-opening",
    tab: "appearance",
    label: "Project opening",
    description: "Open projects in this window or separate macOS windows.",
    keywords: ["window", "workspace", "project window", "macos"],
    suggested: true,
  },
  {
    id: "app-icon",
    tab: "appearance",
    label: "App icon",
    description: "Choose the running macOS app icon appearance.",
    keywords: ["icon", "light", "dark", "system"],
  },
  {
    id: "system-font-family",
    tab: "appearance",
    label: "System Font Family",
    description: "Choose the UI font used outside the code editor.",
    keywords: ["ui font", "interface font", "local font"],
  },
  {
    id: "system-font-size",
    tab: "appearance",
    label: "System Font Size",
    description: "Adjust UI text size everywhere outside the code editor.",
    keywords: ["ui font size", "interface text size", "system text size"],
  },
  {
    id: "theme",
    tab: "appearance",
    label: "Theme",
    description: "Select built-in or custom color themes.",
    keywords: ["appearance", "catppuccin", "custom theme", "colors"],
    suggested: true,
  },
  {
    id: "zen-mode",
    tab: "appearance",
    label: "Zen Mode",
    description: "Hide chrome and snapped panels until edge hover.",
    keywords: ["focus", "fullscreen", "panels", "chrome"],
    suggested: true,
  },
  {
    id: "compact-topbar-actions",
    tab: "appearance",
    label: "Compact topbar actions",
    description: "Hide the project label and show actions in the topbar.",
    keywords: ["topbar", "project label", "actions", "compact"],
  },
  {
    id: "close-confirmation",
    tab: "appearance",
    label: "Close confirmation",
    description: "Ask before closing a project or quitting Arlecchino.",
    keywords: ["quit", "project close", "confirm"],
  },
  {
    id: "topbar-icon-order",
    tab: "appearance",
    label: "Topbar icon order",
    description: "Restore the default order for draggable topbar controls.",
    keywords: ["topbar", "drag", "controls", "reset order"],
  },
  {
    id: "rainbow-brackets",
    tab: "appearance",
    label: "Rainbow brackets",
    description: "Color nested brackets with fixed depth colors.",
    keywords: ["brackets", "syntax", "colors", "editor"],
  },
  {
    id: "editor-font-family",
    tab: "editor",
    label: "Editor Font Family",
    description: "Choose the font used by the code editor.",
    keywords: ["code font", "monospace", "local font"],
    suggested: true,
  },
  {
    id: "editor-font-size",
    tab: "editor",
    label: "Editor Font Size",
    description: "Adjust the text size in the code editor.",
    keywords: ["font size", "code size", "text size"],
  },
  {
    id: "ui-scale",
    tab: "editor",
    label: "UI Scale",
    description: "Adjust the overall zoom of the application interface.",
    keywords: ["zoom", "scale", "interface size"],
    suggested: true,
  },
  {
    id: "operator-ligatures",
    tab: "editor",
    label: "Operator ligatures",
    description: "Render operator sequences as visual arrows.",
    keywords: ["ligatures", "arrows", "operators", "font"],
  },
  {
    id: "indent-guides",
    tab: "editor",
    label: "Indent guides",
    description: "Show low-noise indentation markers in normal editor mode.",
    keywords: ["indent", "guides", "markers", "scope"],
  },
  {
    id: "color-tools",
    tab: "editor",
    label: "Color tools",
    description: "Show color swatches in stylesheets and theme files.",
    keywords: ["color", "swatch", "css", "theme"],
  },
  {
    id: "fold-gutter",
    tab: "diagnostics",
    label: "Fold gutter",
    description:
      "Opt into visible code folding controls in stable editor layouts.",
    keywords: ["fold", "gutter", "collapse", "outline"],
  },
  {
    id: "show-minimap",
    tab: "diagnostics",
    label: "Show minimap",
    description: "Display the code minimap in the editor gutter.",
    keywords: ["minimap", "editor", "gutter"],
  },
  {
    id: "compact-diagnostics",
    tab: "diagnostics",
    label: "Show compact diagnostics",
    description: "Keep the project-wide problems badge visible.",
    keywords: ["status bar", "problems", "badge"],
  },
  {
    id: "autocomplete-support",
    tab: "diagnostics",
    label: "Autocomplete support",
    description: "Language capability matrix for editor completions.",
    keywords: ["completion", "lsp", "languages", "capabilities"],
    suggested: true,
  },
  {
    id: "build-identity",
    tab: "diagnostics",
    label: "Build identity",
    description: "Inspect version, package, channel, and update status.",
    keywords: ["version", "build", "commit", "updates", "diagnostics"],
  },
  {
    id: "private-release-access",
    tab: "diagnostics",
    label: "Private GitHub release access",
    description: "Save or clear private update access token.",
    keywords: ["github", "token", "release", "updates"],
  },
  {
    id: "ai-chat-send",
    tab: "ai",
    label: "AI chat send shortcut",
    description: "Choose whether Enter or Cmd+Enter sends chat messages.",
    keywords: ["ai", "chat", "enter", "send", "cmd enter"],
    suggested: true,
  },
  {
    id: "ai-chat-surface",
    tab: "ai",
    label: "AI chat surface",
    description: "Persist transcript display and default context preferences.",
    keywords: ["ai", "chat", "context", "display", "runtime activity"],
  },
  {
    id: "ai-chat-workflow",
    tab: "ai",
    label: "AI chat workflow",
    description: "Control linked Plan, Build, and Review run behavior.",
    keywords: ["ai", "chat", "plan", "build", "review", "workflow"],
  },
  {
    id: "ai-provider-launch",
    tab: "ai",
    label: "Provider launch",
    description: "Start local AI runtimes from the AI Chat provider popup.",
    keywords: ["ai", "provider", "model", "llama", "ollama", "byok"],
  },
  {
    id: "ai-predictions",
    tab: "ai",
    label: "AI predictions",
    description: "Enable passive editor predictions with hard request budgets.",
    keywords: ["ai", "prediction", "autocomplete", "ghost", "byok", "budget"],
    suggested: true,
  },
  {
    id: "ai-remote-byok",
    tab: "ai",
    label: "Remote API key setup",
    description: "Connect an OpenAI-compatible API key for predictions.",
    keywords: ["ai", "provider", "byok", "api key", "openai", "endpoint"],
  },
  {
    id: "mcp-enabled",
    tab: "mcp",
    label: "MCP server",
    description: "Enable or fully disable Arlecchino MCP tools.",
    keywords: ["mcp", "server", "tools", "disable"],
    suggested: true,
  },
  {
    id: "mcp-approval-policy",
    tab: "mcp",
    label: "MCP approval policy",
    description: "Configure approval prompts and default approval lifetime.",
    keywords: ["mcp", "approval", "approve", "permission", "ttl"],
  },
  {
    id: "mcp-tool-access",
    tab: "mcp",
    label: "MCP tool access",
    description: "Choose which Arlecchino MCP tools remain available.",
    keywords: ["mcp", "tools", "selective", "bridge", "agent"],
  },
  {
    id: "markdown-links",
    tab: "browser-preview",
    label: "Markdown links",
    description: "Choose how Markdown preview links open.",
    keywords: ["browser", "preview", "links", "markdown"],
  },
  {
    id: "auto-open-preview",
    tab: "browser-preview",
    label: "Auto-open Preview",
    description: "Open browser preview when terminal reports a local URL.",
    keywords: ["browser", "terminal", "localhost", "url"],
    suggested: true,
  },
  {
    id: "reuse-session-window",
    tab: "browser-preview",
    label: "Reuse Session Window",
    description: "Keep one preview window per terminal session.",
    keywords: ["browser", "terminal", "session", "window"],
  },
  {
    id: "close-on-session-exit",
    tab: "browser-preview",
    label: "Close on Session Exit",
    description: "Close auto-opened previews when terminal session ends.",
    keywords: ["browser", "terminal", "close"],
  },
  {
    id: "keybindings",
    tab: "keybindings",
    label: "Keybindings",
    description: "Customize workspace panel shortcuts and app actions.",
    keywords: ["shortcuts", "keyboard", "hotkeys", "commands"],
    suggested: true,
  },
];

const normalizeSettingsSearchText = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const rankSettingsSearchEntry = (entry: SettingsSearchEntry, query: string) => {
  if (!query) {
    return entry.suggested ? 0 : Number.POSITIVE_INFINITY;
  }

  const label = normalizeSettingsSearchText(entry.label);
  const tab = normalizeSettingsSearchText(tabLabelById.get(entry.tab) ?? "");
  const description = normalizeSettingsSearchText(entry.description);
  const keywords = entry.keywords.map(normalizeSettingsSearchText);

  if (label === query) {
    return 0;
  }
  if (label.startsWith(query)) {
    return 1;
  }
  if (keywords.some((keyword) => keyword === query)) {
    return 2;
  }
  if (keywords.some((keyword) => keyword.includes(query))) {
    return 3;
  }
  if (label.includes(query)) {
    return 4;
  }
  if (description.includes(query)) {
    return 5;
  }
  if (tab.includes(query)) {
    return 6;
  }

  return Number.POSITIVE_INFINITY;
};

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
  badge?: string;
  controlLabel?: string;
  highlighted?: boolean;
  settingId?: string;
}> = ({
  title,
  description,
  checked,
  onCheckedChange,
  badge,
  controlLabel,
  highlighted = false,
  settingId,
}) => (
  <div
    data-setting-id={settingId}
    className={`flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 transition-shadow last:border-0 sm:flex-row sm:items-center sm:justify-between ${
      highlighted
        ? "bg-[color-mix(in_srgb,var(--focus-ring)_8%,transparent)] ring-1 ring-inset ring-[var(--focus-ring)]"
        : ""
    }`}
  >
    <div className="pr-4">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        {title}
        {badge ? (
          <span className="inline-flex min-h-[20px] items-center rounded-full border border-[color-mix(in_srgb,var(--focus-ring)_35%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--focus-ring)_10%,transparent)] px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
        {description}
      </div>
    </div>
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={controlLabel ?? title}
      className={settingsSwitchRootClass}
    >
      <Switch.Thumb className={settingsSwitchThumbClass} />
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
  highlighted?: boolean;
  settingId?: string;
}> = ({ value, onChange, highlighted = false, settingId }) => (
  <div
    data-setting-id={settingId}
    className={`${settingsPanelClass} p-4 transition-shadow ${
      highlighted
        ? "bg-[color-mix(in_srgb,var(--focus-ring)_8%,transparent)] ring-1 ring-inset ring-[var(--focus-ring)]"
        : ""
    }`}
  >
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

const AppIconAppearanceControl: React.FC<{
  value: AppIconAppearance;
  onChange: (value: AppIconAppearance) => void;
  highlighted?: boolean;
  settingId?: string;
}> = ({ value, onChange, highlighted = false, settingId }) => (
  <div
    data-setting-id={settingId}
    className={`${settingsPanelClass} p-4 transition-shadow ${
      highlighted
        ? "bg-[color-mix(in_srgb,var(--focus-ring)_8%,transparent)] ring-1 ring-inset ring-[var(--focus-ring)]"
        : ""
    }`}
  >
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          App icon
        </div>
        <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
          Choose the running macOS app icon or keep the system icon style.
        </div>
      </div>
      <div
        role="group"
        aria-label="App icon appearance"
        className="shell-cluster-soft inline-flex min-h-[42px] items-center gap-1 px-1.5 py-1"
      >
        {appIconAppearanceOptions.map((option) => (
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
  const reduceSettingsMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<TabId>("appearance");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [settingsSearchFocused, setSettingsSearchFocused] = useState(false);
  const [pendingSettingScrollId, setPendingSettingScrollId] = useState<
    string | null
  >(null);
  const [highlightedSettingId, setHighlightedSettingId] = useState<
    string | null
  >(null);
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [privateUpdateAuthStatus, setPrivateUpdateAuthStatus] =
    useState<PrivateUpdateAuthStatus | null>(null);
  const [privateUpdateToken, setPrivateUpdateToken] = useState("");
  const [privateUpdateAuthBusy, setPrivateUpdateAuthBusy] = useState(false);
  const [autocompleteCapabilities, setAutocompleteCapabilities] = useState<
    AutocompleteLanguageCapability[]
  >([]);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState<string | null>(
    null,
  );
  const [autocompleteInstallingIds, setAutocompleteInstallingIds] = useState<
    Set<string>
  >(() => new Set());
  const [autocompleteInstallEvents, setAutocompleteInstallEvents] = useState<
    Record<string, LocalLSPInstallState>
  >({});
  const [mcpStatus, setMCPStatus] = useState<MCPSettingsStatus | null>(null);
  const [mcpLoading, setMCPLoading] = useState(false);
  const [mcpSaving, setMCPSaving] = useState(false);
  const [mcpError, setMCPError] = useState<string | null>(null);
  const [mcpToolQuery, setMCPToolQuery] = useState("");
  const [predictionStatus, setPredictionStatus] =
    useState<AIPredictionStatus | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionSaving, setPredictionSaving] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [aiProviders, setAIProviders] = useState<AIProviderDescriptor[]>([]);
  const [aiProviderLoading, setAIProviderLoading] = useState(false);
  const [predictionActivityLoading, setPredictionActivityLoading] =
    useState(false);
  const [predictionActivityError, setPredictionActivityError] = useState<
    string | null
  >(null);
  const [predictionEgressRecords, setPredictionEgressRecords] = useState<
    PredictionEgressRecord[]
  >([]);
  const [remoteBYOKSetup, setRemoteBYOKSetup] = useState<RemoteBYOKSetupState>(
    () => defaultRemoteBYOKSetupState(),
  );
  const [remoteBYOKBusy, setRemoteBYOKBusy] = useState(false);
  const [customThemeStatus, setCustomThemeStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [customFontStatus, setCustomFontStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [localFontFamilies, setLocalFontFamilies] = useState<string[]>([]);
  const [shortcutGroup, setShortcutGroup] = useState<"All" | ShortcutGroup>(
    "All",
  );
  const [recordingActionId, setRecordingActionId] =
    useState<ShortcutActionId | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const settingsHighlightTimeoutRef = useRef<number | null>(null);
  const customThemeInputRef = useRef<HTMLInputElement | null>(null);
  const customFontInputRef = useRef<HTMLInputElement | null>(null);
  const customFontTargetRef = useRef<"ui" | "editor">("ui");
  const handleDialogInteractOutside = useCallback((event: Event) => {
    if (isAppNotificationInteractionEvent(event)) {
      event.preventDefault();
    }
  }, []);
  const handleDialogOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    setSettingsSearchFocused(false);
  }, []);

  const { theme, setTheme, previewTheme, customThemes, addCustomTheme } =
    useTheme();
  const {
    uiScale,
    uiFontFamily,
    uiFontSize,
    customFonts,
    editorFontFamily,
    editorFontSize,
    minFontSize,
    maxFontSize,
    showCompactDiagnostics,
    showFoldGutter,
    showIndentGuides,
    showColorTools,
    showMinimap,
    showRainbowBrackets,
    showOperatorLigatures,
    showTopbarProjectPath,
    confirmBeforeClose,
    zenModeEnabled,
    projectWindowMode,
    appIconAppearance,
    aiChatSendShortcut,
    aiChatPreferences,
    setUiScale,
    setUiFontFamily,
    resetUiFontFamily,
    setUiFontSize,
    resetUiFontSize,
    addCustomFont,
    setEditorFontFamily,
    resetEditorFontFamily,
    setEditorFontSize,
    resetZoom,
    setShowCompactDiagnostics,
    setShowFoldGutter,
    setShowIndentGuides,
    setShowColorTools,
    setShowMinimap,
    setShowRainbowBrackets,
    setShowOperatorLigatures,
    setShowTopbarProjectPath,
    setConfirmBeforeClose,
    resetTopbarItemOrder,
    setZenModeEnabled,
    setProjectWindowMode,
    setAppIconAppearance,
    setAIChatSendShortcut,
    setAIChatDisplayPref,
    setAIChatDefaultContext,
    setAIChatWorkflowPref,
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
  const privateUpdateAccessLabel = privateUpdateAuthStatus
    ? privateUpdateAuthStatus.configured
      ? `configured via ${privateUpdateAuthStatus.source ?? "private access"}`
      : (privateUpdateAuthStatus.reason ?? "not configured")
    : "not loaded";
  const activeEditorFontFamilyPreset =
    editorFontFamilyPresets.find(
      (preset) => preset.value === editorFontFamily,
    ) ?? null;
  const localFontOptions = useMemo<FontOption[]>(
    () =>
      uniqueFontOptions(
        [...localFontFamilies, ...commonSystemFontFamilies]
          .filter((family) => family.trim().length > 0)
          .sort((a, b) => a.localeCompare(b))
          .map((family) => ({
            label: family,
            value: buildUiFontValue(family),
            sampleFamily: quoteFontFamily(family),
          })),
      ),
    [localFontFamilies],
  );
  const uiFontOptions = useMemo<FontOption[]>(
    () =>
      uniqueFontOptions([
        ...uiFontFamilyPresets.map((preset) => ({
          ...preset,
          sampleFamily: preset.value,
        })),
        ...localFontOptions,
        ...customFontOptions(customFonts, buildUiFontValue),
      ]),
    [customFonts, localFontOptions],
  );
  const editorFontOptions = useMemo<FontOption[]>(
    () =>
      uniqueFontOptions([
        ...editorFontFamilyPresets.map((preset) => ({
          ...preset,
          sampleFamily: preset.value,
        })),
        ...localFontFamilies
          .filter((family) => family.trim().length > 0)
          .sort((a, b) => a.localeCompare(b))
          .map((family) => ({
            label: family,
            value: buildEditorFontValue(family),
            sampleFamily: quoteFontFamily(family),
          })),
        ...customFontOptions(customFonts, buildEditorFontValue),
      ]),
    [customFonts, localFontFamilies],
  );
  const activeUiFontFamilyOption =
    uiFontOptions.find((option) => option.value === uiFontFamily) ?? null;
  const activeUiFontFamilyLabel = activeUiFontFamilyOption?.label ?? "Custom";
  const activeEditorFontFamilyOption =
    editorFontOptions.find((option) => option.value === editorFontFamily) ??
    activeEditorFontFamilyPreset;
  const activeEditorFontFamilyLabel =
    activeEditorFontFamilyOption?.label ?? "Custom";
  const settingsSearchSuggestions = useMemo(() => {
    const query = normalizeSettingsSearchText(settingsQuery);
    return settingsSearchEntries
      .map((entry) => ({
        entry,
        rank: rankSettingsSearchEntry(entry, query),
      }))
      .filter(({ rank }) => Number.isFinite(rank))
      .sort((a, b) => {
        if (a.rank !== b.rank) {
          return a.rank - b.rank;
        }
        const tabDelta =
          tabs.findIndex((tab) => tab.id === a.entry.tab) -
          tabs.findIndex((tab) => tab.id === b.entry.tab);
        if (tabDelta !== 0) {
          return tabDelta;
        }
        return a.entry.label.localeCompare(b.entry.label);
      })
      .slice(0, 8)
      .map(({ entry }) => entry);
  }, [settingsQuery]);
  const showSettingsSearchSuggestions = settingsSearchFocused;
  const getSettingTargetClass = (settingId: string) =>
    highlightedSettingId === settingId
      ? "ring-1 ring-inset ring-[var(--focus-ring)] bg-[color-mix(in_srgb,var(--focus-ring)_8%,transparent)]"
      : "";

  const selectSettingsSearchEntry = useCallback(
    (entry: SettingsSearchEntry) => {
      setActiveTab(entry.tab);
      setPendingSettingScrollId(entry.id);
      setHighlightedSettingId(entry.id);
      setSettingsQuery("");
      setSettingsSearchFocused(false);
    },
    [],
  );

  const refreshPrivateUpdateAuthStatus = useCallback(async () => {
    const status = await getPrivateUpdateAuthStatus();
    setPrivateUpdateAuthStatus(status);
    return status;
  }, []);

  const refreshMCPSettings = useCallback(async () => {
    setMCPLoading(true);
    setMCPError(null);
    try {
      const status = await getMCPSettings();
      setMCPStatus(status);
      return status;
    } catch (error) {
      setMCPError(
        error instanceof Error ? error.message : "Unable to load MCP settings.",
      );
      return null;
    } finally {
      setMCPLoading(false);
    }
  }, []);

  const saveMCPSettingsUpdate = useCallback(async (settings: MCPSettings) => {
    setMCPSaving(true);
    setMCPError(null);
    try {
      const status = await saveMCPSettings(settings);
      setMCPStatus(status);
      return status;
    } catch (error) {
      setMCPError(
        error instanceof Error ? error.message : "Unable to save MCP settings.",
      );
      return null;
    } finally {
      setMCPSaving(false);
    }
  }, []);

  const updateMCPSettings = useCallback(
    (patch: Partial<MCPSettings>) => {
      if (!mcpStatus) {
        return;
      }
      void saveMCPSettingsUpdate({
        ...mcpStatus.settings,
        ...patch,
      });
    },
    [mcpStatus, saveMCPSettingsUpdate],
  );

  const refreshPredictionStatus = useCallback(async () => {
    setPredictionLoading(true);
    setPredictionError(null);
    try {
      const status = await AIGetPredictionStatus();
      setPredictionStatus(status);
      return status;
    } catch (error) {
      setPredictionError(
        error instanceof Error
          ? error.message
          : "Unable to load AI prediction settings.",
      );
      return null;
    } finally {
      setPredictionLoading(false);
    }
  }, []);

  const refreshAIProviders = useCallback(async () => {
    setAIProviderLoading(true);
    try {
      const providers = await AIListProviders();
      setAIProviders(providers ?? []);
      return providers ?? [];
    } catch {
      setAIProviders([]);
      return [];
    } finally {
      setAIProviderLoading(false);
    }
  }, []);

  const refreshPredictionActivity = useCallback(async () => {
    setPredictionActivityLoading(true);
    setPredictionActivityError(null);
    try {
      const records = await AIListEgressRecords(50);
      const predictionRecords = (records ?? [])
        .filter(isBackgroundPredictionEgress)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 8);
      setPredictionEgressRecords(predictionRecords);
      return predictionRecords;
    } catch (error) {
      setPredictionActivityError(
        error instanceof Error
          ? error.message
          : "Unable to load prediction activity.",
      );
      return [];
    } finally {
      setPredictionActivityLoading(false);
    }
  }, []);

  const savePredictionSettingsUpdate = useCallback(
    async (patch: Partial<AIPredictionSettings>) => {
      if (!predictionStatus) {
        return null;
      }
      setPredictionSaving(true);
      setPredictionError(null);
      const current = predictionStatus.settings;
      const nextSettings: AIPredictionSettings = {
        ...current,
        ...patch,
        budget: {
          ...current.budget,
          ...(patch.budget ?? {}),
        },
      };
      try {
        const status = await AISavePredictionSettings(nextSettings);
        setPredictionStatus(status);
        return status;
      } catch (error) {
        setPredictionError(
          error instanceof Error
            ? error.message
            : "Unable to save AI prediction settings.",
        );
        return null;
      } finally {
        setPredictionSaving(false);
      }
    },
    [predictionStatus],
  );

  const connectRemoteBYOKForPrediction = useCallback(async () => {
    const providerId =
      normalizeProviderIDInput(remoteBYOKSetup.providerId) ||
      defaultRemoteBYOKProviderID;
    const endpoint = remoteBYOKSetup.endpoint.trim();
    const model = remoteBYOKSetup.model.trim();
    const apiKey = remoteBYOKSetup.apiKey.trim();
    if (!endpoint) {
      setRemoteBYOKSetup((current) => ({
        ...current,
        statusTone: "error",
        statusMessage: "Endpoint is required.",
      }));
      return;
    }
    if (!apiKey) {
      setRemoteBYOKSetup((current) => ({
        ...current,
        statusTone: "error",
        statusMessage: "API key is required for the remote provider.",
      }));
      return;
    }
    if (!remoteBYOKSetup.consentAccepted) {
      setRemoteBYOKSetup((current) => ({
        ...current,
        statusTone: "error",
        statusMessage:
          "Accept the remote provider disclosure before connecting.",
      }));
      return;
    }

    setRemoteBYOKBusy(true);
    setPredictionError(null);
    setRemoteBYOKSetup((current) => ({
      ...current,
      providerId,
      statusTone: "idle",
      statusMessage: "Saving provider without enabling predictions...",
    }));

    const disabledProviderSettings: AIProviderSettings = {
      id: providerId,
      name: "OpenAI-compatible",
      kind: remoteBYOKProviderKind,
      endpoint,
      model,
      enabled: false,
      manual: true,
      secretValue: apiKey,
    };

    try {
      await AISaveProviderSettings(disabledProviderSettings);
      setRemoteBYOKSetup((current) => ({
        ...current,
        statusMessage: "Testing provider connection...",
      }));
      const checked = await AITestProvider(providerId);
      if (String(checked.status) !== "ready") {
        throw new Error(checked.reason || "Provider test did not pass.");
      }

      const enabledProviderSettings: AIProviderSettings = {
        ...disabledProviderSettings,
        enabled: true,
        secretValue: "",
      };
      await AISaveProviderSettings(enabledProviderSettings);

      const consentPolicy =
        (await AIGetConsentPolicy()) as RemoteBYOKConsentPolicy;
      const nextConsentPolicy: RemoteBYOKConsentPolicy = {
        ...consentPolicy,
        remoteByokProvidersAccepted: true,
      };
      await AISaveConsentPolicy(nextConsentPolicy);

      const latestStatus = await AIGetPredictionStatus();
      const nextSettings: AIPredictionSettings = {
        ...latestStatus.settings,
        enabled: true,
        mode:
          latestStatus.settings.mode && latestStatus.settings.mode !== "off"
            ? latestStatus.settings.mode
            : "subtle",
        providerId,
        model: checked.defaultModel || model || latestStatus.model || "",
      };
      const nextStatus = await AISavePredictionSettings(nextSettings);
      setPredictionStatus(nextStatus);
      setRemoteBYOKSetup((current) => ({
        ...current,
        apiKey: "",
        statusTone: "success",
        statusMessage:
          "Remote provider is connected and selected for predictions.",
      }));
      void refreshAIProviders();
      void refreshPredictionActivity();
    } catch (error) {
      setRemoteBYOKSetup((current) => ({
        ...current,
        statusTone: "error",
        statusMessage:
          error instanceof Error
            ? error.message
            : "Unable to connect remote provider.",
      }));
    } finally {
      setRemoteBYOKBusy(false);
    }
  }, [
    refreshAIProviders,
    refreshPredictionActivity,
    remoteBYOKSetup.apiKey,
    remoteBYOKSetup.consentAccepted,
    remoteBYOKSetup.endpoint,
    remoteBYOKSetup.model,
    remoteBYOKSetup.providerId,
  ]);

  const setMCPToolEnabled = useCallback(
    (tool: MCPToolSettingsEntry, enabled: boolean) => {
      if (!mcpStatus) {
        return;
      }
      const disabledTools = new Set(mcpStatus.settings.disabledTools);
      if (enabled) {
        disabledTools.delete(tool.name);
      } else {
        disabledTools.add(tool.name);
      }
      void saveMCPSettingsUpdate({
        ...mcpStatus.settings,
        disabledTools: Array.from(disabledTools).sort(),
      });
    },
    [mcpStatus, saveMCPSettingsUpdate],
  );

  const refreshAutocompleteCapabilities = useCallback(async () => {
    setAutocompleteLoading(true);
    setAutocompleteError(null);
    try {
      const capabilities = await GetAutocompleteLanguageCapabilities();
      const nextCapabilities = capabilities ?? [];
      setAutocompleteCapabilities(nextCapabilities);
      setAutocompleteInstallingIds((previous) => {
        if (previous.size === 0) {
          return previous;
        }
        const installingServerIds = new Set(
          nextCapabilities
            .filter((capability) => capability.lspInstalling)
            .map((capability) => capability.lspServerId)
            .filter(Boolean),
        );
        const retained = new Set(
          [...previous].filter((serverId) => installingServerIds.has(serverId)),
        );
        return retained.size === previous.size ? previous : retained;
      });
      setAutocompleteInstallEvents((previous) => {
        const next = { ...previous };
        let changed = false;
        const capabilitiesByServer = new Map(
          nextCapabilities
            .map((capability) => [capability.lspServerId, capability] as const)
            .filter(([serverId]) => Boolean(serverId)),
        );

        for (const [serverId, event] of Object.entries(previous)) {
          const capability = capabilitiesByServer.get(serverId);
          const backendClean =
            capability &&
            (capability.lspInstalled ||
              (!capability.lspInstalling &&
                !capability.lspInstallError &&
                !capability.lspLastError));
          if (!event.running && backendClean) {
            delete next[serverId];
            changed = true;
          }
        }

        return changed ? next : previous;
      });
      return nextCapabilities;
    } catch (error) {
      setAutocompleteError(
        error instanceof Error
          ? error.message
          : "Unable to load autocomplete support.",
      );
      return [];
    } finally {
      setAutocompleteLoading(false);
    }
  }, []);

  const recordAutocompleteInstallEvent = useCallback(
    (event: LSPInstallEvent, fallbackRunning: boolean) => {
      const serverId = (event.lspId || event.id || "").trim();
      if (!serverId) {
        return;
      }
      const stage = (event.stage || (fallbackRunning ? "installing" : "done"))
        .trim()
        .toLowerCase();
      const terminal =
        stage === "done" ||
        stage === "complete" ||
        stage === "completed" ||
        stage === "error" ||
        stage === "failed" ||
        stage === "failure";
      const running = fallbackRunning && !terminal;

      setAutocompleteInstallingIds((previous) => {
        const next = new Set(previous);
        if (running) {
          next.add(serverId);
        } else {
          next.delete(serverId);
        }
        return next;
      });
      setAutocompleteInstallEvents((previous) => ({
        ...previous,
        [serverId]: {
          stage,
          percent: event.percent ?? (terminal ? 100 : 0),
          message: event.message || "",
          error: event.error || "",
          running,
        },
      }));
    },
    [],
  );

  useEffect(() => {
    const queryLocalFonts = (navigator as LocalFontAccessNavigator)
      .queryLocalFonts;
    if (!queryLocalFonts) {
      return;
    }

    let cancelled = false;
    void queryLocalFonts
      .call(navigator)
      .then((fonts) => {
        if (cancelled) {
          return;
        }
        const families = Array.from(
          new Set(
            fonts
              .map((font) => (font.family || font.fullName || "").trim())
              .filter(Boolean),
          ),
        );
        setLocalFontFamilies(families);
      })
      .catch(() => {
        if (!cancelled) {
          setLocalFontFamilies([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const offProgress = EventsOn<[LSPInstallEvent]>(
      "lsp:install:progress",
      (event) => {
        recordAutocompleteInstallEvent(event, true);
      },
    );
    const offComplete = EventsOn<[LSPInstallEvent]>(
      "lsp:install:complete",
      (event) => {
        recordAutocompleteInstallEvent(
          { ...event, stage: event.stage || "done" },
          false,
        );
        if (activeTab === "diagnostics") {
          void refreshAutocompleteCapabilities();
        }
      },
    );
    const offError = EventsOn<[LSPInstallEvent]>(
      "lsp:install:error",
      (event) => {
        recordAutocompleteInstallEvent(
          { ...event, stage: event.stage || "error" },
          false,
        );
        if (activeTab === "diagnostics") {
          void refreshAutocompleteCapabilities();
        }
      },
    );
    const offRuntimeRefreshed = EventsOn<[unknown]>(
      "depsync:runtime-refreshed",
      () => {
        if (activeTab === "diagnostics") {
          void refreshAutocompleteCapabilities();
        }
      },
    );

    return () => {
      offProgress();
      offComplete();
      offError();
      offRuntimeRefreshed();
    };
  }, [
    activeTab,
    isOpen,
    recordAutocompleteInstallEvent,
    refreshAutocompleteCapabilities,
  ]);

  useEffect(() => {
    const unsubscribe = EventsOn<[AIPredictionStatus]>(
      "ai:prediction:settings-updated",
      (status) => setPredictionStatus(status),
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = EventsOn<[AIEgressRecord]>(
      "ai:chat:egress-recorded",
      (record) => {
        if (!isBackgroundPredictionEgress(record)) {
          return;
        }
        setPredictionEgressRecords((current) =>
          mergePredictionEgressRecord(current, record),
        );
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!pendingSettingScrollId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-setting-id="${pendingSettingScrollId}"]`,
      );

      setPendingSettingScrollId(null);
      if (!element) {
        return;
      }

      element.scrollIntoView({
        block: "center",
        behavior: reduceSettingsMotion ? "auto" : "smooth",
      });
      setHighlightedSettingId(pendingSettingScrollId);

      if (settingsHighlightTimeoutRef.current !== null) {
        window.clearTimeout(settingsHighlightTimeoutRef.current);
      }
      settingsHighlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedSettingId((current) =>
          current === pendingSettingScrollId ? null : current,
        );
        settingsHighlightTimeoutRef.current = null;
      }, 1600);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, pendingSettingScrollId, reduceSettingsMotion]);

  useEffect(
    () => () => {
      if (settingsHighlightTimeoutRef.current !== null) {
        window.clearTimeout(settingsHighlightTimeoutRef.current);
      }
    },
    [],
  );

  const savePrivateUpdateAccessToken = useCallback(async () => {
    const token = privateUpdateToken.trim();
    if (!token) {
      return;
    }
    setPrivateUpdateAuthBusy(true);
    try {
      const status = await savePrivateUpdateToken(token);
      setPrivateUpdateAuthStatus(status);
      setPrivateUpdateToken("");
    } finally {
      setPrivateUpdateAuthBusy(false);
    }
  }, [privateUpdateToken]);

  const clearPrivateUpdateAccessToken = useCallback(async () => {
    setPrivateUpdateAuthBusy(true);
    try {
      const status = await clearPrivateUpdateToken();
      setPrivateUpdateAuthStatus(status);
      setPrivateUpdateToken("");
    } finally {
      setPrivateUpdateAuthBusy(false);
    }
  }, []);

  const installAutocompleteLSP = useCallback(
    async (capability: AutocompleteLanguageCapability) => {
      const serverId = capability.lspServerId;
      if (!serverId) {
        return;
      }

      setAutocompleteError(null);
      setAutocompleteInstallingIds((previous) => {
        const next = new Set(previous);
        next.add(serverId);
        return next;
      });
      setAutocompleteInstallEvents((previous) => ({
        ...previous,
        [serverId]: {
          stage: "queued",
          percent: 0,
          message: "Queued installation...",
          error: "",
          running: true,
        },
      }));
      try {
        await InstallLSPServer(serverId);
        const installing = await IsLSPInstalling(serverId).catch(() => true);
        if (!installing) {
          setAutocompleteInstallingIds((previous) => {
            const next = new Set(previous);
            next.delete(serverId);
            return next;
          });
          setAutocompleteInstallEvents((previous) => ({
            ...previous,
            [serverId]: {
              ...(previous[serverId] ?? {
                stage: "done",
                percent: 100,
                message: "",
                error: "",
              }),
              running: false,
            },
          }));
        }
        await refreshAutocompleteCapabilities();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to install LSP.";
        setAutocompleteInstallingIds((previous) => {
          const next = new Set(previous);
          next.delete(serverId);
          return next;
        });
        setAutocompleteInstallEvents((previous) => ({
          ...previous,
          [serverId]: {
            stage: "error",
            percent: 0,
            message: "",
            error: message,
            running: false,
          },
        }));
        setAutocompleteError(message);
      }
    },
    [refreshAutocompleteCapabilities],
  );

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

  const autocompleteTierCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const capability of autocompleteCapabilities) {
      counts.set(capability.tier, (counts.get(capability.tier) ?? 0) + 1);
    }
    return autocompleteTierOrder.map((tier) => ({
      tier,
      label: autocompleteTierLabels[tier],
      count: counts.get(tier) ?? 0,
    }));
  }, [autocompleteCapabilities]);

  const filteredAutocompleteCapabilities = useMemo(() => {
    const query = autocompleteQuery.trim().toLowerCase();
    return autocompleteCapabilities
      .filter((capability) => {
        if (!query) {
          return true;
        }
        const haystack = [
          capability.id,
          capability.name,
          capability.canonicalId,
          capability.tier,
          capability.lspServerId,
          ...capability.extensions,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const tierDelta =
          autocompleteTierRank(a.tier) - autocompleteTierRank(b.tier);
        if (tierDelta !== 0) {
          return tierDelta;
        }
        return a.name.localeCompare(b.name);
      });
  }, [autocompleteCapabilities, autocompleteQuery]);

  const filteredMCPTools = useMemo(() => {
    const tools = mcpStatus?.tools ?? [];
    const query = mcpToolQuery.trim().toLowerCase();
    if (!query) {
      return tools;
    }
    return tools.filter((tool) =>
      [tool.name, tool.description, tool.group]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [mcpStatus, mcpToolQuery]);

  useEffect(() => {
    if (!isOpen || activeTab !== "diagnostics") {
      return;
    }

    void refreshPrivateUpdateAuthStatus();
    void refreshAutocompleteCapabilities();
  }, [
    activeTab,
    isOpen,
    refreshAutocompleteCapabilities,
    refreshPrivateUpdateAuthStatus,
  ]);

  useEffect(() => {
    if (!isOpen || activeTab !== "mcp") {
      return;
    }

    void refreshMCPSettings();
  }, [activeTab, isOpen, refreshMCPSettings]);

  useEffect(() => {
    if (!isOpen || activeTab !== "ai") {
      return;
    }

    void refreshPredictionStatus();
    void refreshAIProviders();
    void refreshPredictionActivity();
  }, [
    activeTab,
    isOpen,
    refreshAIProviders,
    refreshPredictionActivity,
    refreshPredictionStatus,
  ]);

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

  const handleCustomFontFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    if (file.size > CUSTOM_FONT_MAX_BYTES) {
      setCustomFontStatus({
        tone: "error",
        message: "Font file is larger than 5 MB.",
      });
      return;
    }

    try {
      const label = trimFontLabel(file.name) || "Custom font";
      const fontFamily = `Arlecchino Custom ${label} ${Date.now()}`;
      const customFont: CustomFontFaceDefinition = {
        id: `${fontFamily}-${file.size}`,
        label,
        fontFamily,
        dataUrl: await fileToDataUrl(file),
      };

      addCustomFont(customFont);
      if (customFontTargetRef.current === "editor") {
        setEditorFontFamily(buildEditorFontValue(customFont.fontFamily));
      } else {
        setUiFontFamily(buildUiFontValue(customFont.fontFamily));
      }
      setCustomFontStatus({
        tone: "success",
        message: `Added ${label}`,
      });
    } catch (error) {
      setCustomFontStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Unable to import font.",
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

  const renderAutocompleteSupport = () => (
    <div
      className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
        "autocomplete-support",
      )}`}
      data-setting-id="autocomplete-support"
      data-testid="autocomplete-support"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Autocomplete support
          </div>
          <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
            Language capability matrix for editor completions.
          </div>
        </div>
        <button
          type="button"
          className={settingsActionButtonClass}
          disabled={autocompleteLoading}
          onClick={() => {
            void refreshAutocompleteCapabilities();
          }}
        >
          <RefreshCw
            size={14}
            className={autocompleteLoading ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        {autocompleteTierCounts.map((item) => (
          <div
            key={item.tier}
            className="rounded-[16px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] px-3 py-2"
          >
            <div className="text-[11px] text-[var(--text-muted)]">
              {item.label}
            </div>
            <div className="mt-1 font-mono text-[18px] text-[var(--text-primary)]">
              {item.count}
            </div>
          </div>
        ))}
      </div>

      <label className="shell-cluster-soft mt-4 flex min-h-[42px] min-w-0 items-center gap-2 px-3">
        <Search size={15} className="shrink-0 text-[var(--text-muted)]" />
        <input
          value={autocompleteQuery}
          onChange={(event) => setAutocompleteQuery(event.currentTarget.value)}
          placeholder="Search languages, extensions, or LSP servers"
          data-testid="autocomplete-support-search"
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </label>

      {autocompleteError ? (
        <div className="mt-3 flex items-center gap-2 rounded-[16px] border border-[color-mix(in_srgb,var(--status-error)_55%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--status-error)]">
          <AlertCircle size={14} />
          {autocompleteError}
        </div>
      ) : null}

      <div className="mt-4 max-h-[420px] overflow-y-auto rounded-[18px] border border-[var(--border-subtle)]">
        {filteredAutocompleteCapabilities.map((capability) => {
          const installEvent =
            autocompleteInstallEvents[capability.lspServerId] ?? null;
          const lspInstalling =
            capability.lspInstalling ||
            Boolean(installEvent?.running) ||
            autocompleteInstallingIds.has(capability.lspServerId);
          const lspError =
            installEvent?.error ||
            capability.lspInstallError ||
            capability.lspLastError ||
            "";
          const lspMissingDependency = /missing dependency/i.test(lspError);
          const lspActive = capability.lspRunning;
          const lspInstalled = capability.lspInstalled;
          const lspAvailable = capability.sources.lspAvailable;
          const lspLabel = !capability.sources.lspDeclared
            ? "No LSP"
            : lspInstalling
              ? "Installing"
              : lspError && !lspInstalled
                ? lspMissingDependency
                  ? "Missing dependency"
                  : "Error"
                : lspActive
                  ? "Running"
                  : lspInstalled
                    ? "Installed"
                    : capability.lspCanInstall
                      ? "Missing"
                      : capability.lspConfigured
                        ? "Configured"
                        : "Declared";
          const showInstallButton =
            capability.sources.lspDeclared &&
            capability.lspCanInstall &&
            !lspInstalled;
          const canInstall = showInstallButton && !lspInstalling;
          const installMessage =
            installEvent?.message || capability.lspInstallMessage || "";
          const installStage =
            installEvent?.stage || capability.lspInstallStage || "";
          const installPercent =
            installEvent?.percent ?? capability.lspInstallPercent;
          const installType = capability.lspInstallType || "";
          const installTypeLabel =
            installType === "brew"
              ? "Homebrew"
              : installType
                ? installType.toUpperCase()
                : "";
          const installDependencies = capability.lspInstallDependencies ?? [];
          const installUnavailableReason =
            !lspInstalled && !capability.lspCanInstall
              ? capability.lspInstallUnavailableReason
              : "";
          const showInstallMetadata =
            capability.sources.lspDeclared &&
            (installTypeLabel ||
              capability.lspInstallCommand ||
              installDependencies.length > 0 ||
              installUnavailableReason);
          const installDetail = lspInstalling
            ? [
                installMessage || installStage || "Installing",
                installPercent > 0 && installPercent < 100
                  ? `${Math.round(installPercent)}%`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")
            : "";

          return (
            <div
              key={capability.id}
              className="grid gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {capability.name}
                  </span>
                  <span className={settingsPillClass}>
                    {autocompleteTierLabels[capability.tier] ?? capability.tier}
                  </span>
                  <span
                    className={
                      lspError && !lspInstalling
                        ? `${settingsPillClass} min-h-[26px] border-[color-mix(in_srgb,var(--status-error)_45%,var(--border-subtle))] px-2.5 text-[var(--status-error)]`
                        : autocompleteBadgeClass(lspActive || lspAvailable)
                    }
                  >
                    LSP: {lspLabel}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                  <span className="font-mono">{capability.id}</span>
                  {capability.lspServerId ? (
                    <span className="font-mono">{capability.lspServerId}</span>
                  ) : null}
                  {installTypeLabel ? <span>{installTypeLabel}</span> : null}
                  {capability.lspBinaryPath ? (
                    <span
                      className="max-w-full break-all font-mono lg:max-w-[520px]"
                      title={capability.lspBinaryPath}
                    >
                      {capability.lspBinaryPath}
                    </span>
                  ) : null}
                  {capability.extensions.length ? (
                    <span className="break-words">
                      {capability.extensions.join(", ")}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <span
                  className={autocompleteBadgeClass(
                    autocompleteImportLevelKey(capability.autoImportLevel) !==
                      "none",
                  )}
                >
                  {autocompleteImportLevelLabel(capability.autoImportLevel)}
                </span>
                {autocompleteSourceLabels.map(([source, label]) => (
                  <span
                    key={String(source)}
                    className={autocompleteBadgeClass(
                      Boolean(capability.sources[source]),
                    )}
                  >
                    {label}
                  </span>
                ))}
                {showInstallButton ? (
                  <button
                    type="button"
                    className={settingsActionButtonClass}
                    disabled={!canInstall}
                    onClick={() => {
                      void installAutocompleteLSP(capability);
                    }}
                  >
                    {lspInstalling ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                    {lspInstalling ? "Installing" : "Install LSP"}
                  </button>
                ) : null}
              </div>

              {showInstallMetadata ? (
                <div className="min-w-0 space-y-1 rounded-[14px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_72%,transparent)] px-3 py-2 lg:col-span-2">
                  {capability.lspInstallCommand ? (
                    <div className="break-all font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                      {capability.lspInstallCommand}
                    </div>
                  ) : null}
                  {installDependencies.length > 0 ? (
                    <div className="text-[11px] leading-5 text-[var(--text-muted)]">
                      Requires {installDependencies.join(", ")}
                    </div>
                  ) : null}
                  {installUnavailableReason ? (
                    <div className="text-[11px] leading-5 text-[var(--text-muted)]">
                      {installUnavailableReason}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {(installDetail || lspError) && (
                <div className="min-w-0 space-y-1 lg:col-span-2">
                  {installDetail ? (
                    <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-muted)]">
                      {installDetail}
                    </div>
                  ) : null}
                  {lspError ? (
                    <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--status-error)]">
                      {lspError}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}

        {filteredAutocompleteCapabilities.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-[var(--text-muted)]">
            No autocomplete capabilities match this filter.
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderAISettings = () => {
    const predictionSettings = predictionStatus?.settings ?? null;
    const predictionEnabled = Boolean(predictionSettings?.enabled);
    const predictionMode =
      predictionSettings?.mode && predictionSettings.mode !== "off"
        ? predictionSettings.mode
        : "subtle";
    const providerLabel =
      predictionStatus?.provider?.providerId ||
      predictionStatus?.providerId ||
      "Active provider";
    const modelLabel = predictionStatus?.model || "default model";
    const budget = predictionStatus?.budget;
    const selectedProviderDescriptor =
      aiProviders.find(
        (provider) => provider.id === predictionStatus?.providerId,
      ) ?? null;
    const providerClass = describeProviderClass(
      selectedProviderDescriptor ?? predictionStatus?.provider ?? null,
    );
    const predictionBadge = predictionLoading
      ? "Loading"
      : predictionStatus?.enabled
        ? "Ready"
        : predictionEnabled
          ? "Blocked"
          : "Off";

    return (
      <div className="mx-auto max-w-3xl space-y-7">
        <SettingHeader
          title="AI"
          description="Configure AI Chat input behavior and local provider launch defaults."
        />

        <div
          data-setting-id="ai-chat-send"
          className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
            "ai-chat-send",
          )}`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Send messages
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                Choose how the AI Chat composer sends messages. Tab and
                Shift+Tab cycle Ask, Plan, Build, and Debug.
              </div>
            </div>
            <div
              role="group"
              aria-label="AI Chat send shortcut"
              className="shell-cluster-soft inline-flex min-h-[42px] items-center gap-1 px-1.5 py-1"
            >
              {aiChatSendShortcutOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={aiChatSendShortcut === option.value}
                  title={option.description}
                  onClick={() => setAIChatSendShortcut(option.value)}
                  className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors ${
                    aiChatSendShortcut === option.value
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

        <div
          data-setting-id="ai-chat-surface"
          className={`${settingsPanelClass} overflow-hidden transition-shadow ${getSettingTargetClass(
            "ai-chat-surface",
          )}`}
        >
          {aiChatDisplayPreferenceRows.map((row) => (
            <SwitchRow
              key={row.key}
              title={row.title}
              description={row.description}
              checked={aiChatPreferences.displayPrefs[row.key]}
              onCheckedChange={(checked) =>
                setAIChatDisplayPref(row.key, checked)
              }
              controlLabel={row.title}
            />
          ))}
          {aiChatWorkflowPreferenceRows.map((row) => (
            <SwitchRow
              key={row.key}
              settingId="ai-chat-workflow"
              title={row.title}
              description={row.description}
              checked={aiChatPreferences.workflowPrefs[row.key]}
              onCheckedChange={(checked) =>
                setAIChatWorkflowPref(row.key, checked)
              }
              controlLabel={row.title}
              highlighted={highlightedSettingId === "ai-chat-workflow"}
            />
          ))}
          <div className="space-y-3 px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Default context
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                These defaults seed AI Chat context and can be adjusted from AI
                Chat settings.
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {aiChatContextPreferenceRows.map((row) => {
                const Icon = row.icon;
                const active = aiChatPreferences.defaultContext[row.key];
                return (
                  <button
                    key={row.key}
                    type="button"
                    aria-pressed={active}
                    title={row.description}
                    onClick={() => setAIChatDefaultContext(row.key, !active)}
                    className={`flex min-h-[52px] items-center gap-3 rounded-[14px] border px-3 text-left transition-colors ${
                      active
                        ? "border-[color-mix(in_srgb,var(--focus-ring)_42%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--focus-ring)_10%,var(--surface-1))] text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-overlay)]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {row.title}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        {active ? "Included by default" : "Off by default"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          data-setting-id="ai-predictions"
          className={`${settingsPanelClass} overflow-hidden transition-shadow ${getSettingTargetClass(
            "ai-predictions",
          )}`}
        >
          <SwitchRow
            title="AI predictions"
            description="Passive editor ghost text uses the active provider only after this switch is enabled."
            checked={predictionEnabled}
            onCheckedChange={(enabled) => {
              void savePredictionSettingsUpdate({
                enabled,
                mode: enabled ? predictionMode : "off",
              });
            }}
            badge={predictionBadge}
            controlLabel="Toggle AI predictions"
            highlighted={highlightedSettingId === "ai-predictions"}
          />
          <div className="space-y-4 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Provider
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm text-[var(--text-primary)]">
                    {providerLabel} · {modelLabel}
                  </span>
                  <span
                    className={`${settingsPillClass} min-h-[24px] px-2 ${providerClassTone(
                      providerClass.tone,
                    )}`}
                  >
                    {providerClass.label}
                  </span>
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                  {providerClass.detail}
                </div>
                {predictionStatus?.providerReason ? (
                  <div className="mt-1 text-[12px] leading-5 text-[var(--status-warning)]">
                    {predictionStatus.providerReason}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void refreshPredictionStatus()}
                disabled={predictionLoading || predictionSaving}
                className={settingsActionButtonClass}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>

            <div
              role="group"
              aria-label="AI prediction mode"
              className="shell-cluster-soft inline-flex min-h-[42px] items-center gap-1 px-1.5 py-1"
            >
              {aiPredictionModeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={
                    predictionEnabled && predictionMode === option.value
                  }
                  title={option.description}
                  disabled={!predictionSettings || predictionSaving}
                  onClick={() =>
                    void savePredictionSettingsUpdate({
                      enabled: true,
                      mode: option.value,
                      idleMs: option.value === "eager" ? 450 : 600,
                    })
                  }
                  className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    predictionEnabled && predictionMode === option.value
                      ? "border-[var(--border-default)] bg-[var(--surface-active)] text-[var(--text-primary)]"
                      : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 text-[12px] sm:grid-cols-3">
              {[
                [
                  "Requests/min",
                  `${budget?.requestsThisMinute ?? 0} / ${
                    predictionSettings?.budget.requestsPerMinute ?? 0
                  }`,
                ],
                [
                  "Tokens/min",
                  `${budget?.tokensThisMinute ?? 0} / ${
                    predictionSettings?.budget.tokensPerMinute ?? 0
                  }`,
                ],
                [
                  "Tokens/day",
                  `${budget?.tokensToday ?? 0} / ${
                    predictionSettings?.budget.tokensPerDay ?? 0
                  }`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[12px] border border-[var(--border-subtle)] px-3 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {label}
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-[var(--text-primary)]">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {predictionError ||
            budget?.blockedReason ||
            budget?.cooldownReason ? (
              <div className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-warning)_40%,var(--border-subtle))] px-3 py-2 text-[12px] leading-5 text-[var(--status-warning)]">
                {predictionError ||
                  budget?.blockedReason ||
                  budget?.cooldownReason}
              </div>
            ) : null}

            <div className={settingsInsetClass}>
              <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    Background activity
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                    Only passive editor prediction egress is shown here.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshPredictionActivity()}
                  disabled={predictionActivityLoading}
                  className={settingsActionButtonClass}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      predictionActivityLoading ? "animate-spin" : ""
                    }`}
                  />
                  Activity
                </button>
              </div>
              {predictionActivityError ? (
                <div className="px-3 py-3 text-[12px] leading-5 text-[var(--status-error)]">
                  {predictionActivityError}
                </div>
              ) : predictionEgressRecords.length > 0 ? (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {predictionEgressRecords.map((record) => {
                    const reason =
                      record.budgetReason ||
                      record.errorClass ||
                      (record.canceled ? "canceled" : "");
                    return (
                      <div key={record.id} className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-[var(--text-muted)]">
                            {formatPredictionEgressTime(record.createdAt)}
                          </span>
                          <span className={settingsPillClass}>
                            {record.status || "recorded"}
                          </span>
                          {record.budgetDecision ? (
                            <span className={settingsPillClass}>
                              budget: {record.budgetDecision}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate text-[12px] text-[var(--text-primary)]">
                          {record.providerId || "provider"} ·{" "}
                          {record.model || "model"} ·{" "}
                          {formatPredictionEgressTokens(record)}
                        </div>
                        {reason ? (
                          <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                            {reason}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-3 py-5 text-center text-[12px] text-[var(--text-muted)]">
                  No background prediction egress has been recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          data-setting-id="ai-remote-byok"
          className={`${settingsPanelClass} overflow-hidden transition-shadow ${getSettingTargetClass(
            "ai-remote-byok",
          )}`}
        >
          <div className="border-b border-[var(--border-subtle)] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <KeyRound size={15} className="text-[var(--text-muted)]" />
                  Remote API key setup
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                  Connect an OpenAI-compatible endpoint with a write-only API
                  key. The provider is saved disabled, tested, then enabled for
                  prediction only after disclosure is accepted.
                </div>
              </div>
              <span className={settingsPillClass}>
                {aiProviderLoading
                  ? "Refreshing"
                  : `${aiProviders.length} providers`}
              </span>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
              <label className="min-w-0">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Provider ID
                </div>
                <input
                  value={remoteBYOKSetup.providerId}
                  disabled={remoteBYOKBusy}
                  onChange={(event) =>
                    setRemoteBYOKSetup((current) => ({
                      ...current,
                      providerId: event.currentTarget.value,
                    }))
                  }
                  className={`${settingsInputClass} w-full font-mono`}
                  placeholder={defaultRemoteBYOKProviderID}
                />
              </label>
              <label className="min-w-0">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Endpoint
                </div>
                <input
                  value={remoteBYOKSetup.endpoint}
                  disabled={remoteBYOKBusy}
                  onChange={(event) =>
                    setRemoteBYOKSetup((current) => ({
                      ...current,
                      endpoint: event.currentTarget.value,
                    }))
                  }
                  className={`${settingsInputClass} w-full font-mono`}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="min-w-0">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Model
                </div>
                <input
                  value={remoteBYOKSetup.model}
                  disabled={remoteBYOKBusy}
                  onChange={(event) =>
                    setRemoteBYOKSetup((current) => ({
                      ...current,
                      model: event.currentTarget.value,
                    }))
                  }
                  className={`${settingsInputClass} w-full font-mono`}
                  placeholder="optional; discovered from /models when possible"
                />
              </label>
              <label className="min-w-0">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  API key
                </div>
                <input
                  type="password"
                  autoComplete="off"
                  value={remoteBYOKSetup.apiKey}
                  disabled={remoteBYOKBusy}
                  onChange={(event) =>
                    setRemoteBYOKSetup((current) => ({
                      ...current,
                      apiKey: event.currentTarget.value,
                    }))
                  }
                  className={`${settingsInputClass} w-full font-mono`}
                  placeholder="Stored in the local credential vault"
                />
              </label>
            </div>

            <label className="flex items-start gap-3 rounded-[16px] border border-[var(--border-subtle)] px-3 py-3">
              <input
                type="checkbox"
                checked={remoteBYOKSetup.consentAccepted}
                disabled={remoteBYOKBusy}
                onChange={(event) =>
                  setRemoteBYOKSetup((current) => ({
                    ...current,
                    consentAccepted: event.currentTarget.checked,
                  }))
                }
                className="mt-0.5 h-4 w-4 accent-[var(--accent-brand)]"
              />
              <span className="min-w-0 text-[12px] leading-5 text-[var(--text-muted)]">
                I understand passive predictions may send current editor context
                to this endpoint under the provider's own processing, retention,
                abuse-monitoring, and billing terms.
              </span>
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2 text-[12px] leading-5">
                <Shield
                  size={14}
                  className={
                    remoteBYOKSetup.statusTone === "error"
                      ? "text-[var(--status-error)]"
                      : remoteBYOKSetup.statusTone === "success"
                        ? "text-[var(--status-success)]"
                        : "text-[var(--text-muted)]"
                  }
                />
                <span
                  className={
                    remoteBYOKSetup.statusTone === "error"
                      ? "text-[var(--status-error)]"
                      : remoteBYOKSetup.statusTone === "success"
                        ? "text-[var(--status-success)]"
                        : "text-[var(--text-muted)]"
                  }
                >
                  {remoteBYOKSetup.statusMessage ||
                    "Endpoint validation and provider test run before predictions are enabled."}
                </span>
              </div>
              <button
                type="button"
                className={settingsActionButtonClass}
                disabled={remoteBYOKBusy}
                onClick={() => void connectRemoteBYOKForPrediction()}
              >
                {remoteBYOKBusy ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                Connect for predictions
              </button>
            </div>
          </div>
        </div>

        <div
          data-setting-id="ai-provider-launch"
          className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
            "ai-provider-launch",
          )}`}
        >
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Provider launch
          </div>
          <div className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
            Local provider servers are launched from the AI Chat provider popup
            using loopback endpoints only. Cloud providers use your configured
            API key before model discovery.
          </div>
        </div>
      </div>
    );
  };

  const renderMCPSettings = () => {
    const settings = mcpStatus?.settings ?? null;
    const enabledToolCount =
      mcpStatus?.tools.filter((tool) => tool.enabled).length ?? 0;
    const totalToolCount = mcpStatus?.tools.length ?? 0;

    return (
      <div className="mx-auto max-w-3xl space-y-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <SettingHeader
            title="MCP"
            description="Control the Arlecchino MCP server, approval prompts, and exposed tool surface."
          />
          <button
            type="button"
            className={settingsActionButtonClass}
            disabled={mcpLoading}
            onClick={() => {
              void refreshMCPSettings();
            }}
          >
            <RefreshCw size={14} className={mcpLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {mcpError ? (
          <div className="flex items-center gap-2 rounded-[16px] border border-[color-mix(in_srgb,var(--status-error)_55%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--status-error)]">
            <AlertCircle size={14} />
            {mcpError}
          </div>
        ) : null}

        <div className={settingsPanelClass}>
          <SwitchRow
            title="Arlecchino MCP server"
            description="Disable to expose no MCP tools and reject MCP tool calls from external agents."
            checked={settings?.enabled ?? false}
            onCheckedChange={(checked) =>
              updateMCPSettings({ enabled: checked })
            }
            badge={
              settings
                ? settings.enabled
                  ? "Enabled"
                  : "Disabled"
                : "Not loaded"
            }
            settingId="mcp-enabled"
            highlighted={highlightedSettingId === "mcp-enabled"}
          />
          <div className="grid gap-2 px-4 py-4 text-[12px] text-[var(--text-secondary)] sm:grid-cols-2">
            {[
              [
                "Bridge",
                mcpStatus?.bridgeRunning
                  ? "running"
                  : settings?.enabled
                    ? "not running"
                    : "disabled",
              ],
              [
                "Approval code",
                mcpStatus?.approvalCodeConfigured
                  ? "configured by environment"
                  : "live prompt",
              ],
              ["Settings file", mcpStatus?.diskPath || "not available"],
              [
                "Tool surface",
                `${enabledToolCount}/${totalToolCount || 0} tools enabled`,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[14px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] px-3 py-2"
              >
                <div className="text-[var(--text-muted)]">{label}</div>
                <div className="mt-1 break-words font-mono text-[11px] text-[var(--text-primary)]">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          data-setting-id="mcp-approval-policy"
          className={`${settingsPanelClass} transition-shadow ${getSettingTargetClass(
            "mcp-approval-policy",
          )}`}
        >
          <SwitchRow
            title="Require approval"
            description="Ask before protected MCP actions such as writes, terminal control, runtime UI changes, and sensitive file access."
            checked={settings?.approvalRequired ?? false}
            onCheckedChange={(checked) =>
              updateMCPSettings({ approvalRequired: checked })
            }
            badge={
              mcpStatus?.approvalRequiredEnvOverride
                ? "Env override"
                : undefined
            }
          />
          <div className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Default approval lifetime
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                Used when an MCP client does not request a shorter approval
                window.
              </div>
            </div>
            <div
              role="group"
              aria-label="Default MCP approval lifetime"
              className="shell-cluster-soft inline-flex min-h-[42px] items-center gap-1 px-1.5 py-1"
            >
              {mcpApprovalTtlOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={
                    settings?.defaultApprovalTtlSeconds === option.value
                  }
                  disabled={!settings || mcpSaving}
                  onClick={() =>
                    updateMCPSettings({
                      defaultApprovalTtlSeconds: option.value,
                    })
                  }
                  className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    settings?.defaultApprovalTtlSeconds === option.value
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

        <div
          data-setting-id="mcp-tool-access"
          className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
            "mcp-tool-access",
          )}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                MCP tool access
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                Disable individual tools without removing the Arlecchino MCP
                server from external clients.
              </div>
            </div>
            <span className={settingsPillClass}>
              {enabledToolCount}/{totalToolCount || 0}
            </span>
          </div>

          <label className="shell-cluster-soft mt-4 flex min-h-[42px] min-w-0 items-center gap-2 px-3">
            <Search size={15} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={mcpToolQuery}
              onChange={(event) => setMCPToolQuery(event.currentTarget.value)}
              placeholder="Search MCP tools"
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </label>

          <div className="mt-4 max-h-[430px] overflow-y-auto rounded-[18px] border border-[var(--border-subtle)]">
            {filteredMCPTools.map((tool) => (
              <div
                key={tool.name}
                className="grid gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                      {tool.name}
                    </span>
                    <span className={`${settingsPillClass} min-h-[24px] px-2`}>
                      {tool.group}
                    </span>
                    <span
                      className={`${settingsPillClass} min-h-[24px] px-2 ${
                        tool.effectiveEnabled
                          ? "text-[var(--status-success)]"
                          : "text-[var(--status-warning)]"
                      }`}
                    >
                      {tool.effectiveEnabled ? "Available" : "Blocked"}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                    {tool.description}
                  </div>
                </div>
                <Switch.Root
                  checked={tool.enabled}
                  disabled={!settings || mcpSaving}
                  onCheckedChange={(checked) =>
                    setMCPToolEnabled(tool, checked)
                  }
                  aria-label={`Enable ${tool.name}`}
                  className={settingsSwitchRootClass}
                >
                  <Switch.Thumb className={settingsSwitchThumbClass} />
                </Switch.Root>
              </div>
            ))}

            {filteredMCPTools.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-[var(--text-muted)]">
                No MCP tools match this filter.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderKeybindings = () => (
    <div
      className={`mx-auto flex max-w-4xl flex-col gap-6 transition-shadow ${getSettingTargetClass(
        "keybindings",
      )}`}
      data-setting-id="keybindings"
    >
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
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {isOpen ? (
            <React.Fragment key="settings-modal-motion">
              <Dialog.Overlay forceMount asChild>
                <motion.div
                  key="settings-overlay"
                  className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-[10px]"
                  initial={reduceSettingsMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceSettingsMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={
                    reduceSettingsMotion
                      ? { duration: 0 }
                      : SHELL_DIALOG_OVERLAY_TRANSITION
                  }
                />
              </Dialog.Overlay>
              <Dialog.Content
                forceMount
                asChild
                onEscapeKeyDown={(event) => {
                  if (document.body.dataset.closeConfirmationOpen === "true") {
                    event.preventDefault();
                  }
                }}
                onOpenAutoFocus={handleDialogOpenAutoFocus}
                onInteractOutside={handleDialogInteractOutside}
              >
                <motion.div
                  key="settings-content"
                  className="fixed left-1/2 top-1/2 z-[111] outline-none"
                  data-testid="settings-modal"
                  initial={reduceSettingsMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceSettingsMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={
                    reduceSettingsMotion
                      ? { duration: 0 }
                      : SHELL_DIALOG_OVERLAY_TRANSITION
                  }
                  style={{
                    transform: `translate(-50%, -50%) scale(${uiScale})`,
                    transformOrigin: "center",
                    width: `min(${94 / uiScale}vw, 1080px)`,
                    height: `min(${86 / uiScale}vh, 800px)`,
                  }}
                >
                  <motion.div
                    className="flex h-full w-full overflow-hidden rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-canvas)] shadow-[var(--shadow-overlay)]"
                    initial={
                      reduceSettingsMotion ? false : { y: 10, scale: 0.985 }
                    }
                    animate={{ y: 0, scale: 1 }}
                    exit={
                      reduceSettingsMotion
                        ? { y: 0, scale: 1 }
                        : { y: 6, scale: 0.99 }
                    }
                    transition={
                      reduceSettingsMotion
                        ? { duration: 0 }
                        : SHELL_DIALOG_PANEL_TRANSITION
                    }
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

                      <div
                        className="relative z-20 mb-3"
                        onBlur={(event) => {
                          const nextTarget = event.relatedTarget;
                          if (
                            nextTarget instanceof Node &&
                            event.currentTarget.contains(nextTarget)
                          ) {
                            return;
                          }
                          setSettingsSearchFocused(false);
                        }}
                      >
                        <label className="shell-cluster-soft flex min-h-[42px] min-w-0 items-center gap-2 px-3">
                          <Search
                            size={15}
                            className="shrink-0 text-[var(--text-muted)]"
                          />
                          <input
                            value={settingsQuery}
                            onChange={(event) =>
                              setSettingsQuery(event.currentTarget.value)
                            }
                            onFocus={() => setSettingsSearchFocused(true)}
                            aria-label="Search settings"
                            placeholder="Search settings"
                            data-testid="settings-search-input"
                            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                          />
                          {settingsQuery.trim().length > 0 ? (
                            <button
                              type="button"
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
                              aria-label="Clear settings search"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setSettingsQuery("");
                                setSettingsSearchFocused(true);
                              }}
                            >
                              <X size={13} />
                            </button>
                          ) : null}
                        </label>

                        <AnimatePresence initial={false}>
                          {showSettingsSearchSuggestions ? (
                            <motion.div
                              key="settings-search-suggestions"
                              initial={
                                reduceSettingsMotion
                                  ? false
                                  : {
                                      opacity: 0,
                                      y: -6,
                                    }
                              }
                              animate={{
                                opacity: 1,
                                y: 0,
                              }}
                              exit={
                                reduceSettingsMotion
                                  ? {
                                      opacity: 0,
                                      y: 0,
                                    }
                                  : {
                                      opacity: 0,
                                      y: -5,
                                    }
                              }
                              transition={
                                reduceSettingsMotion
                                  ? { duration: 0 }
                                  : {
                                      opacity: { duration: 0.16 },
                                      y: {
                                        duration: 0.18,
                                        ease: [0.22, 1, 0.36, 1],
                                      },
                                    }
                              }
                              className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_94%,transparent)] shadow-[var(--shadow-overlay)]"
                              data-testid="settings-search-suggestions"
                            >
                              <div className="max-h-[270px] overflow-y-auto p-1.5">
                                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                  {settingsQuery.trim()
                                    ? "Search results"
                                    : "Suggested settings"}
                                </div>
                                {settingsSearchSuggestions.map((entry) => (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    data-testid={`settings-search-suggestion-${entry.id}`}
                                    onMouseDown={(event) =>
                                      event.preventDefault()
                                    }
                                    onClick={() =>
                                      selectSettingsSearchEntry(entry)
                                    }
                                    className={`grid min-h-[54px] w-full grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[14px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] ${
                                      activeTab === entry.tab
                                        ? "bg-[color-mix(in_srgb,var(--surface-active)_80%,transparent)]"
                                        : ""
                                    }`}
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">
                                        {entry.label}
                                      </span>
                                      <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                                        {entry.description}
                                      </span>
                                    </span>
                                    <span
                                      className={`${settingsPillClass} h-6 min-h-0 px-2 text-[10px]`}
                                    >
                                      {tabLabelById.get(entry.tab)}
                                    </span>
                                  </button>
                                ))}
                                {settingsSearchSuggestions.length === 0 ? (
                                  <div className="px-3 py-7 text-center text-[12px] text-[var(--text-muted)]">
                                    No settings match this search.
                                  </div>
                                ) : null}
                              </div>
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
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
                              settingId="project-opening"
                              highlighted={
                                highlightedSettingId === "project-opening"
                              }
                            />

                            <AppIconAppearanceControl
                              value={appIconAppearance}
                              onChange={setAppIconAppearance}
                              settingId="app-icon"
                              highlighted={highlightedSettingId === "app-icon"}
                            />

                            <div
                              data-setting-id="system-font-family"
                              className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
                                "system-font-family",
                              )}`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                                    System Font Family
                                  </div>
                                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                                    Choose the font used by Arlecchino outside
                                    the code editor.
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={resetUiFontFamily}
                                  className={settingsIconButtonClass}
                                  aria-label="Reset system font family"
                                  title="Reset system font family"
                                >
                                  <RotateCcw size={14} />
                                </button>
                              </div>

                              <div className={`${settingsInsetClass} mt-4 p-3`}>
                                <DropdownMenu.Root>
                                  <DropdownMenu.Trigger asChild>
                                    <button
                                      type="button"
                                      className={settingsDropdownTriggerClass}
                                      data-testid="ui-font-family-trigger"
                                      aria-label="System font family"
                                    >
                                      <span
                                        className="min-w-0 truncate"
                                        style={{
                                          fontFamily:
                                            activeUiFontFamilyOption?.sampleFamily ??
                                            uiFontFamily,
                                        }}
                                      >
                                        {activeUiFontFamilyLabel}
                                      </span>
                                      <ChevronDown size={16} />
                                    </button>
                                  </DropdownMenu.Trigger>
                                  <DropdownMenu.Portal>
                                    <MotionDropdownContent
                                      align="start"
                                      sideOffset={8}
                                      className={`${settingsDropdownContentClass} w-[var(--radix-dropdown-menu-trigger-width)]`}
                                      data-testid="ui-font-family-content"
                                      data-shell-menu-content
                                      style={{
                                        maxHeight:
                                          "min(420px, var(--radix-dropdown-menu-content-available-height))",
                                      }}
                                    >
                                      {uiFontOptions.map((option) => {
                                        const isActive =
                                          uiFontFamily === option.value;
                                        return (
                                          <DropdownMenu.Item
                                            key={`${option.label}-${option.value}`}
                                            className={
                                              settingsDropdownItemClass
                                            }
                                            onSelect={() =>
                                              setUiFontFamily(option.value)
                                            }
                                          >
                                            <span
                                              className="min-w-0 flex-1 truncate"
                                              style={{
                                                fontFamily: option.sampleFamily,
                                              }}
                                            >
                                              {option.label}
                                            </span>
                                            {isActive ? (
                                              <Check size={15} />
                                            ) : null}
                                          </DropdownMenu.Item>
                                        );
                                      })}
                                    </MotionDropdownContent>
                                  </DropdownMenu.Portal>
                                </DropdownMenu.Root>

                                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="text-[12px] text-[var(--text-muted)]">
                                    Local fonts appear when the system grants
                                    font access.
                                  </div>
                                  <button
                                    type="button"
                                    className={settingsActionButtonClass}
                                    onClick={() => {
                                      customFontTargetRef.current = "ui";
                                      customFontInputRef.current?.click();
                                    }}
                                  >
                                    <Plus size={14} />
                                    Add font
                                  </button>
                                </div>
                                <input
                                  ref={customFontInputRef}
                                  type="file"
                                  accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                                  className="hidden"
                                  onChange={handleCustomFontFile}
                                />
                                {customFontStatus && (
                                  <div
                                    className={`mt-3 rounded-[14px] border px-3 py-2 text-[12px] ${
                                      customFontStatus.tone === "success"
                                        ? "border-[color-mix(in_srgb,var(--status-success)_35%,transparent)] text-[var(--status-success)]"
                                        : "border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] text-[var(--status-error)]"
                                    }`}
                                  >
                                    {customFontStatus.message}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div
                              data-setting-id="system-font-size"
                              className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
                                "system-font-size",
                              )}`}
                            >
                              <label className="block">
                                <div className="flex items-center justify-between gap-4">
                                  <div>
                                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                                      System Font Size
                                    </div>
                                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                                      Adjust UI text size everywhere outside the
                                      code editor.
                                    </div>
                                  </div>
                                  <span className="font-mono text-sm text-[var(--text-primary)]">
                                    {uiFontSize}px
                                  </span>
                                </div>
                                <div
                                  className={`${settingsInsetClass} mt-4 px-4 py-3`}
                                >
                                  <input
                                    type="range"
                                    min={MIN_UI_FONT_SIZE}
                                    max={MAX_UI_FONT_SIZE}
                                    value={uiFontSize}
                                    onChange={(event) =>
                                      setUiFontSize(Number(event.target.value))
                                    }
                                    className="w-full"
                                    aria-label="System font size"
                                    data-testid="ui-font-size-input"
                                  />
                                </div>
                              </label>
                              <button
                                type="button"
                                onClick={resetUiFontSize}
                                className={`${settingsActionButtonClass} mt-4`}
                                disabled={uiFontSize === DEFAULT_UI_FONT_SIZE}
                              >
                                <RotateCcw size={14} />
                                Reset System Text Size
                              </button>
                            </div>

                            <div
                              data-setting-id="theme"
                              className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
                                "theme",
                              )}`}
                            >
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
                                  <MotionDropdownContent
                                    align="start"
                                    sideOffset={8}
                                    className={settingsDropdownContentClass}
                                    data-testid="theme-dropdown-content"
                                    data-shell-menu-content
                                    onPointerLeave={clearThemePreview}
                                    style={{
                                      width:
                                        "var(--radix-dropdown-menu-trigger-width)",
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
                                        onPointerEnter={() =>
                                          previewTheme(option.value)
                                        }
                                        onFocus={() =>
                                          previewTheme(option.value)
                                        }
                                        onSelect={() =>
                                          handleThemeSelect(option.value)
                                        }
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
                                          onFocus={() =>
                                            previewTheme(option.value)
                                          }
                                          onSelect={() =>
                                            handleThemeSelect(option.value)
                                          }
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
                                  </MotionDropdownContent>
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
                                  onClick={() =>
                                    customThemeInputRef.current?.click()
                                  }
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
                                badge="Beta"
                                settingId="zen-mode"
                                highlighted={
                                  highlightedSettingId === "zen-mode"
                                }
                              />
                              <SwitchRow
                                title="Compact topbar actions"
                                description="Hide the project label and show panel and update actions directly in the topbar."
                                checked={!showTopbarProjectPath}
                                onCheckedChange={(checked) =>
                                  setShowTopbarProjectPath(!checked)
                                }
                                settingId="compact-topbar-actions"
                                highlighted={
                                  highlightedSettingId ===
                                  "compact-topbar-actions"
                                }
                              />
                              <SwitchRow
                                title="Close confirmation"
                                description="Ask before closing a project or quitting Arlecchino."
                                checked={confirmBeforeClose}
                                onCheckedChange={setConfirmBeforeClose}
                                settingId="close-confirmation"
                                highlighted={
                                  highlightedSettingId === "close-confirmation"
                                }
                              />
                              <div
                                data-setting-id="topbar-icon-order"
                                className={`flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 transition-shadow last:border-0 sm:flex-row sm:items-center sm:justify-between ${getSettingTargetClass(
                                  "topbar-icon-order",
                                )}`}
                              >
                                <div className="pr-4">
                                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                                    Topbar icon order
                                  </div>
                                  <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                                    Restore the default order for draggable
                                    topbar controls.
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={resetTopbarItemOrder}
                                  className={settingsActionButtonClass}
                                >
                                  <RotateCcw size={14} />
                                  Reset order
                                </button>
                              </div>
                              <SwitchRow
                                title="Rainbow brackets"
                                description="Color nested brackets with fixed depth colors. Turn off to use the current theme's bracket styling."
                                checked={showRainbowBrackets}
                                onCheckedChange={setShowRainbowBrackets}
                                settingId="rainbow-brackets"
                                highlighted={
                                  highlightedSettingId === "rainbow-brackets"
                                }
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
                              <div
                                data-setting-id="editor-font-family"
                                className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
                                  "editor-font-family",
                                )}`}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                                      Editor Font Family
                                    </div>
                                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                                      Choose the font used by the code editor.
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={resetEditorFontFamily}
                                    className={settingsIconButtonClass}
                                    aria-label="Reset editor font family"
                                    title="Reset editor font family"
                                  >
                                    <RotateCcw size={14} />
                                  </button>
                                </div>
                                <div
                                  className={`${settingsInsetClass} mt-4 p-3`}
                                >
                                  <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                      <button
                                        type="button"
                                        className={settingsDropdownTriggerClass}
                                        data-testid="editor-font-family-trigger"
                                        aria-label="Editor font family"
                                      >
                                        <span
                                          className="min-w-0 truncate font-mono"
                                          style={{
                                            fontFamily:
                                              activeEditorFontFamilyOption?.value ??
                                              editorFontFamily,
                                          }}
                                        >
                                          {activeEditorFontFamilyLabel}
                                        </span>
                                        <ChevronDown size={16} />
                                      </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                      <MotionDropdownContent
                                        align="start"
                                        sideOffset={8}
                                        className={`${settingsDropdownContentClass} w-[var(--radix-dropdown-menu-trigger-width)]`}
                                        data-testid="editor-font-family-content"
                                        data-shell-menu-content
                                        style={{
                                          maxHeight:
                                            "min(420px, var(--radix-dropdown-menu-content-available-height))",
                                        }}
                                      >
                                        {editorFontOptions.map((preset) => {
                                          const isActive =
                                            editorFontFamily === preset.value;
                                          return (
                                            <DropdownMenu.Item
                                              key={`${preset.label}-${preset.value}`}
                                              className={
                                                settingsDropdownItemClass
                                              }
                                              onSelect={() =>
                                                setEditorFontFamily(
                                                  preset.value,
                                                )
                                              }
                                            >
                                              <span
                                                className="min-w-0 flex-1 truncate font-mono"
                                                style={{
                                                  fontFamily:
                                                    preset.sampleFamily,
                                                }}
                                              >
                                                {preset.label}
                                              </span>
                                              {isActive ? (
                                                <Check size={15} />
                                              ) : null}
                                            </DropdownMenu.Item>
                                          );
                                        })}
                                      </MotionDropdownContent>
                                    </DropdownMenu.Portal>
                                  </DropdownMenu.Root>
                                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="text-[12px] text-[var(--text-muted)]">
                                      Local fonts appear when the system grants
                                      font access.
                                    </div>
                                    <button
                                      type="button"
                                      className={settingsActionButtonClass}
                                      onClick={() => {
                                        customFontTargetRef.current = "editor";
                                        customFontInputRef.current?.click();
                                      }}
                                    >
                                      <Plus size={14} />
                                      Add font
                                    </button>
                                  </div>
                                  <input
                                    ref={customFontInputRef}
                                    type="file"
                                    accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                                    className="hidden"
                                    onChange={handleCustomFontFile}
                                  />
                                  {customFontStatus && (
                                    <div
                                      className={`mt-3 rounded-[14px] border px-3 py-2 text-[12px] ${
                                        customFontStatus.tone === "success"
                                          ? "border-[color-mix(in_srgb,var(--status-success)_35%,transparent)] text-[var(--status-success)]"
                                          : "border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] text-[var(--status-error)]"
                                      }`}
                                    >
                                      {customFontStatus.message}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <label
                                data-setting-id="editor-font-size"
                                className={`${settingsPanelClass} block p-4 transition-shadow ${getSettingTargetClass(
                                  "editor-font-size",
                                )}`}
                              >
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
                                <div
                                  className={`${settingsInsetClass} mt-4 px-4 py-3`}
                                >
                                  <input
                                    type="range"
                                    min={minFontSize}
                                    max={maxFontSize}
                                    value={editorFontSize}
                                    onChange={(event) =>
                                      setEditorFontSize(
                                        Number(event.target.value),
                                      )
                                    }
                                    className="w-full"
                                  />
                                </div>
                              </label>

                              <div
                                data-setting-id="ui-scale"
                                className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
                                  "ui-scale",
                                )}`}
                              >
                                <label className="block">
                                  <div className="flex items-center justify-between gap-4">
                                    <div>
                                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                                        UI Scale
                                      </div>
                                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                                        Adjust the overall zoom of the
                                        application interface.
                                      </div>
                                    </div>
                                    <span className="font-mono text-sm text-[var(--text-primary)]">
                                      {Math.round(uiScale * 100)}%
                                    </span>
                                  </div>
                                  <div
                                    className={`${settingsInsetClass} mt-4 px-4 py-3`}
                                  >
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

                              <div className={settingsPanelClass}>
                                <SwitchRow
                                  title="Operator ligatures"
                                  description="Render sequences like ->, <-, and => as visual arrows without changing file text."
                                  checked={showOperatorLigatures}
                                  onCheckedChange={setShowOperatorLigatures}
                                  settingId="operator-ligatures"
                                  highlighted={
                                    highlightedSettingId ===
                                    "operator-ligatures"
                                  }
                                />
                                <SwitchRow
                                  title="Indent guides"
                                  description="Show indentation markers in normal editor mode for nested code."
                                  checked={showIndentGuides}
                                  onCheckedChange={setShowIndentGuides}
                                  settingId="indent-guides"
                                  highlighted={
                                    highlightedSettingId === "indent-guides"
                                  }
                                />
                                <SwitchRow
                                  title="Color tools"
                                  description="Show color swatches in CSS, Sass, Less, and theme files."
                                  checked={showColorTools}
                                  onCheckedChange={setShowColorTools}
                                  settingId="color-tools"
                                  highlighted={
                                    highlightedSettingId === "color-tools"
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {activeTab === "ai" && renderAISettings()}

                        {activeTab === "diagnostics" && (
                          <div className="mx-auto max-w-3xl space-y-7">
                            <SettingHeader
                              title="Diagnostics"
                              description="Configure how errors and warnings are displayed."
                            />

                            <div className={settingsPanelClass}>
                              <SwitchRow
                                title="Fold gutter"
                                description="Show code folding controls when the editor is in a stable layout budget."
                                checked={showFoldGutter}
                                onCheckedChange={setShowFoldGutter}
                                settingId="fold-gutter"
                                highlighted={
                                  highlightedSettingId === "fold-gutter"
                                }
                              />
                              <SwitchRow
                                title="Show minimap"
                                description="Display the code minimap in the editor gutter for supported file sizes."
                                checked={showMinimap}
                                onCheckedChange={setShowMinimap}
                                settingId="show-minimap"
                                highlighted={
                                  highlightedSettingId === "show-minimap"
                                }
                              />
                              <SwitchRow
                                title="Show compact diagnostics"
                                description="Keep the project-wide problems badge visible in the status bar."
                                checked={showCompactDiagnostics}
                                onCheckedChange={setShowCompactDiagnostics}
                                settingId="compact-diagnostics"
                                highlighted={
                                  highlightedSettingId === "compact-diagnostics"
                                }
                              />
                            </div>

                            {renderAutocompleteSupport()}

                            <div
                              data-setting-id="build-identity"
                              className={`${settingsPanelClass} p-4 transition-shadow ${getSettingTargetClass(
                                "build-identity",
                              )}`}
                            >
                              <div className="text-sm font-semibold text-[var(--text-primary)]">
                                Build identity
                              </div>
                              <div className="mt-3 grid gap-2 text-[12px] text-[var(--text-secondary)]">
                                {[
                                  ["Mode", buildInfo.mode ?? "dev"],
                                  ["Version", buildInfo.version ?? "unknown"],
                                  ["Build", buildInfo.build ?? "unknown"],
                                  ["Commit", buildInfo.gitSha ?? "unknown"],
                                  ["Channel", buildInfo.channel ?? "beta"],
                                  [
                                    "Package",
                                    buildInfo.packaged
                                      ? "packaged"
                                      : "development",
                                  ],
                                  [
                                    "Bundle",
                                    buildInfo.bundlePath ??
                                      "not running from .app",
                                  ],
                                  [
                                    "Update manifest",
                                    buildInfo.updateManifestUrl ??
                                      "not configured",
                                  ],
                                  [
                                    "Private update access",
                                    privateUpdateAccessLabel,
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
                              <div
                                data-setting-id="private-release-access"
                                className={`mt-4 rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] p-3 transition-shadow ${getSettingTargetClass(
                                  "private-release-access",
                                )}`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
                                      <KeyRound size={14} />
                                      Private GitHub release access
                                    </div>
                                    <div className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
                                      Token is stored in macOS Keychain and is
                                      never shown after saving.
                                    </div>
                                  </div>
                                  <span
                                    className={`${settingsPillClass} ${
                                      privateUpdateAuthStatus?.configured
                                        ? "text-[var(--status-success)]"
                                        : "text-[var(--status-warning)]"
                                    }`}
                                  >
                                    {privateUpdateAuthStatus?.configured
                                      ? "Configured"
                                      : "Missing token"}
                                  </span>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                                  <input
                                    type="password"
                                    autoComplete="off"
                                    value={privateUpdateToken}
                                    onChange={(event) =>
                                      setPrivateUpdateToken(
                                        event.currentTarget.value,
                                      )
                                    }
                                    placeholder="Fine-grained GitHub token"
                                    className="h-9 min-w-0 rounded-[16px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)] px-3 font-mono text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-default)] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
                                  />
                                  <button
                                    type="button"
                                    className={settingsActionButtonClass}
                                    disabled={
                                      privateUpdateAuthBusy ||
                                      !privateUpdateToken.trim()
                                    }
                                    onClick={() => {
                                      void savePrivateUpdateAccessToken();
                                    }}
                                  >
                                    <Check size={14} />
                                    Save Token
                                  </button>
                                  <button
                                    type="button"
                                    className={settingsActionButtonClass}
                                    disabled={privateUpdateAuthBusy}
                                    onClick={() => {
                                      void clearPrivateUpdateAccessToken();
                                    }}
                                  >
                                    <Trash2 size={14} />
                                    Clear
                                  </button>
                                </div>
                                <div className="mt-2 break-words text-[11px] leading-5 text-[var(--text-muted)]">
                                  {privateUpdateAuthStatus?.reason ??
                                    "Open this tab to load private update access status."}
                                </div>
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

                        {activeTab === "mcp" && renderMCPSettings()}

                        {activeTab === "browser-preview" && (
                          <div className="mx-auto max-w-3xl space-y-7">
                            <SettingHeader
                              title="Browser Preview"
                              description="Manage integrated browser preview behavior."
                            />

                            <div className={settingsPanelClass}>
                              <div
                                data-setting-id="markdown-links"
                                className={`grid gap-4 border-b border-[var(--border-subtle)] px-4 py-4 transition-shadow lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${getSettingTargetClass(
                                  "markdown-links",
                                )}`}
                              >
                                <div className="min-w-0 pr-4">
                                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                                    Markdown links
                                  </div>
                                  <div className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                                    Choose whether Markdown preview links open
                                    directly in the system browser or first
                                    inside Browser Preview.
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
                                      aria-pressed={
                                        markdownLinkOpenMode === option.value
                                      }
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
                                settingId="auto-open-preview"
                                highlighted={
                                  highlightedSettingId === "auto-open-preview"
                                }
                              />
                              <SwitchRow
                                title="Reuse Session Window"
                                description="Keep one preview window per terminal session instead of spawning new ones."
                                checked={reuseWindowPerSession}
                                onCheckedChange={setReuseWindowPerSession}
                                settingId="reuse-session-window"
                                highlighted={
                                  highlightedSettingId ===
                                  "reuse-session-window"
                                }
                              />
                              <SwitchRow
                                title="Close on Session Exit"
                                description="Close auto-opened preview windows when the terminal session ends."
                                checked={closeAutoOpenedOnTerminalExit}
                                onCheckedChange={
                                  setCloseAutoOpenedOnTerminalExit
                                }
                                settingId="close-on-session-exit"
                                highlighted={
                                  highlightedSettingId ===
                                  "close-on-session-exit"
                                }
                              />
                            </div>
                          </div>
                        )}

                        {activeTab === "keybindings" && renderKeybindings()}
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              </Dialog.Content>
            </React.Fragment>
          ) : null}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
