import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Layers3,
  LoaderCircle,
  Search,
} from "lucide-react";

import type { DiagnosticsSummary } from "../../stores/diagnosticsStore";

interface DiagnosticsCompactIndicatorProps {
  summary: DiagnosticsSummary;
  onClick: () => void;
  state?:
    "default" | "scanning" | "partial" | "incomplete" | "unavailable" | "scan";
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
        : state === "incomplete"
          ? "Problems: workspace diagnostics incomplete"
          : state === "unavailable"
            ? "Problems: diagnostics unavailable"
            : state === "scan"
              ? "Problems: scan project to check workspace diagnostics"
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
          <span
            className="flex items-center gap-1"
            style={{ color: "var(--status-error-text)" }}
          >
            <AlertCircle size={12} />
            <span className="font-semibold">{summary.errors}</span>
          </span>
          <span
            className="flex items-center gap-1"
            style={{ color: "var(--status-warning-text)" }}
          >
            <AlertTriangle size={12} />
            <span className="font-semibold">{summary.warnings}</span>
          </span>
          <span
            className="flex items-center gap-1"
            style={{ color: "var(--status-info-text)" }}
          >
            <Info size={12} />
            <span className="font-semibold">{summary.infos}</span>
          </span>
        </>
      ) : state === "scanning" ? (
        <span className="flex items-center gap-1 text-[var(--text-primary)]">
          <LoaderCircle size={12} className="animate-spin" />
          <span className="font-semibold">Scanning</span>
        </span>
      ) : state === "partial" ? (
        <span
          className="flex items-center gap-1"
          style={{ color: "var(--status-warning-text)" }}
        >
          <Layers3 size={12} />
          <span className="font-semibold">Partial</span>
        </span>
      ) : state === "incomplete" ? (
        <span
          className="flex items-center gap-1"
          style={{ color: "var(--status-warning-text)" }}
        >
          <Layers3 size={12} />
          <span className="font-semibold">Incomplete</span>
        </span>
      ) : state === "unavailable" ? (
        <span
          className="flex items-center gap-1"
          style={{ color: "var(--status-warning-text)" }}
        >
          <AlertTriangle size={12} />
          <span className="font-semibold">Unavailable</span>
        </span>
      ) : state === "scan" ? (
        <span className="flex items-center gap-1 text-[var(--text-primary)]">
          <Search size={12} />
          <span className="font-semibold">Scan</span>
        </span>
      ) : (
        <span
          className="flex items-center gap-1"
          style={{ color: "var(--status-success-text)" }}
        >
          <CheckCircle2 size={12} />
          <span className="font-semibold">Clear</span>
        </span>
      )}
    </button>
  );
};
