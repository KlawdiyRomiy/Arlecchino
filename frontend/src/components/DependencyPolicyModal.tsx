import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import * as App from "../wails/app";
import {
  ConsentMode,
  ExecuteRequest,
  type ExecuteResult,
  type PolicyPlan,
} from "../../bindings/arlecchino/internal/depsync/models";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { isAppNotificationInteractionEvent } from "../utils/appNotificationTargets";
import { shortcuts } from "../utils/keyboard";
import {
  SHELL_DIALOG_OVERLAY_TRANSITION,
  SHELL_DIALOG_PANEL_TRANSITION,
} from "./ui/motionContracts";

interface DependencyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify?: (type: "success" | "error", message: string) => void;
}

const CONSENT_OPTIONS: {
  value: ConsentMode;
  label: string;
  description: string;
}[] = [
  {
    value: ConsentMode.ConsentModeConfirmOncePerProject,
    label: "Once per project",
    description: "Remember approved actions for this workspace.",
  },
  {
    value: ConsentMode.ConsentModeConfirmEachTime,
    label: "Every run",
    description: "Ask again before medium or high-risk actions.",
  },
  {
    value: ConsentMode.ConsentModeNeverAuto,
    label: "Manual only",
    description: "Preview the plan and wait for explicit approval.",
  },
];

const dependencySurfaceClass =
  "overflow-hidden rounded-[24px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_98%,transparent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_24px_-22px_rgba(0,0,0,0.85)]";
const dependencyInsetClass =
  "rounded-[20px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)]";
const dependencyPillClass =
  "inline-flex min-h-[30px] items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)] px-3 text-[11px] font-semibold text-[var(--text-secondary)]";
const dependencyActionClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_96%,transparent)] px-3 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-60";
const dependencyIconButtonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-45";
const dependencyPrimaryClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[18px] border border-[var(--border-default)] bg-[var(--text-primary)] px-4 text-[12px] font-semibold text-[var(--surface-canvas)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-muted)] disabled:opacity-60";
const dependencyReadableTextClass =
  "text-[color-mix(in_srgb,var(--text-secondary)_82%,var(--text-primary))]";

const riskBadgeClass = (risk: string) => {
  switch (risk) {
    case "high":
      return "border-[color:var(--status-error)]/25 bg-[color:var(--status-error)]/10 text-[var(--status-error)]";
    case "medium":
      return "border-[color:var(--status-warning)]/25 bg-[color:var(--status-warning)]/10 text-[var(--status-warning)]";
    default:
      return "border-[color:var(--status-success)]/25 bg-[color:var(--status-success)]/10 text-[var(--status-success)]";
  }
};

const normalizeApprovedActionIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
};

const formatCapability = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());

const dependencyResultState = (message: string) => {
  const normalized = message.trim().toLowerCase();
  if (normalized.startsWith("failed:")) {
    return "failed";
  }
  if (normalized.startsWith("skipped:")) {
    return "skipped";
  }
  return "completed";
};

const dependencyResultCardClass = (message: string) => {
  switch (dependencyResultState(message)) {
    case "failed":
      return "rounded-[20px] border border-[color:var(--status-error)]/25 bg-[color:var(--status-error)]/10 px-4 py-3 text-[14px] leading-6 text-[var(--text-primary)]";
    case "skipped":
      return "rounded-[20px] border border-[color:var(--status-warning)]/25 bg-[color:var(--status-warning)]/10 px-4 py-3 text-[14px] leading-6 text-[var(--text-primary)]";
    default:
      return `${dependencyInsetClass} px-4 py-3 text-[14px] leading-6 text-[var(--text-primary)]`;
  }
};

const SwitchRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ title, description, checked, onCheckedChange, disabled = false }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[18px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_92%,transparent)] px-4 py-4">
    <div className="min-w-0">
      <div className="text-[15px] font-semibold leading-5 text-[var(--text-primary)]">
        {title}
      </div>
      <div
        className={`mt-1 text-[13px] leading-5 ${dependencyReadableTextClass}`}
      >
        {description}
      </div>
    </div>
    <button
      type="button"
      role="switch"
      aria-label={title}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] ${
        checked
          ? "border-[var(--text-primary)] bg-[var(--text-primary)]"
          : "border-[var(--border-default)] bg-[var(--surface-3)]"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span
        className={`block h-6 w-6 rounded-full shadow-sm transition-transform ${
          checked
            ? "translate-x-5 bg-[var(--surface-canvas)]"
            : "translate-x-0 bg-[var(--text-secondary)]"
        }`}
      />
    </button>
  </div>
);

export const DependencyPolicyModal: React.FC<DependencyPolicyModalProps> = ({
  isOpen,
  onClose,
  onNotify,
}) => {
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  const reduceDialogMotion = useReducedMotion();
  const [consentMode, setConsentMode] = useState<ConsentMode>(
    ConsentMode.ConsentModeConfirmOncePerProject,
  );
  const [autoApproveLowRisk, setAutoApproveLowRisk] = useState(true);
  const [persistApprovals, setPersistApprovals] = useState(true);
  const [plan, setPlan] = useState<PolicyPlan | null>(null);
  const [approvedActionIds, setApprovedActionIds] = useState<string[]>([]);
  const [rememberedActionIds, setRememberedActionIds] = useState<string[]>([]);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const handleDialogInteractOutside = useCallback((event: Event) => {
    if (isAppNotificationInteractionEvent(event)) {
      event.preventDefault();
    }
  }, []);

  const sectionLabelClass =
    "text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]";
  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextPlan, rememberedRaw] = await Promise.all([
        App.GetDependencyPolicyPlan(consentMode),
        App.ListApprovedDependencyActions(),
      ]);
      const remembered = normalizeApprovedActionIds(rememberedRaw);
      setPlan(nextPlan);
      setRememberedActionIds(remembered);
      setApprovedActionIds((previous) => {
        const merged = new Set([...previous, ...remembered]);
        return Array.from(merged);
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load dependency policy plan";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [consentMode]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void loadPlan();
  }, [isOpen, loadPlan]);

  useEffect(() => {
    if (consentMode !== ConsentMode.ConsentModeConfirmOncePerProject) {
      setPersistApprovals(false);
      return;
    }
    setPersistApprovals(true);
  }, [consentMode]);

  const actionEntries = useMemo(() => plan?.actions ?? [], [plan]);
  const consentRequiredCount = useMemo(
    () => actionEntries.filter((action) => action.requiresConsent).length,
    [actionEntries],
  );
  const planStatusLabel =
    loading && !plan
      ? "Loading"
      : actionEntries.length === 0
        ? "Ready"
        : `${consentRequiredCount} need review`;

  const toggleActionApproval = useCallback((actionId: string) => {
    setApprovedActionIds((previous) => {
      const next = new Set(previous);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return Array.from(next);
    });
  }, []);

  const handleClearRemembered = useCallback(async () => {
    setClearing(true);
    setError(null);
    try {
      await App.ClearApprovedDependencyActions();
      setApprovedActionIds((previous) =>
        previous.filter((id) => !rememberedActionIds.includes(id)),
      );
      setRememberedActionIds([]);
      onNotify?.("success", "Cleared remembered dependency approvals");
    } catch (clearError) {
      const message =
        clearError instanceof Error
          ? clearError.message
          : "Failed to clear remembered approvals";
      setError(message);
      onNotify?.("error", `[Dependencies] ${message}`);
    } finally {
      setClearing(false);
    }
  }, [onNotify, rememberedActionIds]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await App.RunDependencyPolicySync(
        new ExecuteRequest({
          policy: {
            consentMode,
            autoApproveLowRisk,
          },
          approvedActionIds,
          persistApprovals:
            consentMode === ConsentMode.ConsentModeConfirmOncePerProject &&
            persistApprovals,
          dryRun: false,
        }),
      );
      setResult(response);

      const blockedCount = Object.keys(response.blocked ?? {}).length;
      const resultMessages = Object.values(response.results ?? {});
      const resultCount = resultMessages.length;
      const failedCount = resultMessages.filter(
        (message) => dependencyResultState(message ?? "") === "failed",
      ).length;
      const skippedCount = resultMessages.filter(
        (message) => dependencyResultState(message ?? "") === "skipped",
      ).length;
      const summaryParts = [`${resultCount} actions ran`];
      if (failedCount > 0) {
        summaryParts.push(`${failedCount} failed`);
      }
      if (skippedCount > 0) {
        summaryParts.push(`${skippedCount} skipped`);
      }
      if (blockedCount > 0) {
        summaryParts.push(`${blockedCount} blocked`);
      }
      const summary = `Dependency sync finished: ${summaryParts.join(", ")}.`;
      if (failedCount > 0) {
        setError(summary);
        onNotify?.("error", `[Dependencies] ${summary}`);
      } else {
        onNotify?.("success", summary);
      }

      if (
        consentMode === ConsentMode.ConsentModeConfirmOncePerProject &&
        persistApprovals
      ) {
        const remembered = normalizeApprovedActionIds(
          await App.ListApprovedDependencyActions(),
        );
        setRememberedActionIds(remembered);
      }
    } catch (runError) {
      const message =
        runError instanceof Error ? runError.message : "Dependency sync failed";
      setError(message);
      onNotify?.("error", `[Dependencies] ${message}`);
    } finally {
      setRunning(false);
    }
  }, [
    approvedActionIds,
    autoApproveLowRisk,
    consentMode,
    onNotify,
    persistApprovals,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    document.body.dataset.shellModalOpen = "true";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shortcuts.escape(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!running) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      delete document.body.dataset.shellModalOpen;
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose, running]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {isOpen ? (
            <React.Fragment key="dependency-policy-modal-motion">
              <Dialog.Overlay forceMount asChild>
                <motion.div
                  className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-[10px]"
                  initial={reduceDialogMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceDialogMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={
                    reduceDialogMotion
                      ? { duration: 0 }
                      : SHELL_DIALOG_OVERLAY_TRANSITION
                  }
                />
              </Dialog.Overlay>
              <Dialog.Content
                forceMount
                asChild
                onEscapeKeyDown={(event) => {
                  event.preventDefault();
                  if (!running) {
                    onClose();
                  }
                }}
                onInteractOutside={handleDialogInteractOutside}
              >
                <motion.div
                  className="fixed left-1/2 top-1/2 z-[111] outline-none"
                  data-testid="dependency-policy-modal"
                  initial={reduceDialogMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceDialogMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={
                    reduceDialogMotion
                      ? { duration: 0 }
                      : SHELL_DIALOG_OVERLAY_TRANSITION
                  }
                  style={{
                    transform: `translate(-50%, -50%) scale(${uiScale})`,
                    transformOrigin: "center",
                    width: `min(${94 / uiScale}vw, 1180px)`,
                    height: `min(${88 / uiScale}vh, 840px)`,
                  }}
                >
                  <motion.div
                    className="flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-canvas)] shadow-[var(--shadow-overlay)]"
                    initial={
                      reduceDialogMotion ? false : { y: 12, scale: 0.985 }
                    }
                    animate={{ y: 0, scale: 1 }}
                    exit={
                      reduceDialogMotion
                        ? { y: 0, scale: 1 }
                        : { y: 8, scale: 0.99 }
                    }
                    transition={
                      reduceDialogMotion
                        ? { duration: 0 }
                        : SHELL_DIALOG_PANEL_TRANSITION
                    }
                  >
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_96%,transparent)] px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                          <ShieldCheck size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                            Workspace policy
                          </div>
                          <Dialog.Title className="text-[26px] font-semibold leading-none text-[var(--text-primary)]">
                            Sync dependencies
                          </Dialog.Title>
                          <Dialog.Description className="mt-2 text-[13px] text-[var(--text-secondary)]">
                            Review dependency actions before they touch this
                            workspace.
                          </Dialog.Description>
                        </div>
                      </div>

                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className={dependencyIconButtonClass}
                          aria-label="Close dependency policy dialog"
                        >
                          <X size={16} />
                        </button>
                      </Dialog.Close>
                    </div>

                    <div className="grid min-h-0 flex-1 gap-5 bg-[var(--surface-overlay)] p-5 md:grid-cols-[360px_minmax(0,1fr)]">
                      <div className="min-h-0 overflow-y-auto">
                        <div className="space-y-4">
                          <section className={`${dependencySurfaceClass} p-4`}>
                            <div className={sectionLabelClass}>Consent</div>
                            <div className="mt-4 space-y-2.5">
                              {CONSENT_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setConsentMode(option.value)}
                                  className={`grid w-full grid-cols-[34px_minmax(0,1fr)] items-start gap-3 rounded-[20px] border px-3.5 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] ${
                                    consentMode === option.value
                                      ? "border-[var(--border-default)] bg-[var(--surface-active)]"
                                      : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_92%,transparent)] hover:border-[var(--border-default)] hover:bg-[var(--surface-3)]"
                                  }`}
                                  aria-pressed={consentMode === option.value}
                                >
                                  <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-primary)]">
                                    {consentMode === option.value ? (
                                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--text-primary)]" />
                                    ) : null}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-[15px] font-semibold leading-5 text-[var(--text-primary)]">
                                      {option.label}
                                    </span>
                                    <span
                                      className={`mt-1.5 block text-[13px] leading-5 ${dependencyReadableTextClass}`}
                                    >
                                      {option.description}
                                    </span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          </section>

                          <section className={`${dependencySurfaceClass} p-4`}>
                            <div className={sectionLabelClass}>Safety</div>
                            <div className="mt-4 space-y-2.5">
                              <SwitchRow
                                title="Auto-approve low risk"
                                description="Resolve-only actions can run without review."
                                checked={autoApproveLowRisk}
                                onCheckedChange={setAutoApproveLowRisk}
                              />
                              <SwitchRow
                                title="Remember approvals"
                                description="Store approved action ids for this project."
                                checked={persistApprovals}
                                onCheckedChange={setPersistApprovals}
                                disabled={
                                  consentMode !==
                                  ConsentMode.ConsentModeConfirmOncePerProject
                                }
                              />
                            </div>
                            <button
                              type="button"
                              className={`${dependencyActionClass} mt-4`}
                              onClick={() => void handleClearRemembered()}
                              disabled={
                                clearing || rememberedActionIds.length === 0
                              }
                            >
                              {clearing
                                ? "Clearing..."
                                : "Clear remembered approvals"}
                            </button>
                          </section>
                        </div>
                      </div>

                      <div className="flex min-h-0 flex-col gap-4">
                        <section className={`${dependencySurfaceClass} p-4`}>
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className={sectionLabelClass}>
                                Execution plan
                              </div>
                              <div className="mt-2 text-[18px] font-semibold text-[var(--text-primary)]">
                                Planned actions
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span
                                  className={`${dependencyPillClass} max-w-full`}
                                >
                                  <span className="truncate">
                                    {plan?.projectPath ||
                                      "Loading project context..."}
                                  </span>
                                </span>
                                <span className={dependencyPillClass}>
                                  {planStatusLabel}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className={dependencyActionClass}
                              onClick={() => void loadPlan()}
                              disabled={loading || running}
                            >
                              <RefreshCw
                                size={14}
                                className={loading ? "animate-spin" : ""}
                              />
                              Refresh
                            </button>
                          </div>
                        </section>

                        {error && (
                          <div className="rounded-[20px] border border-[color:var(--status-error)]/25 bg-[color:var(--status-error)]/10 px-4 py-3 text-[13px] text-[var(--status-error)]">
                            {error}
                          </div>
                        )}

                        <div className="min-h-0 flex-1 overflow-y-auto">
                          {loading && !plan ? (
                            <div
                              className={`${dependencySurfaceClass} flex min-h-[260px] items-center justify-center px-6 py-10 text-center`}
                            >
                              <div>
                                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
                                  <RefreshCw
                                    size={18}
                                    className="animate-spin"
                                  />
                                </div>
                                <div className="mt-4 text-[15px] font-semibold text-[var(--text-primary)]">
                                  Loading plan
                                </div>
                                <div
                                  className={`mt-1 text-[13px] ${dependencyReadableTextClass}`}
                                >
                                  Reading workspace dependency policy.
                                </div>
                              </div>
                            </div>
                          ) : actionEntries.length === 0 ? (
                            <div
                              className={`${dependencySurfaceClass} flex min-h-[360px] items-center px-7 py-8`}
                            >
                              <div className="max-w-xl">
                                <div className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-primary)]">
                                  <PackageCheck size={22} />
                                </div>
                                <div className="mt-5 text-[22px] font-semibold text-[var(--text-primary)]">
                                  Plan is clear
                                </div>
                                <div className="mt-2 text-[14px] leading-6 text-[var(--text-secondary)]">
                                  No dependency actions are available for this
                                  project.
                                </div>
                                <div className="mt-5 flex flex-wrap items-center gap-2">
                                  <span className={dependencyPillClass}>
                                    0 actions
                                  </span>
                                  <span className={dependencyPillClass}>
                                    No consent required
                                  </span>
                                  <span className={dependencyPillClass}>
                                    <Check size={12} />
                                    Ready
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3">
                              {actionEntries.map((action) => {
                                const isApproved = approvedActionIds.includes(
                                  action.id,
                                );
                                const isRemembered =
                                  rememberedActionIds.includes(action.id);
                                const isExpanded =
                                  expandedActionId === action.id;
                                return (
                                  <section
                                    key={action.id}
                                    className={dependencySurfaceClass}
                                  >
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={() =>
                                        setExpandedActionId((previous) =>
                                          previous === action.id
                                            ? null
                                            : action.id,
                                        )
                                      }
                                      onKeyDown={(event) => {
                                        if (
                                          event.key !== "Enter" &&
                                          event.key !== " "
                                        ) {
                                          return;
                                        }
                                        event.preventDefault();
                                        setExpandedActionId((previous) =>
                                          previous === action.id
                                            ? null
                                            : action.id,
                                        );
                                      }}
                                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--focus-ring)]"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                                            {action.label}
                                          </span>
                                          <span
                                            className={`inline-flex min-h-[26px] items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${riskBadgeClass(action.mutationRisk || "low")}`}
                                          >
                                            {action.mutationRisk || "low"}
                                          </span>
                                          <span className={dependencyPillClass}>
                                            {formatCapability(
                                              action.capability || "unknown",
                                            )}
                                          </span>
                                          {action.requiresConsent ? (
                                            <span
                                              className={dependencyPillClass}
                                            >
                                              Consent required
                                            </span>
                                          ) : null}
                                          {isRemembered ? (
                                            <span
                                              className={dependencyPillClass}
                                            >
                                              Remembered
                                            </span>
                                          ) : null}
                                        </div>
                                        <div
                                          className={`mt-2 flex flex-wrap items-center gap-2 text-[12px] ${dependencyReadableTextClass}`}
                                        >
                                          <span>{action.ecosystem}</span>
                                          <span className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
                                          <span>{action.tool}</span>
                                          <span className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
                                          <span className="truncate">
                                            {action.manifest}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {action.requiresConsent ? (
                                          <span
                                            className="inline-flex items-center gap-2"
                                            onClick={(event) =>
                                              event.stopPropagation()
                                            }
                                          >
                                            <button
                                              type="button"
                                              role="checkbox"
                                              aria-checked={isApproved}
                                              onClick={() =>
                                                toggleActionApproval(action.id)
                                              }
                                              className={`inline-flex h-9 items-center gap-2 rounded-[18px] border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] ${
                                                isApproved
                                                  ? "border-[var(--border-default)] bg-[var(--surface-active)] text-[var(--text-primary)]"
                                                  : "border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
                                              }`}
                                            >
                                              <Check size={13} />
                                              Approve
                                            </button>
                                          </span>
                                        ) : null}
                                        <span
                                          className={dependencyIconButtonClass}
                                        >
                                          {isExpanded ? (
                                            <ChevronDown size={15} />
                                          ) : (
                                            <ChevronRight size={15} />
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                    {isExpanded && (
                                      <div className="border-t border-[var(--border-subtle)] px-4 pb-4">
                                        <div
                                          className={`${dependencyInsetClass} mt-4 px-4 py-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]`}
                                        >
                                          {action.executable} {action.args}
                                        </div>
                                      </div>
                                    )}
                                  </section>
                                );
                              })}
                            </div>
                          )}

                          {result && (
                            <div className="mt-4 space-y-4">
                              <section
                                className={`${dependencySurfaceClass} p-4`}
                              >
                                <div className={sectionLabelClass}>Results</div>
                                <div className="mt-3 space-y-2">
                                  {Object.entries(result.results ?? {}).map(
                                    ([id, message]) => (
                                      <div
                                        key={id}
                                        className={dependencyResultCardClass(
                                          message ?? "",
                                        )}
                                      >
                                        <div className="font-mono text-[13px] leading-5 text-[var(--text-muted)]">
                                          {id}
                                        </div>
                                        <div className="mt-1.5 whitespace-pre-wrap break-words">
                                          {message || "completed"}
                                        </div>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </section>

                              {Object.keys(result.blocked ?? {}).length > 0 && (
                                <section
                                  className={`${dependencySurfaceClass} p-4`}
                                >
                                  <div className={sectionLabelClass}>
                                    Blocked
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    {Object.entries(result.blocked ?? {}).map(
                                      ([id, reason]) => (
                                        <div
                                          key={id}
                                          className="rounded-[20px] border border-[color:var(--status-warning)]/25 bg-[color:var(--status-warning)]/10 px-4 py-3 text-[14px] leading-6 text-[var(--text-primary)]"
                                        >
                                          <div className="font-mono text-[13px] leading-5 text-[var(--status-warning)]">
                                            {id}
                                          </div>
                                          <div className="mt-1.5 whitespace-pre-wrap break-words">
                                            {reason}
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </section>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="shell-cluster-soft flex min-h-[54px] w-full justify-between gap-3 px-3 py-2">
                          <span className={dependencyPillClass}>
                            {actionEntries.length} actions in plan
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className={dependencyActionClass}
                              onClick={onClose}
                              disabled={running}
                            >
                              Close
                            </button>
                            <button
                              type="button"
                              className={dependencyPrimaryClass}
                              onClick={() => void handleRun()}
                              disabled={
                                running || loading || actionEntries.length === 0
                              }
                            >
                              {running ? "Running..." : "Run"}
                            </button>
                          </div>
                        </div>
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
