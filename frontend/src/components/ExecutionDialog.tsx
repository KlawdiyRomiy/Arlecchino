import React, { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Play, Bug, TerminalSquare, Globe, X } from "lucide-react";

import { Input } from "./ui";
import { interactiveSurfaceOverlayStyle } from "./ui/interactiveSurfaceMotion";
import {
  SHELL_DIALOG_PANEL_TRANSITION,
  SHELL_MODAL_PANEL_ANIMATE,
  SHELL_MODAL_PANEL_EXIT,
  SHELL_MODAL_PANEL_INITIAL,
} from "./ui/motionContracts";
import type { ExecutionProfile } from "../utils/executionProfiles";

interface ExecutionDialogProps {
  isOpen: boolean;
  mode: "run" | "debug" | null;
  profiles: ExecutionProfile[];
  activeFileName?: string;
  onClose: () => void;
  onExecuteProfile: (profile: ExecutionProfile) => void;
  onExecuteCustomCommand: (command: string, mode: "run" | "debug") => void;
}

const getProfileIcon = (profile: ExecutionProfile) => {
  if (profile.kind === "preview") {
    return <Globe size={14} />;
  }

  return profile.mode === "debug" ? (
    <Bug size={14} className="text-[var(--status-error)]" />
  ) : (
    <TerminalSquare size={14} className="text-[var(--status-success)]" />
  );
};

export const ExecutionDialog: React.FC<ExecutionDialogProps> = ({
  isOpen,
  mode,
  profiles,
  activeFileName,
  onClose,
  onExecuteProfile,
  onExecuteCustomCommand,
}) => {
  const [customCommand, setCustomCommand] = useState("");
  const reduceDialogMotion = useReducedMotion();

  const sectionLabelClass =
    "text-[15px] font-semibold text-[var(--text-secondary)]";
  const rowClass =
    "group flex w-full items-start gap-3 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]";
  const inputShellClass =
    "rounded-[18px] border border-[var(--border-subtle)] !bg-[var(--bg-tertiary)]";
  const bubbleIconButtonClass =
    "inline-flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-transparent text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]";
  const bubbleActionButtonClass =
    "inline-flex min-h-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-transparent px-6 text-[16px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50";

  const title = mode === "debug" ? "Debug" : "Run";
  const actionIcon =
    mode === "debug" ? (
      <Bug size={18} className="text-[var(--status-error)]" />
    ) : (
      <Play size={18} className="text-[var(--status-success)]" />
    );

  const actionProfiles = useMemo(
    () => profiles.filter((profile) => profile.mode === mode),
    [mode, profiles],
  );

  const handleExecuteCustom = () => {
    if (!mode || customCommand.trim() === "") {
      return;
    }

    onExecuteCustomCommand(customCommand.trim(), mode);
    setCustomCommand("");
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {isOpen && (
            <>
              <Dialog.Overlay forceMount asChild>
                <motion.div
                  className="fixed inset-0 z-[110]"
                  style={interactiveSurfaceOverlayStyle}
                />
              </Dialog.Overlay>
              <Dialog.Content forceMount asChild>
                <motion.div
                  className="fixed left-1/2 top-1/2 z-[111] w-[min(760px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 outline-none"
                  data-testid="execution-dialog"
                >
                  <motion.div
                    className="shell-modal-surface rounded-[28px] bg-[var(--bg-secondary)] p-8"
                    initial={
                      reduceDialogMotion ? false : SHELL_MODAL_PANEL_INITIAL
                    }
                    animate={SHELL_MODAL_PANEL_ANIMATE}
                    exit={
                      reduceDialogMotion
                        ? SHELL_MODAL_PANEL_ANIMATE
                        : SHELL_MODAL_PANEL_EXIT
                    }
                    transition={
                      reduceDialogMotion
                        ? { duration: 0 }
                        : SHELL_DIALOG_PANEL_TRANSITION
                    }
                  >
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0">
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-transparent">
                          {actionIcon}
                        </div>
                        <Dialog.Title className="text-[28px] font-semibold text-[var(--text-primary)]">
                          {title}
                        </Dialog.Title>
                        <Dialog.Description className="mt-2 text-[16px] text-[var(--text-secondary)]">
                          {activeFileName
                            ? `Current context: ${activeFileName}`
                            : "Choose a profile or enter a command"}
                        </Dialog.Description>
                      </div>

                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className={bubbleIconButtonClass}
                          aria-label="Close execution dialog"
                        >
                          <X size={20} />
                        </button>
                      </Dialog.Close>
                    </div>

                    <div className="mt-8 space-y-5">
                      <div>
                        <div className={sectionLabelClass}>Profiles</div>
                        <div className="mt-2">
                          {actionProfiles.length > 0 ? (
                            <div className="space-y-2">
                              {actionProfiles.map((profile) => {
                                const missingTools = profile.missingTools ?? [];
                                const isUnavailable = missingTools.length > 0;

                                return (
                                  <button
                                    key={profile.id}
                                    type="button"
                                    disabled={isUnavailable}
                                    onClick={() => {
                                      if (isUnavailable) {
                                        return;
                                      }
                                      onExecuteProfile(profile);
                                    }}
                                    className={`w-full ${rowClass} ${
                                      isUnavailable
                                        ? "cursor-not-allowed opacity-70"
                                        : ""
                                    }`}
                                  >
                                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                                      {getProfileIcon(profile)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="text-sm font-medium text-[var(--text-primary)]">
                                          {profile.label}
                                        </div>
                                        <span className="rounded-full border border-[var(--border-subtle)] bg-transparent px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                          {profile.kind}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                                        {profile.description}
                                      </div>
                                      {profile.command && (
                                        <div className="mt-2 truncate font-mono text-[11px] text-[var(--text-secondary)]">
                                          {profile.command}
                                        </div>
                                      )}
                                      {isUnavailable && (
                                        <div className="mt-2 text-[11px] text-[var(--status-warning)]">
                                          Missing tools:{" "}
                                          {missingTools.join(", ")}
                                        </div>
                                      )}
                                    </div>
                                    {!isUnavailable && (
                                      <div className="mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                        Enter
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-[18px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-4 text-sm text-[var(--text-muted)]">
                              No suggested {title.toLowerCase()} profiles for
                              the current context.
                            </div>
                          )}
                        </div>
                      </div>

                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleExecuteCustom();
                        }}
                      >
                        <div className={sectionLabelClass}>Custom Command</div>
                        <div className="mt-2">
                          <div className="mb-3 text-[13px] text-[var(--text-muted)]">
                            Run a one-off command in the current execution mode.
                          </div>
                          <Input
                            value={customCommand}
                            onChange={(event) =>
                              setCustomCommand(event.target.value)
                            }
                            placeholder={
                              mode === "debug"
                                ? "dlv debug ./cmd/api"
                                : "go run ./cmd/api/main.go"
                            }
                            className={`${inputShellClass} min-h-12 w-full px-4 text-[16px]`}
                          />
                          <div className="mt-5 flex justify-end">
                            <button
                              type="submit"
                              disabled={!mode || customCommand.trim() === ""}
                              className={bubbleActionButtonClass}
                            >
                              {mode === "debug"
                                ? "Start Debug Command"
                                : "Run Command"}
                            </button>
                          </div>
                        </div>
                      </form>

                      <div className="flex justify-end text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span>{actionProfiles.length} suggested profiles</span>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
