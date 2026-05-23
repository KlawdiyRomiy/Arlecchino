const SYSTEM_FONT_SCALE_EPSILON = 0.001;
const SYSTEM_FONT_SCALE_DECIMALS = 1000;
const SYSTEM_FONT_SIZE_DECIMALS = 100;
const ORIGINAL_INLINE_FONT_SIZE_ATTRIBUTE =
  "data-ui-font-scale-original-inline-size";
const SCALED_INLINE_FONT_SIZE_ATTRIBUTE =
  "data-ui-font-scale-scaled-inline-size";
interface ScaledFontElementState {
  originalInlineFontSize: string;
  scaledInlineFontSize: string;
}

const scaledFontElementState = new WeakMap<
  HTMLElement,
  ScaledFontElementState
>();
const TEXT_CONTROL_SELECTOR = [
  "textarea",
  "select",
  "input:not([type])",
  'input[type="email"]',
  'input[type="number"]',
  'input[type="password"]',
  'input[type="search"]',
  'input[type="tel"]',
  'input[type="text"]',
  'input[type="url"]',
].join(", ");
const EXCLUDED_TEXT_SCALE_SELECTOR = [
  "[data-ui-font-scale-exempt]",
  ".cm-editor",
  ".cm-tooltip",
  ".cm-panel",
  ".cm-panels",
  ".xterm",
  ".xterm-helper-textarea",
].join(", ");

const hasDirectTextContent = (element: HTMLElement): boolean => {
  for (const node of element.childNodes) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      node.textContent !== null &&
      node.textContent.trim().length > 0
    ) {
      return true;
    }
  }

  return false;
};

const isTextScaleCandidate = (element: Element): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.closest(EXCLUDED_TEXT_SCALE_SELECTOR)) {
    return false;
  }

  return (
    element.matches(TEXT_CONTROL_SELECTOR) || hasDirectTextContent(element)
  );
};

const getFontScaleRoots = (): HTMLElement[] => {
  return [document.body];
};

const collectFontScaleCandidates = (): HTMLElement[] => {
  const candidates: HTMLElement[] = [];
  getFontScaleRoots().forEach((root) => {
    root.querySelectorAll("*").forEach((element) => {
      if (isTextScaleCandidate(element)) {
        candidates.push(element);
      }
    });
  });

  return candidates;
};

const isExcludedMutation = (mutation: MutationRecord): boolean => {
  const target =
    mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;

  return target?.closest(EXCLUDED_TEXT_SCALE_SELECTOR) !== null;
};

const formatScale = (scale: number): string =>
  String(
    Math.round(scale * SYSTEM_FONT_SCALE_DECIMALS) / SYSTEM_FONT_SCALE_DECIMALS,
  );

const formatFontSize = (fontSize: number): string =>
  `${Math.round(fontSize * SYSTEM_FONT_SIZE_DECIMALS) / SYSTEM_FONT_SIZE_DECIMALS}px`;

const setInlineFontSize = (
  element: HTMLElement,
  inlineFontSize: string,
): void => {
  if (inlineFontSize) {
    element.style.fontSize = inlineFontSize;
  } else {
    element.style.removeProperty("font-size");
  }
};

export const createSystemFontSizeScaler = (
  uiFontSize: number,
  defaultUiFontSize: number,
): (() => void) => {
  const scaledElements = new Set<HTMLElement>();
  let cancelled = false;
  let scheduled = false;
  let applying = false;
  const scale =
    defaultUiFontSize > 0 ? Math.max(uiFontSize / defaultUiFontSize, 0) : 1;

  document.documentElement.style.setProperty(
    "--ui-font-size",
    formatFontSize(uiFontSize),
  );
  document.documentElement.style.setProperty(
    "--ui-font-scale",
    formatScale(scale),
  );

  if (Math.abs(scale - 1) <= SYSTEM_FONT_SCALE_EPSILON) {
    return () => {
      document.documentElement.style.removeProperty("--ui-font-size");
      document.documentElement.style.removeProperty("--ui-font-scale");
    };
  }

  const readScaledElementState = (
    element: HTMLElement,
  ): ScaledFontElementState | null => {
    const weakState = scaledFontElementState.get(element);
    if (weakState) {
      return weakState;
    }

    const scaledInlineFontSize = element.getAttribute(
      SCALED_INLINE_FONT_SIZE_ATTRIBUTE,
    );
    if (scaledInlineFontSize === null) {
      return null;
    }

    return {
      originalInlineFontSize:
        element.getAttribute(ORIGINAL_INLINE_FONT_SIZE_ATTRIBUTE) ?? "",
      scaledInlineFontSize,
    };
  };

  const withTransitionSuppressed = <T>(
    element: HTMLElement,
    callback: () => T,
  ): T => {
    const originalTransition = element.style.transition;
    element.style.transition = "none";
    try {
      const result = callback();
      void element.offsetWidth;
      return result;
    } finally {
      if (originalTransition) {
        element.style.transition = originalTransition;
      } else {
        element.style.removeProperty("transition");
      }
    }
  };

  const restoreScaledElement = (element: HTMLElement): void => {
    const scaledState = readScaledElementState(element);
    if (!scaledState) {
      return;
    }

    if (
      element.style.fontSize !== scaledState.scaledInlineFontSize &&
      element.style.fontSize !== scaledState.originalInlineFontSize
    ) {
      return;
    }

    withTransitionSuppressed(element, () =>
      setInlineFontSize(element, scaledState.originalInlineFontSize),
    );
  };

  const restoreScaledElements = (forget: boolean) => {
    const elementsToRestore = new Set<HTMLElement>([
      ...scaledElements,
      ...Array.from(
        document.querySelectorAll<HTMLElement>(
          `[${SCALED_INLINE_FONT_SIZE_ATTRIBUTE}]`,
        ),
      ),
    ]);

    elementsToRestore.forEach((element) => {
      restoreScaledElement(element);
      if (forget) {
        scaledFontElementState.delete(element);
        element.removeAttribute(ORIGINAL_INLINE_FONT_SIZE_ATTRIBUTE);
        element.removeAttribute(SCALED_INLINE_FONT_SIZE_ATTRIBUTE);
      }
    });
    scaledElements.clear();
  };

  const applyScale = () => {
    if (cancelled) {
      return;
    }

    applying = true;
    restoreScaledElements(false);

    collectFontScaleCandidates().forEach((element) => {
      restoreScaledElement(element);

      const originalInlineFontSize = element.style.fontSize;
      const scaledInlineFontSize = withTransitionSuppressed(element, () => {
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
        if (!Number.isFinite(fontSize) || fontSize <= 0) {
          return null;
        }

        const scaled = formatFontSize(fontSize * scale);
        element.style.fontSize = scaled;
        return scaled;
      });
      if (scaledInlineFontSize === null) {
        return;
      }

      scaledFontElementState.set(element, {
        originalInlineFontSize,
        scaledInlineFontSize,
      });
      element.setAttribute(
        ORIGINAL_INLINE_FONT_SIZE_ATTRIBUTE,
        originalInlineFontSize,
      );
      element.setAttribute(
        SCALED_INLINE_FONT_SIZE_ATTRIBUTE,
        scaledInlineFontSize,
      );
      scaledElements.add(element);
    });

    applying = false;
  };

  const scheduleApplyScale = () => {
    if (cancelled || applying || scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      applyScale();
    });
  };

  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isExcludedMutation)) {
      return;
    }
    scheduleApplyScale();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  scheduleApplyScale();

  return () => {
    cancelled = true;
    observer.disconnect();
    restoreScaledElements(true);
    document.documentElement.style.removeProperty("--ui-font-size");
    document.documentElement.style.removeProperty("--ui-font-scale");
  };
};
