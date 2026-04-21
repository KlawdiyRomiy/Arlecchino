import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldCheck, RefreshCw, X } from "lucide-react";

import * as App from "../../wailsjs/go/main/App";
import { depsync } from "../../wailsjs/go/models";
import { Button } from "./ui";

type ConsentMode =
  | "confirm-once-per-project"
  | "confirm-each-time"
  | "never-auto";

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
    value: "confirm-once-per-project",
    label: "Confirm once per project",
    description:
      "Remember approved actions in .arlecchino/dependency-consent.json.",
  },
  {
    value: "confirm-each-time",
    label: "Confirm each time",
    description: "Ask for every medium/high-risk dependency action.",
  },
  {
    value: "never-auto",
    label: "Never auto",
    description:
      "Preview the plan but block consent-required actions until approved.",
  },
];

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

export const DependencyPolicyModal: React.FC<DependencyPolicyModalProps> = ({
  isOpen,
  onClose,
  onNotify,
}) => {
  const [consentMode, setConsentMode] = useState<ConsentMode>(
    "confirm-once-per-project",
  );
  const [autoApproveLowRisk, setAutoApproveLowRisk] = useState(true);
  const [persistApprovals, setPersistApprovals] = useState(true);
  const [plan, setPlan] = useState<depsync.PolicyPlan | null>(null);
  const [approvedActionIds, setApprovedActionIds] = useState<string[]>([]);
  const [rememberedActionIds, setRememberedActionIds] = useState<string[]>([]);
  const [result, setResult] = useState<depsync.ExecuteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);

  const sectionLabelClass =
    "text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]";
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
    if (consentMode !== "confirm-once-per-project") {
      setPersistApprovals(false);
      return;
    }
    setPersistApprovals(true);
  }, [consentMode]);

  const actionEntries = useMemo(() => plan?.actions ?? [], [plan]);

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
        new depsync.ExecuteRequest({
          policy: {
            consentMode,
            autoApproveLowRisk,
          },
          approvedActionIds,
          persistApprovals:
            consentMode === "confirm-once-per-project" && persistApprovals,
          dryRun: false,
        }),
      );
      setResult(response);

      const blockedCount = Object.keys(response.blocked ?? {}).length;
      const resultCount = Object.keys(response.results ?? {}).length;
      const summary =
        blockedCount > 0
          ? `Dependency sync finished: ${resultCount} actions ran, ${blockedCount} blocked.`
          : `Dependency sync finished: ${resultCount} actions ran.`;
      onNotify?.("success", summary);

      if (consentMode === "confirm-once-per-project" && persistApprovals) {
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

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-[8px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] flex h-[min(84vh,780px)] w-[min(960px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)] outline-none"
          data-testid="dependency-policy-modal"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-primary)]">
                <ShieldCheck size={16} />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Workspace policy
                </div>
                <Dialog.Title className="text-[15px] font-semibold text-[var(--text-primary)]">
                  Sync dependencies
                </Dialog.Title>
                <Dialog.Description className="text-xs text-[var(--text-muted)]">
                  Review dependency actions, consent requirements, and
                  remembered approvals.
                </Dialog.Description>
              </div>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="topbar-control-button flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
                aria-label="Close dependency policy dialog"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid flex-1 min-h-0 gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="border-r border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-5">
              <div className="space-y-5">
                <div>
                  <div className={sectionLabelClass}>Consent mode</div>
                  <div className="mt-3 space-y-2">
                    {CONSENT_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)]"
                      >
                        <input
                          type="radio"
                          name="dependency-consent-mode"
                          checked={consentMode === option.value}
                          onChange={() => setConsentMode(option.value)}
                          className="mt-0.5 accent-[var(--accent-primary)]"
                        />
                        <span>
                          <span className="block font-medium text-[var(--text-primary)]">
                            {option.label}
                          </span>
                          <span className="mt-1 block text-xs text-[var(--text-muted)]">
                            {option.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
                  <label className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={autoApproveLowRisk}
                      onChange={(event) =>
                        setAutoApproveLowRisk(event.target.checked)
                      }
                      className="mt-1 accent-[var(--accent-primary)]"
                    />
                    <span>
                      <span className="block font-medium text-[var(--text-primary)]">
                        Auto-approve low-risk actions
                      </span>
                      <span className="mt-1 block text-xs text-[var(--text-muted)]">
                        Lets resolve-only actions run without manual approval.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={persistApprovals}
                      onChange={(event) =>
                        setPersistApprovals(event.target.checked)
                      }
                      disabled={consentMode !== "confirm-once-per-project"}
                      className="mt-1 accent-[var(--accent-primary)]"
                    />
                    <span>
                      <span className="block font-medium text-[var(--text-primary)]">
                        Remember approvals for this project
                      </span>
                      <span className="mt-1 block text-xs text-[var(--text-muted)]">
                        Stores approved action ids in
                        `.arlecchino/dependency-consent.json`.
                      </span>
                    </span>
                  </label>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleClearRemembered()}
                    disabled={clearing || rememberedActionIds.length === 0}
                  >
                    {clearing ? "Clearing..." : "Clear remembered approvals"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-col px-5 py-5">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Execution plan
                  </div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    Planned actions
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {plan?.projectPath || "Loading project context..."}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadPlan()}
                  disabled={loading || running}
                >
                  <RefreshCw
                    size={14}
                    className={loading ? "animate-spin" : ""}
                  />
                  Refresh plan
                </Button>
              </div>

              {error && (
                <div className="mb-4 rounded-xl border border-[color:var(--status-error)]/25 bg-[color:var(--status-error)]/10 px-3 py-2 text-sm text-[var(--status-error)]">
                  {error}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading && !plan ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-6 text-sm text-[var(--text-muted)]">
                    Loading dependency policy plan...
                  </div>
                ) : actionEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-6 text-sm text-[var(--text-muted)]">
                    No dependency actions are currently available for this
                    project.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
                    {actionEntries.map((action) => {
                      const isApproved = approvedActionIds.includes(action.id);
                      const isRemembered = rememberedActionIds.includes(
                        action.id,
                      );
                      const isExpanded = expandedActionId === action.id;
                      return (
                        <div
                          key={action.id}
                          className="border-b border-[var(--border-subtle)] last:border-b-0"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedActionId((previous) =>
                                previous === action.id ? null : action.id,
                              )
                            }
                            className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--focus-ring)]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-[var(--text-primary)]">
                                  {action.label}
                                </span>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${riskBadgeClass(action.mutationRisk)}`}
                                >
                                  {action.mutationRisk}
                                </span>
                                <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                  {action.capability}
                                </span>
                                {action.requiresConsent && (
                                  <span className="rounded-full border border-[var(--accent-primary)]/25 bg-[var(--accent-primary-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--accent-primary)]">
                                    consent required
                                  </span>
                                )}
                                {isRemembered && (
                                  <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                                    remembered
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 text-xs text-[var(--text-muted)]">
                                {action.ecosystem} via {action.tool} ·{" "}
                                {action.manifest}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {action.requiresConsent && (
                                <label
                                  className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isApproved}
                                    onChange={() =>
                                      toggleActionApproval(action.id)
                                    }
                                    className="accent-[var(--accent-primary)]"
                                  />
                                  Approve
                                </label>
                              )}
                              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                {isExpanded ? "Hide" : "Details"}
                              </span>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
                              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                                {action.executable} {action.args}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {result && (
                  <div className="mt-5 space-y-4">
                    <div>
                      <div className={sectionLabelClass}>Results</div>
                      <div className="mt-2 overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
                        {Object.entries(result.results ?? {}).map(
                          ([id, message]) => (
                            <div
                              key={id}
                              className="border-b border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)] last:border-b-0"
                            >
                              <div className="font-mono text-[11px] text-[var(--text-muted)]">
                                {id}
                              </div>
                              <div className="mt-1 whitespace-pre-wrap break-words">
                                {message || "completed"}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </div>

                    {Object.keys(result.blocked ?? {}).length > 0 && (
                      <div>
                        <div className={sectionLabelClass}>Blocked</div>
                        <div className="mt-2 overflow-hidden rounded-[14px] border border-[color:var(--status-warning)]/25 bg-[color:var(--status-warning)]/10">
                          {Object.entries(result.blocked ?? {}).map(
                            ([id, reason]) => (
                              <div
                                key={id}
                                className="border-b border-[color:var(--status-warning)]/15 px-3 py-2 text-xs text-[var(--text-primary)] last:border-b-0"
                              >
                                <div className="font-mono text-[11px] text-[var(--status-warning)]">
                                  {id}
                                </div>
                                <div className="mt-1 whitespace-pre-wrap break-words">
                                  {reason}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <span>{actionEntries.length} actions in plan</span>
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    disabled={running}
                  >
                    Close
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleRun()}
                    disabled={running || loading || actionEntries.length === 0}
                  >
                    {running ? "Running..." : "Run"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
