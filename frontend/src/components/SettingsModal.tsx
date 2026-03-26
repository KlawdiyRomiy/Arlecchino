import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { Settings, X } from "lucide-react";

import { useTheme } from "../hooks/useTheme";
import { useBrowserPreviewStore } from "../stores/browserPreviewStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import type { Theme } from "../types/theme";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const themeOptions: Array<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const SwitchRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}> = ({ title, description, checked, onCheckedChange }) => (
  <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
    <div>
      <div className="text-sm font-medium text-[var(--text-primary)]">
        {title}
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{description}</div>
    </div>
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative h-6 w-11 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] transition-colors data-[state=checked]:bg-[var(--accent-primary)]"
    >
      <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  </div>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { theme, setTheme } = useTheme();
  const {
    uiScale,
    editorFontSize,
    minFontSize,
    maxFontSize,
    setUiScale,
    setEditorFontSize,
    resetZoom,
  } = useEditorSettingsStore();
  const {
    autoOpenFromTerminal,
    reuseWindowPerSession,
    closeAutoOpenedOnTerminalExit,
    setAutoOpenFromTerminal,
    setReuseWindowPerSession,
    setCloseAutoOpenedOnTerminalExit,
  } = useBrowserPreviewStore();

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-2xl outline-none"
          data-testid="settings-modal"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                <Settings size={16} />
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold text-[var(--text-primary)]">
                  Settings
                </Dialog.Title>
                <Dialog.Description className="text-xs text-[var(--text-muted)]">
                  Editor, appearance, and preview preferences.
                </Dialog.Description>
              </div>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                aria-label="Close settings"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid gap-5 px-5 py-5 md:grid-cols-[1.1fr,0.9fr]">
            <div className="space-y-5">
              <section className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Appearance
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Theme
                  </div>
                  <RadioGroup.Root
                    value={theme}
                    onValueChange={(value) => setTheme(value as Theme)}
                    className="mt-3 grid gap-2 sm:grid-cols-3"
                  >
                    {themeOptions.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)]"
                      >
                        <RadioGroup.Item
                          value={option.value}
                          className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-strong)]"
                        >
                          <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                        </RadioGroup.Item>
                        {option.label}
                      </label>
                    ))}
                  </RadioGroup.Root>
                </div>
              </section>

              <section className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Editor
                </div>
                <div className="space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
                  <label className="block text-sm font-medium text-[var(--text-primary)]">
                    Editor Font Size
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="range"
                        min={minFontSize}
                        max={maxFontSize}
                        value={editorFontSize}
                        onChange={(event) =>
                          setEditorFontSize(Number(event.target.value))
                        }
                        className="w-full"
                      />
                      <span className="w-10 text-right font-mono text-xs text-[var(--text-muted)]">
                        {editorFontSize}px
                      </span>
                    </div>
                  </label>

                  <label className="block text-sm font-medium text-[var(--text-primary)]">
                    UI Scale
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="range"
                        min={0.8}
                        max={1.4}
                        step={0.05}
                        value={uiScale}
                        onChange={(event) =>
                          setUiScale(Number(event.target.value))
                        }
                        className="w-full"
                      />
                      <span className="w-12 text-right font-mono text-xs text-[var(--text-muted)]">
                        {Math.round(uiScale * 100)}%
                      </span>
                    </div>
                  </label>

                  <button
                    type="button"
                    onClick={resetZoom}
                    className="rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    Reset Zoom
                  </button>
                </div>
              </section>
            </div>

            <section className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Browser Preview
              </div>
              <div className="space-y-3">
                <SwitchRow
                  title="Auto-open Preview"
                  description="Open browser preview automatically when the terminal reports a local URL."
                  checked={autoOpenFromTerminal}
                  onCheckedChange={setAutoOpenFromTerminal}
                />
                <SwitchRow
                  title="Reuse Session Window"
                  description="Keep one preview window per terminal session instead of spawning new ones."
                  checked={reuseWindowPerSession}
                  onCheckedChange={setReuseWindowPerSession}
                />
                <SwitchRow
                  title="Close on Session Exit"
                  description="Close auto-opened preview windows when the terminal session ends."
                  checked={closeAutoOpenedOnTerminalExit}
                  onCheckedChange={setCloseAutoOpenedOnTerminalExit}
                />
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
