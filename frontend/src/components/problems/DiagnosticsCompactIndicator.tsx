import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  LoaderCircle,
  Layers3,
} from "lucide-react";

import type { DiagnosticsSummary } from "../../stores/diagnosticsStore";

interface DiagnosticsCompactIndicatorProps {
  summary: DiagnosticsSummary;
  onClick: () => void;
  state?: "default" | "scanning" | "partial";
}

const formatCount = (value: number, label: string) => `${value} ${label}`;

export const DiagnosticsCompactIndicator: React.FC<
  DiagnosticsCompactIndicatorProps
> = ({ summary, onClick, state = "default" }) => {
  const hasProblems = summary.total > 0;
  const ariaLabel = hasProblems
    ? `Problems: ${formatCount(summary.errors, "errors")}, ${formatCount(summary.warnings, "warnings")}, ${formatCount(summary.infos, "info")}`
    : state === "scanning"
      ? "Problems: scanning workspace diagnostics"
      : state === "partial"
        ? "Problems: partial workspace diagnostics"
        : "Problems: no issues";

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="diagnostics-compact-indicator"
      aria-label={ariaLabel}
      className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
    >
      {hasProblems ? (
        <>
          <span className="flex items-center gap-1 text-[#EF4444]">
            <AlertCircle size={12} />
            <span className="font-semibold">{summary.errors}</span>
          </span>
          <span className="flex items-center gap-1 text-[#F59E0B]">
            <AlertTriangle size={12} />
            <span className="font-semibold">{summary.warnings}</span>
          </span>
          <span className="flex items-center gap-1 text-[#3B82F6]">
            <Info size={12} />
            <span className="font-semibold">{summary.infos}</span>
          </span>
        </>
      ) : state === "scanning" ? (
        <span className="flex items-center gap-1 text-[#F8FAFC]">
          <LoaderCircle size={12} className="animate-spin" />
          <span className="font-semibold">Scanning</span>
        </span>
      ) : state === "partial" ? (
        <span className="flex items-center gap-1 text-[#F59E0B]">
          <Layers3 size={12} />
          <span className="font-semibold">Partial</span>
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[#22C55E]">
          <CheckCircle2 size={12} />
          <span className="font-semibold">Clear</span>
        </span>
      )}
    </button>
  );
};
