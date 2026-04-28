import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Clock, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { Button } from "./ui";
import { EventsEmit, EventsOn } from "../wails/runtime";

interface MCPApprovalRequest {
  requestId: string;
  toolName: string;
  risk: string;
  ttlSeconds: number;
  requestedAt?: string;
}

const DEFAULT_TTL_SECONDS = 300;

const riskLabels: Record<string, string> = {
  "boundary-crossing": "Boundary crossing",
  "bridge-control": "IDE control",
  "external-side-effect": "External side effect",
  mutating: "Mutating",
  "sensitive-access": "Sensitive access",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (source: Record<string, unknown>, key: string): string => {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
};

const numberField = (
  source: Record<string, unknown>,
  key: string,
  fallback: number,
): number => {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const normalizeTTL = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.min(Math.floor(value), 3600);
};

const normalizeApprovalRequest = (
  payload: unknown,
): MCPApprovalRequest | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const requestId = stringField(payload, "requestId");
  const toolName = stringField(payload, "toolName");
  if (!requestId || !toolName) {
    return null;
  }

  return {
    requestId,
    toolName,
    risk: stringField(payload, "risk") || "mutating",
    ttlSeconds: normalizeTTL(
      numberField(payload, "ttlSeconds", DEFAULT_TTL_SECONDS),
    ),
    requestedAt: stringField(payload, "requestedAt") || undefined,
  };
};

export const MCPApprovalDialog: React.FC = () => {
  const [queue, setQueue] = useState<MCPApprovalRequest[]>([]);
  const queueRef = useRef<MCPApprovalRequest[]>([]);
  const activeRequest = queue[0] ?? null;

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    return EventsOn("mcp:approval:request", (payload: unknown) => {
      const request = normalizeApprovalRequest(payload);
      if (!request) {
        return;
      }

      setQueue((current) => {
        if (current.some((item) => item.requestId === request.requestId)) {
          return current;
        }
        return [...current, request];
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const request of queueRef.current) {
        EventsEmit("mcp:approval:response", {
          requestId: request.requestId,
          approved: false,
          ttlSeconds: request.ttlSeconds,
        });
      }
    };
  }, []);

  const approveLabel = useMemo(() => {
    if (!activeRequest) {
      return "Approve";
    }

    const minutes = Math.max(1, Math.round(activeRequest.ttlSeconds / 60));
    return `Approve ${minutes} min`;
  }, [activeRequest]);

  const riskLabel = activeRequest
    ? riskLabels[activeRequest.risk] || activeRequest.risk
    : "";

  const respond = useCallback(
    (approved: boolean) => {
      if (!activeRequest) {
        return;
      }

      EventsEmit("mcp:approval:response", {
        requestId: activeRequest.requestId,
        approved,
        ttlSeconds: activeRequest.ttlSeconds,
      });
      setQueue((current) =>
        current.filter((item) => item.requestId !== activeRequest.requestId),
      );
    },
    [activeRequest],
  );

  return (
    <Dialog.Root
      open={Boolean(activeRequest)}
      onOpenChange={(open) => {
        if (!open) {
          respond(false);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/55 backdrop-blur-[8px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[121] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[18px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)] outline-none"
          data-testid="mcp-approval-dialog"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--status-warning)]">
                <ShieldAlert size={17} />
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  MCP Approval
                </div>
                <Dialog.Title className="text-[15px] font-semibold text-[var(--text-primary)]">
                  Agent requests IDE control
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-[var(--text-muted)]">
                  Approve only if this action matches the work you requested.
                </Dialog.Description>
              </div>
            </div>

            <button
              type="button"
              className="topbar-control-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
              aria-label="Deny MCP request"
              onClick={() => respond(false)}
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Tool
                </div>
                {riskLabel ? (
                  <div className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {riskLabel}
                  </div>
                ) : null}
              </div>
              <div className="break-all font-mono text-[13px] text-[var(--text-primary)]">
                {activeRequest?.toolName ?? ""}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <Clock size={14} />
              <span>
                Approval grants a temporary session for{" "}
                {Math.max(1, Math.round((activeRequest?.ttlSeconds ?? 0) / 60))}{" "}
                minutes.
              </span>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--border-subtle)] pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => respond(false)}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="inline-flex items-center gap-2"
                onClick={() => respond(true)}
              >
                <ShieldCheck size={14} />
                {approveLabel}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
