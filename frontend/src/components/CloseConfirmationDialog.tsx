import React, { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { MotionShellDialogFrame } from "./ui/MotionShellDialogFrame";

export type CloseConfirmationKind = "project" | "application";

export interface CloseConfirmationRequest {
  kind: CloseConfirmationKind;
  projectName?: string;
}

interface CloseConfirmationDialogProps {
  request: CloseConfirmationRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const copyForRequest = (request: CloseConfirmationRequest) => {
  if (request.kind === "application") {
    return {
      title: "Exit?",
      description: "Active project sessions will stop.",
      detail: "Open terminals, background tasks, and editor state will end.",
      confirmLabel: "Exit",
    };
  }

  const projectName = request.projectName?.trim() || "this project";
  return {
    title: "Close project?",
    description: `Close ${projectName}?`,
    detail:
      "Open terminals, background tasks, and editor state for this project will be closed.",
    confirmLabel: "Close Project",
  };
};

export const CloseConfirmationDialog: React.FC<
  CloseConfirmationDialogProps
> = ({ request, onCancel, onConfirm }) => {
  useEffect(() => {
    if (!request || typeof document === "undefined") {
      return;
    }

    document.body.dataset.closeConfirmationOpen = "true";
    return () => {
      delete document.body.dataset.closeConfirmationOpen;
    };
  }, [request]);

  useEffect(() => {
    if (!request) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        onCancel();
        return;
      }

      onConfirm();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onCancel, onConfirm, request]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {request ? (
        <MotionShellDialogFrame
          key={`close-confirmation-${request.kind}`}
          overlayClassName="pointer-events-auto fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm"
          panelClassName="pointer-events-auto max-h-[calc(100vh-32px)] w-[42em] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[1.5em] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-[2em] text-[calc(16px*var(--ui-scale,1))] shadow-2xl"
          panelTestId="close-confirmation-dialog"
        >
          {(() => {
            const copy = copyForRequest(request);
            return (
              <>
                <div className="flex items-start gap-[1.25em]">
                  <div className="mt-[0.08em] flex h-[3.25em] w-[3.25em] shrink-0 items-center justify-center rounded-[1.1em] border border-[color-mix(in_srgb,var(--status-warning)_35%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] text-[var(--status-warning)]">
                    <AlertCircle className="h-[1.45em] w-[1.45em]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[1.45em] font-semibold leading-tight text-[var(--text-primary)]">
                      {copy.title}
                    </div>
                    <div className="mt-[0.75em] text-[1em] leading-[1.45] text-[var(--text-secondary)]">
                      {copy.description}
                    </div>
                    <div className="mt-[0.65em] max-w-[34em] text-[0.9em] leading-[1.45] text-[var(--text-muted)]">
                      {copy.detail}
                    </div>
                  </div>
                </div>

                <div className="mt-[2em] flex items-center justify-end gap-[1em]">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="min-h-[2.9em] rounded-[0.95em] border border-[var(--border-subtle)] px-[1.45em] py-[0.65em] text-[0.95em] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    className="min-h-[2.9em] rounded-[0.95em] bg-red-500 px-[1.45em] py-[0.65em] text-[0.95em] font-medium text-white transition-colors hover:bg-red-400"
                  >
                    {copy.confirmLabel}
                  </button>
                </div>
              </>
            );
          })()}
        </MotionShellDialogFrame>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
};
