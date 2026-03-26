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
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-2xl outline-none"
          data-testid="execution-dialog"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                {actionIcon}
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold text-[var(--text-primary)]">
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
                className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                aria-label="Close execution dialog"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-5 px-5 py-5">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Profiles
              </div>
              {actionProfiles.length > 0 ? (
                <div className="space-y-2">
                  {actionProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => {
                        onExecuteProfile(profile);
                      }}
                      className="flex w-full items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-tertiary)]"
                    >
                      <div className="mt-0.5 text-[var(--text-secondary)]">
                        {getProfileIcon(profile)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {profile.label}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {profile.description}
                        </div>
                        {profile.command && (
                          <div className="mt-2 truncate font-mono text-[11px] text-[var(--text-secondary)]">
                            {profile.command}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--text-muted)]">
                  No suggested {title.toLowerCase()} profiles for the current
                  context.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Custom Command
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
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
              <div className="flex justify-end">
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
