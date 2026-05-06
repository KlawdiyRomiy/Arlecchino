import React, { useState } from "react";
import {
  Bot,
  Bug,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  GitBranch,
  Hammer,
  History,
  ListChecks,
  MessageSquare,
  Paperclip,
  Play,
  Plus,
  Send,
  Settings,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";

import { writeClipboardTextWithFallback } from "../utils/clipboard";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";

interface AIChatPanelProps {
  onClearChat?: () => void;
}

type ChatMode = "plan" | "build" | "debug";
type SidebarKind = "history" | "branch" | null;

interface ProviderAccount {
  id: string;
  displayName: string;
  status: "connected" | "available" | "needs-key" | "disconnected";
  detail: string;
  modelIds: string[];
}

interface ChatFileRef {
  path: string;
  label: string;
  detail?: string;
  additions?: number;
  deletions?: number;
}

interface ChatAction {
  id: string;
  label: string;
  kind: "primary" | "secondary";
}

interface ChatMessage {
  id: string;
  bubbleKind: ChatMode;
  content: string;
  createdAt: string;
  fileRefs?: ChatFileRef[];
  codeFrame?: string;
  actions?: ChatAction[];
}

interface ChatHistoryItem {
  id: string;
  title: string;
  summary: string;
  time: string;
  mode: ChatMode;
}

interface DiffFile {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
}

const providerAccounts: ProviderAccount[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    status: "connected",
    detail: "OAuth session",
    modelIds: ["GPT-5.2", "reasoning-fast"],
  },
  {
    id: "anthropic-api",
    displayName: "Anthropic",
    status: "needs-key",
    detail: "API key only",
    modelIds: ["Claude Sonnet", "Claude Haiku"],
  },
  {
    id: "gemini",
    displayName: "Gemini",
    status: "disconnected",
    detail: "OAuth or API key",
    modelIds: ["Gemini Pro"],
  },
  {
    id: "local-runtimes",
    displayName: "Local runtimes",
    status: "available",
    detail: "llama.cpp, LM Studio, MLX, Ollama",
    modelIds: ["local-coder"],
  },
  {
    id: "custom-endpoint",
    displayName: "Custom endpoint",
    status: "needs-key",
    detail: "OpenAI-compatible URL",
    modelIds: ["custom"],
  },
];

const fixtureMessages: ChatMessage[] = [
  {
    id: "msg-plan",
    bubbleKind: "plan",
    content:
      "We need a persistent store for metrics with TTL support and efficient queries.",
    createdAt: "2026-05-05T16:58:00.000Z",
    fileRefs: [
      {
        path: "internal/stores/metric_store.go",
        label: "internal/stores/metric_store.go",
        detail: "L10-26",
      },
    ],
    actions: [
      { id: "refine-plan", label: "Refine plan", kind: "secondary" },
      { id: "show-diff-plan", label: "Show diff", kind: "secondary" },
      { id: "apply-plan", label: "Apply plan", kind: "primary" },
    ],
  },
  {
    id: "msg-build",
    bubbleKind: "build",
    content:
      "I will add a MetricStore interface, a sync.RWMutex protected implementation, and wire it into the services.",
    createdAt: "2026-05-05T16:58:00.000Z",
    fileRefs: [
      {
        path: "internal/stores/metric_store.go",
        label: "internal/stores/metric_store.go",
        additions: 42,
        deletions: 6,
      },
      {
        path: "internal/services/pipeline_service.go",
        label: "internal/services/pipeline_service.go",
        additions: 18,
        deletions: 2,
      },
    ],
    actions: [
      { id: "review-changes", label: "Review changes", kind: "secondary" },
      { id: "run-tests", label: "Run tests", kind: "secondary" },
      { id: "commit", label: "Commit", kind: "primary" },
    ],
  },
  {
    id: "msg-debug",
    bubbleKind: "debug",
    content:
      "Add tests for concurrent access and verify TTL cleanup works as expected.",
    createdAt: "2026-05-05T16:58:00.000Z",
    fileRefs: [
      {
        path: "internal/stores/metric_store_test.go",
        label: "internal/stores/metric_store_test.go",
        detail: "L128",
      },
    ],
    codeFrame: "FAIL TestP95Calculation: expected 42.0, got 0.0",
    actions: [
      { id: "explain-failure", label: "Explain failure", kind: "secondary" },
      { id: "suggest-fix", label: "Suggest fix", kind: "secondary" },
      { id: "open-editor", label: "Open editor", kind: "primary" },
    ],
  },
];

const historyItems: ChatHistoryItem[] = [
  {
    id: "hist-metrics",
    title: "MetricStore TTL design",
    summary: "Plan, implementation notes, and tests for metrics storage.",
    time: "Today 21:58",
    mode: "build",
  },
  {
    id: "hist-branch",
    title: "Branch diff review",
    summary: "Review changed files before committing the pipeline patch.",
    time: "Today 20:44",
    mode: "plan",
  },
  {
    id: "hist-tests",
    title: "P95 test failure",
    summary: "Single data point edge case and suggested assertion fix.",
    time: "Yesterday",
    mode: "debug",
  },
];

const diffFiles: DiffFile[] = [
  {
    path: "frontend/src/components/AIChatPanel.tsx",
    status: "modified",
    additions: 554,
    deletions: 18,
  },
  {
    path: "frontend/src/styles/globals.css",
    status: "modified",
    additions: 189,
    deletions: 0,
  },
  {
    path: "internal/stores/metric_store.go",
    status: "added",
    additions: 212,
    deletions: 0,
  },
  {
    path: "internal/stores/metric_store_test.go",
    status: "modified",
    additions: 230,
    deletions: 344,
  },
];

const MODE_META: Record<
  ChatMode,
  {
    label: string;
    className: string;
    dotClassName: string;
  }
> = {
  plan: {
    label: "Plan",
    className: "arle-ai-mode-plan",
    dotClassName: "bg-[#f3c96b]",
  },
  build: {
    label: "Build",
    className: "arle-ai-mode-build",
    dotClassName: "bg-[#72d1bd]",
  },
  debug: {
    label: "Debug",
    className: "arle-ai-mode-debug",
    dotClassName: "bg-[#ff7f72]",
  },
};

const modeOrder: ChatMode[] = ["plan", "build", "debug"];
const branchDiff = { additions: 1185, deletions: 362 };

const actionIcon = (actionId: string) => {
  if (actionId.includes("test")) return Play;
  if (actionId.includes("diff") || actionId.includes("review"))
    return GitBranch;
  if (actionId.includes("fix") || actionId.includes("apply")) return Hammer;
  if (actionId.includes("failure")) return Bug;
  if (actionId.includes("editor")) return FileText;
  return ListChecks;
};

const providerStatusLabel = (status: ProviderAccount["status"]) => {
  switch (status) {
    case "connected":
      return "Connected";
    case "available":
      return "Available";
    case "needs-key":
      return "Needs key";
    default:
      return "Disconnected";
  }
};

const providerStatusDot = (status: ProviderAccount["status"]) => {
  if (status === "connected") return "bg-[var(--status-success)]";
  if (status === "available") return "bg-[#72d1bd]";
  if (status === "needs-key") return "bg-[var(--status-warning)]";
  return "bg-[var(--text-muted)]";
};

const fileRefLabel = (filePath: string) =>
  filePath.split("/").slice(-2).join("/");

const formatDiff = (value: number) => value.toLocaleString("en-US");

const ModeSegmentedControl: React.FC<{
  activeMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  compact?: boolean;
}> = ({ activeMode, onModeChange, compact = false }) => (
  <div
    className={`arle-ai-mode-selector ${
      compact ? "arle-ai-mode-selector-compact" : ""
    }`}
  >
    {modeOrder.map((mode) => {
      const active = activeMode === mode;
      return (
        <button
          key={mode}
          onClick={() => onModeChange(mode)}
          className={`arle-ai-mode-option ${
            active ? MODE_META[mode].className : ""
          }`}
        >
          {MODE_META[mode].label}
        </button>
      );
    })}
  </div>
);

const SettingsPopover: React.FC<{
  open: boolean;
  activeMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}> = ({ open, activeMode, onModeChange }) => {
  if (!open) return null;

  return (
    <div className="absolute right-0 top-12 z-30 w-[326px] rounded-[20px] border border-[rgba(215,169,82,0.34)] bg-[color-mix(in_srgb,var(--surface-overlay)_98%,transparent)] p-4 text-left shadow-[var(--shadow-overlay)] backdrop-blur-xl">
      <div className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">
        Mode
      </div>
      <ModeSegmentedControl
        activeMode={activeMode}
        onModeChange={onModeChange}
      />

      <div className="mt-4 border-t border-[var(--shell-inline-divider)] pt-4">
        <div className="mb-2 text-[14px] font-semibold text-[var(--text-primary)]">
          Context
        </div>
        {[
          { label: "Workspace", enabled: true, Icon: Sparkles },
          { label: "Current file", enabled: true, Icon: FileText },
          { label: "Terminal logs", enabled: false, Icon: Terminal },
        ].map(({ label, enabled, Icon }) => (
          <div key={label} className="flex items-center justify-between py-2">
            <span className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <Icon size={15} />
              {label}
            </span>
            <span
              className={`relative h-6 w-11 rounded-full border ${
                enabled
                  ? "border-[rgba(243,201,107,0.45)] bg-[rgba(243,201,107,0.24)]"
                  : "border-[var(--border-subtle)] bg-[var(--surface-2)]"
              }`}
            >
              <span
                className={`absolute top-[3px] h-4 w-4 rounded-full ${
                  enabled
                    ? "left-[22px] bg-[#f3c96b]"
                    : "left-[3px] bg-[var(--text-secondary)]"
                }`}
              />
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-[var(--shell-inline-divider)] pt-4">
        <div className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">
          Behavior
        </div>
        {[
          ["Autonomy", "High"],
          ["Verbosity", "Detailed"],
        ].map(([label, value]) => (
          <div key={label} className="mb-4">
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span className="text-[var(--text-secondary)]">{label}</span>
              <span className="text-[var(--text-muted)]">{value}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-[var(--shell-border-strong)]" />
              <span className="h-3.5 w-3.5 rounded-full border-2 border-[#f3c96b] bg-[var(--surface-2)]" />
              <span className="h-px w-14 bg-[var(--shell-border)]" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-[var(--shell-inline-divider)] pt-4">
        <div className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">
          Safety
        </div>
        <div className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[rgba(243,201,107,0.55)] text-[11px] text-[#17130a]">
            ✓
          </span>
          Confirm shell writes
        </div>
      </div>

      <div className="group relative mt-4 flex min-h-10 items-center justify-between rounded-[13px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.035)] px-3 text-[13px] text-[var(--text-secondary)]">
        Message bubble palette
        <ChevronDown size={14} className="-rotate-90" />
        <div className="absolute left-[calc(100%+10px)] top-0 hidden w-[212px] rounded-[14px] border border-[rgba(215,169,82,0.34)] bg-[var(--surface-overlay)] p-3 shadow-[var(--shadow-overlay)] group-hover:block">
          {modeOrder.map((mode) => (
            <div
              key={mode}
              className="flex items-center justify-between py-2 text-[13px]"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${MODE_META[mode].dotClassName}`}
                />
                {MODE_META[mode].label}{" "}
                <span className="text-[var(--text-muted)]">
                  {mode === "plan"
                    ? "(Amber)"
                    : mode === "build"
                      ? "(Teal)"
                      : "(Coral)"}
                </span>
              </span>
              {mode === activeMode && <span className="text-[#f3c96b]">✓</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ProviderMenu: React.FC<{
  open: boolean;
  providers: ProviderAccount[];
  selectedProviderId: string;
  onSelectProvider: (providerId: string) => void;
}> = ({ open, providers, selectedProviderId, onSelectProvider }) => {
  if (!open) return null;

  return (
    <div className="absolute left-0 top-12 z-30 flex items-start gap-3">
      <div className="w-[342px] overflow-hidden rounded-[18px] border border-[rgba(215,169,82,0.34)] bg-[color-mix(in_srgb,var(--surface-overlay)_98%,transparent)] text-left shadow-[var(--shadow-overlay)] backdrop-blur-xl">
        {providers.map((provider) => {
          const active = provider.id === selectedProviderId;
          return (
            <button
              key={provider.id}
              onClick={() => onSelectProvider(provider.id)}
              className={`grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[rgba(215,169,82,0.1)] px-4 py-3 text-left transition-colors last:border-b-0 ${
                active
                  ? "bg-[rgba(255,255,255,0.055)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--shell-border-strong)] bg-[var(--surface-1)] text-[12px] font-bold">
                {provider.displayName.slice(0, 2)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">
                  {provider.displayName}
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${providerStatusDot(
                      provider.status,
                    )}`}
                  />
                  {providerStatusLabel(provider.status)}
                  <span className="text-[var(--text-muted)]">•</span>
                  <span className="truncate">{provider.detail}</span>
                </span>
              </span>
              <span className="rounded-full border border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)]">
                {provider.modelIds[0]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="w-[326px] rounded-[18px] border border-[rgba(215,169,82,0.34)] bg-[color-mix(in_srgb,var(--surface-overlay)_98%,transparent)] p-4 shadow-[var(--shadow-overlay)] backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[14px] font-semibold text-[var(--text-primary)]">
            Connect to Anthropic
          </div>
          <X size={15} className="text-[var(--text-muted)]" />
        </div>
        <div className="mb-2 text-[12px] text-[var(--text-secondary)]">
          API key
        </div>
        <div className="mb-4 flex min-h-10 items-center justify-between rounded-[12px] border border-[rgba(215,169,82,0.22)] bg-[rgba(255,255,255,0.035)] px-3 font-mono text-[11px] text-[var(--text-secondary)]">
          keychain ref: anthropic
          <Eye size={14} />
        </div>
        <div className="mb-2 text-[12px] text-[var(--text-secondary)]">
          Base URL optional
        </div>
        <div className="mb-4 flex min-h-10 items-center rounded-[12px] border border-[rgba(215,169,82,0.22)] bg-[rgba(255,255,255,0.035)] px-3 font-mono text-[11px] text-[var(--text-muted)]">
          https://api.anthropic.com
        </div>
        <div className="flex items-center justify-end gap-2">
          <button className="arle-ai-action text-[var(--text-secondary)]">
            Cancel
          </button>
          <button className="arle-ai-action arle-ai-action-primary text-[#f3c96b]">
            Connect provider
          </button>
        </div>
      </div>
    </div>
  );
};

const ChatBubble: React.FC<{
  message: ChatMessage;
  onCopy: (content: string) => void;
}> = ({ message, onCopy }) => {
  const meta = MODE_META[message.bubbleKind];
  const fileRefPaths =
    message.fileRefs
      ?.map((fileRef) => fileRef.path)
      .filter((path) => path.trim().length > 0)
      .join("\n") ?? "";
  const contextItems: ContextActionMenuItem[] = [
    {
      label: "Copy Message",
      icon: <Copy size={14} />,
      onSelect: () => void onCopy(message.content),
    },
    {
      label: "Copy Code Frame",
      icon: <Copy size={14} />,
      hidden: !message.codeFrame,
      onSelect: () => void onCopy(message.codeFrame ?? ""),
    },
    {
      label: "Copy File Paths",
      icon: <FileText size={14} />,
      hidden: !fileRefPaths,
      onSelect: () => void onCopy(fileRefPaths),
    },
  ];

  return (
    <ContextActionMenu
      items={contextItems}
      nativeScope="ai-message"
      nativeTargetId={message.id}
      nativeContext={{ messageId: message.id, mode: message.bubbleKind }}
    >
      <article className={`arle-ai-bubble ${meta.className}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="arle-ai-mode-pill">{meta.label}</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            <span className={`h-2 w-2 rounded-full ${meta.dotClassName}`} />
          </div>
        </div>

        <p className="mt-5 text-[15px] leading-7 text-[var(--text-primary)]">
          {message.content}
        </p>

        {message.fileRefs?.length ? (
          <div className="mt-4 space-y-2">
            {message.fileRefs.map((fileRef) => (
              <div
                key={`${message.id}:${fileRef.path}`}
                className="flex min-h-9 items-center gap-2 rounded-[12px] border border-[color-mix(in_srgb,currentColor_24%,var(--border-subtle))] bg-[rgba(255,255,255,0.035)] px-3 font-mono text-[11px]"
              >
                <FileText size={15} />
                <span className="min-w-0 flex-1 truncate">
                  {fileRefLabel(fileRef.label)}
                </span>
                {fileRef.detail && (
                  <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                    {fileRef.detail}
                  </span>
                )}
                {typeof fileRef.additions === "number" && (
                  <span className="text-[#72d1bd]">+{fileRef.additions}</span>
                )}
                {typeof fileRef.deletions === "number" && (
                  <span className="text-[#ff7f72]">-{fileRef.deletions}</span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {message.codeFrame && (
          <div className="mt-3 rounded-[12px] border border-[rgba(255,127,114,0.22)] bg-[rgba(255,127,114,0.08)] px-3 py-2 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
            {message.codeFrame}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {message.actions?.map((action) => {
            const ActionIcon = actionIcon(action.id);
            return (
              <button
                key={action.id}
                className={`arle-ai-action ${
                  action.kind === "primary" ? "arle-ai-action-primary" : ""
                }`}
              >
                <ActionIcon size={14} />
                {action.label}
              </button>
            );
          })}
          <button
            className="arle-ai-action"
            onClick={() => void onCopy(message.content)}
          >
            <Copy size={14} />
            Copy
          </button>
        </div>
      </article>
    </ContextActionMenu>
  );
};

const HistorySidebar: React.FC<{
  activeId: string;
  onNewChat?: () => void;
}> = ({ activeId, onNewChat }) => (
  <aside className="arle-ai-sidebar">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[18px] font-semibold text-[var(--text-primary)]">
        <History size={18} />
        History
      </div>
      <button
        onClick={onNewChat}
        className="shell-control min-h-8 gap-1.5 px-3 text-[12px]"
      >
        <Plus size={14} />
        New chat
      </button>
    </div>
    <div className="space-y-2">
      {historyItems.map((item) => (
        <button
          key={item.id}
          className={`w-full rounded-[16px] border px-3 py-3 text-left transition-colors ${
            item.id === activeId
              ? "border-[rgba(243,201,107,0.35)] bg-[rgba(243,201,107,0.08)]"
              : "border-[var(--shell-border)] bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.045)]"
          }`}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
              {item.title}
            </span>
            <span
              className={`h-2 w-2 rounded-full ${MODE_META[item.mode].dotClassName}`}
            />
          </div>
          <div className="line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">
            {item.summary}
          </div>
          <div className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">
            {item.time}
          </div>
        </button>
      ))}
    </div>
  </aside>
);

const BranchSidebar: React.FC = () => (
  <aside className="arle-ai-sidebar arle-ai-sidebar-branch">
    <div className="mb-4 rounded-[14px] bg-[rgba(255,255,255,0.075)] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[18px] font-semibold text-[var(--text-primary)]">
          <GitBranch size={18} />
          Changes
        </div>
        <div className="flex items-center gap-1 font-mono text-[20px]">
          <span className="text-[#32d46d]">
            +{formatDiff(branchDiff.additions)}
          </span>
          <span className="text-[#ff5f57]">
            -{formatDiff(branchDiff.deletions)}
          </span>
        </div>
      </div>
    </div>

    <div className="space-y-2">
      {diffFiles.map((file) => (
        <button
          key={file.path}
          className="w-full rounded-[16px] border border-[var(--shell-border)] bg-[rgba(255,255,255,0.025)] px-3 py-3 text-left hover:bg-[rgba(255,255,255,0.045)]"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[12px] text-[var(--text-primary)]">
              {file.path}
            </span>
            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-secondary)]">
              {file.status}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <span className="text-[#32d46d]">+{file.additions}</span>
            <span className="text-[#ff5f57]">-{file.deletions}</span>
          </div>
        </button>
      ))}
    </div>
  </aside>
);

export const AIChatPanelContent: React.FC<AIChatPanelProps> = ({
  onClearChat,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<ChatMode>("plan");
  const [activeSidebar, setActiveSidebar] = useState<SidebarKind>(null);
  const [selectedProviderId, setSelectedProviderId] = useState(
    providerAccounts[0]?.id ?? "",
  );
  const selectedProvider = providerAccounts.find(
    (provider) => provider.id === selectedProviderId,
  );

  const copyMessage = async (content: string) => {
    await writeClipboardTextWithFallback(content);
  };

  const toggleSidebar = (sidebar: Exclude<SidebarKind, null>) => {
    setActiveSidebar((current) => (current === sidebar ? null : sidebar));
    setSettingsOpen(false);
    setProviderOpen(false);
  };

  return (
    <section className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_70%_8%,rgba(114,209,189,0.05),transparent_30%),radial-gradient(circle_at_25%_0%,rgba(243,201,107,0.08),transparent_28%),var(--surface-canvas)] text-[var(--text-primary)]">
      <header className="relative flex min-h-[54px] items-center justify-between gap-3 border-b border-[rgba(215,169,82,0.18)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[13px] border border-[rgba(215,169,82,0.2)] bg-[rgba(255,255,255,0.035)]">
            <MessageSquare size={15} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">AI Chat</div>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <div className="relative">
            <button
              onClick={() => {
                setProviderOpen((open) => !open);
                setSettingsOpen(false);
                setActiveSidebar(null);
              }}
              className="shell-pill min-h-[36px] gap-2 px-3 text-[12px]"
            >
              <Bot size={15} />
              <span className="text-[var(--text-muted)]">Provider</span>
              <span>{selectedProvider?.displayName ?? "OpenAI"}</span>
              <ChevronDown size={14} />
            </button>
            <ProviderMenu
              open={providerOpen}
              providers={providerAccounts}
              selectedProviderId={selectedProviderId}
              onSelectProvider={(providerId) => {
                setSelectedProviderId(providerId);
                if (providerId !== "anthropic-api") {
                  setProviderOpen(false);
                }
              }}
            />
          </div>

          <button
            className={`arle-ai-top-tab ${
              activeSidebar === "history" ? "arle-ai-top-tab-active" : ""
            }`}
            onClick={() => toggleSidebar("history")}
          >
            <History size={15} />
            History
          </button>
          <button
            className={`arle-ai-top-tab arle-ai-branch-tab ${
              activeSidebar === "branch" ? "arle-ai-top-tab-active" : ""
            }`}
            onClick={() => toggleSidebar("branch")}
          >
            <GitBranch size={15} />
            <span>Branch</span>
            <span className="font-mono text-[#32d46d]">
              +{formatDiff(branchDiff.additions)}
            </span>
            <span className="font-mono text-[#ff5f57]">
              -{formatDiff(branchDiff.deletions)}
            </span>
          </button>

          <div className="relative">
            <button
              className="shell-control min-h-9 gap-2 px-3"
              onClick={() => {
                setSettingsOpen((open) => !open);
                setProviderOpen(false);
                setActiveSidebar(null);
              }}
            >
              <Settings size={15} />
              Settings
              <ChevronDown size={14} />
            </button>
            <SettingsPopover
              open={settingsOpen}
              activeMode={activeMode}
              onModeChange={setActiveMode}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {activeSidebar === "history" && (
          <HistorySidebar activeId="hist-metrics" onNewChat={onClearChat} />
        )}
        {activeSidebar === "branch" && <BranchSidebar />}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            <div className="text-center font-mono text-[11px] text-[var(--text-muted)]">
              Today 21:58
            </div>
            {fixtureMessages.map((message) => (
              <div key={message.id} className="flex justify-end">
                <div className="w-full max-w-[520px]">
                  <ChatBubble message={message} onCopy={copyMessage} />
                </div>
              </div>
            ))}
          </div>

          <footer className="border-t border-[rgba(215,169,82,0.18)] p-4">
            <div className="rounded-[24px] border border-[rgba(215,169,82,0.28)] bg-[rgba(255,255,255,0.035)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ModeSegmentedControl
                  activeMode={activeMode}
                  onModeChange={setActiveMode}
                  compact
                />
                {["metric_store.go", "stores", "services"].map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 text-[11px] text-[var(--text-secondary)]"
                  >
                    <Sparkles size={12} />
                    {chip}
                    <X size={12} />
                  </span>
                ))}
                <button className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[rgba(215,169,82,0.22)] px-3 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  <Plus size={13} />
                  Add context
                </button>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <textarea
                  className="max-h-28 min-h-16 resize-none bg-transparent text-[14px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  placeholder="Ask Arlecchino anything... (Cmd Enter to send)"
                />
                <div className="flex items-center gap-2">
                  <button
                    className="shell-control h-10 w-10 px-0"
                    title="Attach context"
                  >
                    <Paperclip size={16} />
                  </button>
                  <button
                    className="shell-control h-10 w-10 px-0 font-mono"
                    title="Slash commands"
                  >
                    /
                  </button>
                  <button className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(243,201,107,0.52)] bg-[#f3c96b] text-[#17130a] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
                    <Send size={18} />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${providerStatusDot(
                      selectedProvider?.status ?? "connected",
                    )}`}
                  />
                  {selectedProvider?.modelIds[0] ?? "GPT-5.2"}
                </span>
                <button
                  onClick={onClearChat}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  New chat
                </button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
};

export default AIChatPanelContent;
