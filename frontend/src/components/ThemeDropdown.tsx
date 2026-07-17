import React, { useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Plus, X } from "lucide-react";

import { useTheme } from "../hooks/useTheme";
import { themeOptions as builtInThemeOptions } from "../styles/themes";
import type { CustomThemeId, IDEThemeDefinition } from "../styles/themes";
import type { Theme, ThemeTransitionOrigin } from "../types/theme";
import { MotionDropdownContent } from "./ui/MotionDropdownContent";

type ThemeOption = {
  value: Theme;
  label: string;
  appearance: "auto" | "light" | "dark";
};

type CustomThemeOption = Omit<ThemeOption, "value"> & {
  value: CustomThemeId;
  isCustom: true;
};

type CustomThemeImportStatus = {
  tone: "success" | "error";
  message: string;
};

export type CustomThemeImportController = {
  inputRef: React.RefObject<HTMLInputElement | null>;
  status: CustomThemeImportStatus | null;
  openFilePicker: () => void;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

export const themeDropdownTriggerClass =
  "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 text-left text-[13px] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-default)] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] data-[state=open]:border-[var(--border-default)]";
export const themeDropdownContentClass =
  "z-[130] overflow-y-auto overscroll-contain rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-2 shadow-[var(--shadow-overlay)]";
export const themeDropdownItemClass =
  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[14px] px-4 text-[15px] text-[var(--text-secondary)] outline-none transition-colors data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--text-primary)]";
export const themeActionButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-45";

export const themeImportStatusClass = (tone: CustomThemeImportStatus["tone"]) =>
  `mt-3 rounded-[14px] border px-3 py-2 text-[12px] ${
    tone === "success"
      ? "border-[var(--status-success-border)] bg-[var(--status-success-surface)] text-[var(--status-success-text)]"
      : "border-[var(--status-error-border)] bg-[var(--status-error-surface)] text-[var(--status-error-text)]"
  }`;

const settingsThemeOptions: ThemeOption[] = [
  { value: "system", label: "System", appearance: "auto" },
  ...builtInThemeOptions,
];

const themeDropdownOptionOriginOffsetPx = 35;

const resolveThemeDropdownOptionOrigin = (
  eventElement: HTMLElement,
): ThemeTransitionOrigin | undefined => {
  const rect = eventElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  const inlineOffset = Math.min(
    themeDropdownOptionOriginOffsetPx,
    rect.width / 2,
  );
  const isRtl = getComputedStyle(eventElement).direction === "rtl";

  return {
    x: isRtl ? rect.right - inlineOffset : rect.left + inlineOffset,
    y: rect.top + rect.height / 2,
  };
};

const resolveThemeDropdownSelectOrigin = (
  event: Event,
): ThemeTransitionOrigin | undefined => {
  const eventElement =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[role="menuitem"]')
        : null;

  return eventElement
    ? resolveThemeDropdownOptionOrigin(eventElement)
    : undefined;
};

const resolveThemeDropdownValueOrigin = (
  value: Theme,
): ThemeTransitionOrigin | undefined => {
  const optionElement = Array.from(
    document.querySelectorAll<HTMLElement>("[data-theme-option-value]"),
  ).find((element) => element.dataset.themeOptionValue === value);

  return optionElement
    ? resolveThemeDropdownOptionOrigin(optionElement)
    : undefined;
};

const createCustomThemeOptions = (
  customThemes: IDEThemeDefinition[],
): CustomThemeOption[] =>
  customThemes.map((customTheme) => ({
    value: customTheme.id as CustomThemeId,
    label: customTheme.name,
    appearance: customTheme.appearance,
    isCustom: true,
  }));

export const useSelectedThemeLabel = () => {
  const { theme, customThemes } = useTheme();
  const customThemeOptions = useMemo(
    () => createCustomThemeOptions(customThemes),
    [customThemes],
  );

  return useMemo(() => {
    const options = [...settingsThemeOptions, ...customThemeOptions];
    return options.find((option) => option.value === theme)?.label ?? "System";
  }, [customThemeOptions, theme]);
};

export const useCustomThemeImport = (): CustomThemeImportController => {
  const { setTheme, addCustomTheme } = useTheme();
  const [status, setStatus] = useState<CustomThemeImportStatus | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    try {
      const rawTheme = JSON.parse(await file.text());
      const importedTheme = addCustomTheme(rawTheme, file.name);
      setTheme(importedTheme.id as Theme);
      setStatus({
        tone: "success",
        message: `Added ${importedTheme.name}`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Unable to import theme.",
      });
    }
  };

  return {
    inputRef,
    status,
    openFilePicker,
    handleFileChange,
  };
};

type ThemeDropdownProps = {
  triggerClassName?: string;
  contentClassName?: string;
  itemClassName?: string;
  triggerTestId?: string;
  contentTestId?: string;
  ariaLabel?: string;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  contentWidth?: React.CSSProperties["width"];
  maxHeight?: string;
  customThemeImport?: CustomThemeImportController;
};

export const ThemeDropdown: React.FC<ThemeDropdownProps> = ({
  triggerClassName = themeDropdownTriggerClass,
  contentClassName = themeDropdownContentClass,
  itemClassName = themeDropdownItemClass,
  triggerTestId = "theme-dropdown-trigger",
  contentTestId = "theme-dropdown-content",
  ariaLabel = "Select theme",
  align = "start",
  sideOffset = 8,
  contentWidth = "var(--radix-dropdown-menu-trigger-width)",
  maxHeight = "min(480px, var(--radix-dropdown-menu-content-available-height))",
  customThemeImport,
}) => {
  const { theme, setTheme, customThemes, removeCustomTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const optionElementsRef = useRef<Map<Theme, HTMLElement>>(new Map());
  const optionOriginsRef = useRef<Map<Theme, ThemeTransitionOrigin>>(new Map());
  const selectionOriginRef = useRef<{
    value: Theme;
    origin: ThemeTransitionOrigin;
  } | null>(null);
  const customThemeOptions = useMemo(
    () => createCustomThemeOptions(customThemes),
    [customThemes],
  );
  const selectedThemeLabel = useSelectedThemeLabel();

  const rememberOptionElement = (value: Theme, element: HTMLElement | null) => {
    if (!element) {
      return;
    }

    optionElementsRef.current.set(value, element);
    const rememberOrigin = () => {
      const origin = resolveThemeDropdownOptionOrigin(element);
      if (origin) {
        optionOriginsRef.current.set(value, origin);
      }
    };

    rememberOrigin();
    window.requestAnimationFrame(rememberOrigin);
  };

  const rememberSelectionOrigin = (value: Theme, element: HTMLElement) => {
    const origin = resolveThemeDropdownOptionOrigin(element);
    if (origin) {
      selectionOriginRef.current = { value, origin };
      optionOriginsRef.current.set(value, origin);
    }
  };

  const rememberCursorOrigin = (
    value: Theme,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (!event.isPrimary) {
      return;
    }

    const origin = {
      x: event.clientX,
      y: event.clientY,
    };
    selectionOriginRef.current = { value, origin };
    optionOriginsRef.current.set(value, origin);
  };

  const rememberSelectionOriginFromEvent = (
    event: React.PointerEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
  ) => {
    const optionElement =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-theme-option-value]")
        : null;
    const optionValue = optionElement?.dataset.themeOptionValue as
      Theme | undefined;

    if (optionElement && optionValue) {
      rememberSelectionOrigin(optionValue, optionElement);
    }
  };

  const rememberCursorOriginFromEvent = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const optionElement =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-theme-option-value]")
        : null;
    const optionValue = optionElement?.dataset.themeOptionValue as
      Theme | undefined;

    if (optionValue) {
      rememberCursorOrigin(optionValue, event);
    }
  };

  const resolveSelectionOrigin = (
    value: Theme,
  ): ThemeTransitionOrigin | undefined => {
    const selectionOrigin = selectionOriginRef.current;
    return selectionOrigin?.value === value
      ? selectionOrigin.origin
      : undefined;
  };

  const resolveStoredOrigin = (
    value: Theme,
  ): ThemeTransitionOrigin | undefined => {
    const element = optionElementsRef.current.get(value);
    const elementOrigin = element
      ? resolveThemeDropdownOptionOrigin(element)
      : undefined;

    return (
      elementOrigin ??
      resolveThemeDropdownValueOrigin(value) ??
      optionOriginsRef.current.get(value)
    );
  };

  const handleThemeSelect = (nextTheme: Theme, event?: Event) => {
    const transitionOrigin =
      resolveSelectionOrigin(nextTheme) ??
      resolveStoredOrigin(nextTheme) ??
      (event ? resolveThemeDropdownSelectOrigin(event) : undefined);

    selectionOriginRef.current = null;

    setTheme(nextTheme, transitionOrigin ? { transitionOrigin } : undefined);
  };

  const handleCustomThemeRemove = (themeOption: CustomThemeOption) => {
    optionElementsRef.current.delete(themeOption.value);
    optionOriginsRef.current.delete(themeOption.value);
    if (selectionOriginRef.current?.value === themeOption.value) {
      selectionOriginRef.current = null;
    }
    removeCustomTheme(themeOption.value);
  };

  const renderThemeOption = (option: ThemeOption) => (
    <DropdownMenu.Item
      key={option.value}
      data-theme-option-value={option.value}
      ref={(element) => rememberOptionElement(option.value, element)}
      onPointerDown={(event) => rememberCursorOrigin(option.value, event)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          rememberSelectionOrigin(option.value, event.currentTarget);
        }
      }}
      onSelect={(event) => handleThemeSelect(option.value, event)}
      className={`${itemClassName} w-full min-w-0`}
    >
      <Check
        size={14}
        className={
          theme === option.value
            ? "text-[var(--text-primary)]"
            : "text-transparent"
        }
      />
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      <span className="text-[13px] capitalize text-[var(--text-muted)]">
        {option.appearance}
      </span>
    </DropdownMenu.Item>
  );

  const renderCustomThemeOption = (option: CustomThemeOption) => (
    <div
      key={option.value}
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-1"
    >
      {renderThemeOption(option)}
      <DropdownMenu.Item
        aria-label={`Remove ${option.label}`}
        title={`Remove ${option.label}`}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[14px] text-[var(--text-muted)] outline-none transition-colors data-[highlighted]:bg-[var(--status-error-surface)] data-[highlighted]:text-[var(--status-error-text)] focus-visible:bg-[var(--status-error-surface)] focus-visible:text-[var(--status-error-text)] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
        onSelect={(event) => {
          event.preventDefault();
          handleCustomThemeRemove(option);
        }}
      >
        <X size={15} aria-hidden="true" />
      </DropdownMenu.Item>
    </div>
  );

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={triggerClassName}
          aria-label={ariaLabel}
          data-testid={triggerTestId}
        >
          <span className="min-w-0 truncate">{selectedThemeLabel}</span>
          <ChevronDown
            size={15}
            className="shrink-0 text-[var(--text-muted)]"
          />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <MotionDropdownContent
          align={align}
          sideOffset={sideOffset}
          className={contentClassName}
          data-testid={contentTestId}
          data-shell-menu-content
          onPointerDownCapture={rememberCursorOriginFromEvent}
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              rememberSelectionOriginFromEvent(event);
            }
          }}
          style={{
            width: contentWidth,
            maxHeight,
          }}
        >
          <DropdownMenu.Label className="px-4 py-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Built-in themes
          </DropdownMenu.Label>
          {settingsThemeOptions.map(renderThemeOption)}

          <DropdownMenu.Separator className="my-2 h-px bg-[var(--shell-inline-divider)]" />
          <DropdownMenu.Label className="px-4 py-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Custom themes
          </DropdownMenu.Label>
          {customThemeOptions.length > 0 ? (
            customThemeOptions.map(renderCustomThemeOption)
          ) : (
            <div className="px-4 py-2 text-[13px] text-[var(--text-muted)]">
              No custom themes added
            </div>
          )}

          {customThemeImport ? (
            <>
              <DropdownMenu.Separator className="my-2 h-px bg-[var(--shell-inline-divider)]" />
              <DropdownMenu.Item
                className={itemClassName}
                onSelect={() => customThemeImport.openFilePicker()}
              >
                <Plus size={14} />
                <span className="min-w-0 flex-1 truncate">
                  Add custom theme
                </span>
              </DropdownMenu.Item>
            </>
          ) : null}
        </MotionDropdownContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
