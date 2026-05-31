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

const getFontScaleRoots = (): HTMLElement[] =>
  document.body ? [document.body] : [];

const collectFontScaleCandidates = (
  roots: readonly HTMLElement[],
): HTMLElement[] => {
  const candidates = new Set<HTMLElement>();
  roots.forEach((root) => {
    if (isTextScaleCandidate(root)) {
      candidates.add(root);
    }
    root.querySelectorAll("*").forEach((element) => {
      if (isTextScaleCandidate(element)) {
        candidates.add(element);
      }
    });
  });

  return [...candidates];
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
  const pendingScaleRoots = new Set<HTMLElement>();
  let cancelled = false;
  let scheduled = false;
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
      return callback();
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

  const restoreScaledElementsInRoots = (
    roots: readonly HTMLElement[],
  ): void => {
    roots.forEach((root) => {
      restoreScaledElement(root);
      root
        .querySelectorAll<HTMLElement>(`[${SCALED_INLINE_FONT_SIZE_ATTRIBUTE}]`)
        .forEach(restoreScaledElement);
    });
  };

  const scaleElement = (element: HTMLElement): void => {
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
  };

  const applyScale = (roots: readonly HTMLElement[]) => {
    if (cancelled) {
      return;
    }

    restoreScaledElementsInRoots(roots);
    collectFontScaleCandidates(roots).forEach(scaleElement);
  };

  const scheduleApplyScale = (roots: readonly HTMLElement[]) => {
    if (cancelled) {
      return;
    }

    roots.forEach((root) => pendingScaleRoots.add(root));
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      const rootsToScale = [...pendingScaleRoots];
      pendingScaleRoots.clear();
      applyScale(rootsToScale);
    });
  };

  const collectMutationScaleRoots = (
    mutations: readonly MutationRecord[],
  ): HTMLElement[] => {
    const roots = new Set<HTMLElement>();
    mutations.forEach((mutation) => {
      if (isExcludedMutation(mutation)) {
        return;
      }

      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          roots.add(node);
        } else if (node.parentElement) {
          roots.add(node.parentElement);
        }
      });
    });
    return [...roots];
  };

  const observer = new MutationObserver((mutations) => {
    const roots = collectMutationScaleRoots(mutations);
    if (roots.length === 0) {
      return;
    }
    scheduleApplyScale(roots);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  scheduleApplyScale(getFontScaleRoots());

  return () => {
    cancelled = true;
    observer.disconnect();
    restoreScaledElements(true);
    document.documentElement.style.removeProperty("--ui-font-size");
    document.documentElement.style.removeProperty("--ui-font-scale");
  };
};
