import React, { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Play, Bug, TerminalSquare, Globe, X } from "lucide-react";

import { Button, Input } from "./ui";
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
    <Bug size={14} />
  ) : (
    <TerminalSquare size={14} />
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

  const sectionLabelClass =
    "text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]";
  const rowClass =
    "group flex w-full items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-3 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]";

  const title = mode === "debug" ? "Debug" : "Run";
  const actionIcon = mode === "debug" ? <Bug size={16} /> : <Play size={16} />;

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
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-[8px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[18px] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-overlay)] outline-none"
          data-testid="execution-dialog"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-primary)]">
                {actionIcon}
              </div>
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Execution
                </div>
                <Dialog.Title className="text-[15px] font-semibold text-[var(--text-primary)]">
                  {title}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-[var(--text-muted)]">
                  {activeFileName
                    ? `Current context: ${activeFileName}`
                    : "Choose a profile or enter a command"}
                </Dialog.Description>
              </div>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="topbar-control-button flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_4px_var(--focus-ring-strong)]"
                aria-label="Close execution dialog"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-6 px-5 py-5">
            <div className="space-y-3">
              <div className={sectionLabelClass}>Profiles</div>
              {actionProfiles.length > 0 ? (
                <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
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
                        className={`w-full ${rowClass} rounded-none border-x-0 border-t-0 px-4 py-3 ${
                          isUnavailable ? "cursor-not-allowed opacity-70" : ""
                        }`}
                      >
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
                          {getProfileIcon(profile)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-[var(--text-primary)]">
                              {profile.label}
                            </div>
                            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
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
                              Missing tools: {missingTools.join(", ")}
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
                <div className="rounded-[14px] border border-dashed border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-4 text-sm text-[var(--text-muted)]">
                  No suggested {title.toLowerCase()} profiles for the current
                  context.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className={sectionLabelClass}>Custom Command</div>
              <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
                <div className="mb-3 text-xs text-[var(--text-muted)]">
                  Run a one-off command in the current execution mode.
                </div>
                <Input
                  value={customCommand}
                  onChange={(event) => setCustomCommand(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleExecuteCustom();
                    }
                  }}
                  placeholder={
                    mode === "debug"
                      ? "dlv debug ./cmd/api"
                      : "go run ./cmd/api/main.go"
                  }
                  className="w-full"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Press Enter to submit
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!mode || customCommand.trim() === ""}
                    onClick={handleExecuteCustom}
                  >
                    {mode === "debug" ? "Start Debug Command" : "Run Command"}
                  </Button>
                </div>
              </div>
              <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <span>Esc to close</span>
                <span>{actionProfiles.length} suggested profiles</span>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
