import { useCallback, useEffect, useMemo, useRef } from "react";
import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { createCodeMirrorScrollGuard } from "../utils/codeMirrorScrollGuard";

const EMPTY_ADAPTIVE_EXTENSIONS: Extension[] = [];

interface ScrollSnapshot {
  left: number;
  top: number;
}

const readScrollSnapshot = (view: EditorView): ScrollSnapshot => ({
  left: view.scrollDOM.scrollLeft,
  top: view.scrollDOM.scrollTop,
});

const restoreScrollSnapshot = (view: EditorView, snapshot: ScrollSnapshot) => {
  const restore = () => {
    if (view.scrollDOM.scrollLeft !== snapshot.left) {
      view.scrollDOM.scrollLeft = snapshot.left;
    }
    if (view.scrollDOM.scrollTop !== snapshot.top) {
      view.scrollDOM.scrollTop = snapshot.top;
    }
  };

  restore();
  window.requestAnimationFrame(restore);
};

export const useCodeMirrorAdaptiveExtensions = (
  adaptiveExtensions: Extension[],
  adaptiveExtensionsKey?: string,
) => {
  const compartmentRef = useRef(new Compartment());
  const viewRef = useRef<EditorView | null>(null);
  const scrollingRef = useRef(false);
  const latestExtensionsRef = useRef(adaptiveExtensions);
  const latestExtensionsKeyRef = useRef<unknown>(
    adaptiveExtensionsKey ?? adaptiveExtensions,
  );
  const pendingExtensionsRef = useRef<Extension[] | null>(adaptiveExtensions);
  const pendingExtensionsKeyRef = useRef<unknown>(
    adaptiveExtensionsKey ?? adaptiveExtensions,
  );
  const pendingForceRef = useRef(false);
  const appliedExtensionsRef = useRef<Extension[] | null>(null);
  const appliedExtensionsKeyRef = useRef<unknown>(null);
  const reconfigureCountRef = useRef(0);

  const applyExtensions = useCallback(
    (extensions: Extension[], force = false, key?: string) => {
      const extensionsKey = key ?? extensions;
      latestExtensionsRef.current = extensions;
      latestExtensionsKeyRef.current = extensionsKey;

      const view = viewRef.current;
      if (!view) {
        pendingExtensionsRef.current = extensions;
        pendingExtensionsKeyRef.current = extensionsKey;
        pendingForceRef.current = force;
        return;
      }
      if (scrollingRef.current) {
        pendingExtensionsRef.current = extensions;
        pendingExtensionsKeyRef.current = extensionsKey;
        pendingForceRef.current = pendingForceRef.current || force;
        return;
      }
      if (
        appliedExtensionsRef.current !== null &&
        Object.is(appliedExtensionsKeyRef.current, extensionsKey)
      ) {
        pendingExtensionsRef.current = null;
        pendingExtensionsKeyRef.current = null;
        pendingForceRef.current = false;
        return;
      }

      pendingExtensionsRef.current = null;
      pendingExtensionsKeyRef.current = null;
      pendingForceRef.current = false;
      appliedExtensionsRef.current = extensions;
      appliedExtensionsKeyRef.current = extensionsKey;
      const scrollSnapshot = readScrollSnapshot(view);
      view.dispatch({
        effects: compartmentRef.current.reconfigure(extensions),
      });
      reconfigureCountRef.current += 1;
      view.dom.dataset.adaptiveReconfigureCount = String(
        reconfigureCountRef.current,
      );
      if (typeof extensionsKey === "string") {
        view.dom.dataset.adaptiveExtensionsKey = extensionsKey;
      }
      restoreScrollSnapshot(view, scrollSnapshot);
    },
    [],
  );

  const flushPendingExtensions = useCallback(() => {
    scrollingRef.current = false;
    const pendingExtensions = pendingExtensionsRef.current;
    const pendingExtensionsKey = pendingExtensionsKeyRef.current;
    const pendingForce = pendingForceRef.current;
    if (pendingExtensions) {
      applyExtensions(
        pendingExtensions,
        pendingForce,
        typeof pendingExtensionsKey === "string"
          ? pendingExtensionsKey
          : undefined,
      );
      return;
    }
    applyExtensions(
      latestExtensionsRef.current,
      false,
      typeof latestExtensionsKeyRef.current === "string"
        ? latestExtensionsKeyRef.current
        : undefined,
    );
  }, [applyExtensions]);

  const scrollGuardExtension = useMemo(
    () =>
      createCodeMirrorScrollGuard({
        onScrollStart: () => {
          scrollingRef.current = true;
        },
        onScrollIdle: flushPendingExtensions,
      }),
    [flushPendingExtensions],
  );

  const adaptiveCompartmentExtension = useMemo(
    () => compartmentRef.current.of(EMPTY_ADAPTIVE_EXTENSIONS),
    [],
  );

  const bindEditorView = useCallback(
    (view: EditorView) => {
      if (viewRef.current !== view) {
        appliedExtensionsRef.current = null;
        appliedExtensionsKeyRef.current = null;
        reconfigureCountRef.current = 0;
      }
      viewRef.current = view;
      applyExtensions(
        latestExtensionsRef.current,
        true,
        typeof latestExtensionsKeyRef.current === "string"
          ? latestExtensionsKeyRef.current
          : undefined,
      );
    },
    [applyExtensions],
  );

  const reapplyAdaptiveExtensions = useCallback(() => {
    window.requestAnimationFrame(() => {
      applyExtensions(
        latestExtensionsRef.current,
        true,
        typeof latestExtensionsKeyRef.current === "string"
          ? latestExtensionsKeyRef.current
          : undefined,
      );
    });
  }, [applyExtensions]);

  useEffect(() => {
    applyExtensions(adaptiveExtensions, false, adaptiveExtensionsKey);
  }, [adaptiveExtensions, adaptiveExtensionsKey, applyExtensions]);

  useEffect(
    () => () => {
      viewRef.current = null;
      pendingExtensionsRef.current = null;
      pendingExtensionsKeyRef.current = null;
      pendingForceRef.current = false;
      appliedExtensionsRef.current = null;
      appliedExtensionsKeyRef.current = null;
    },
    [],
  );

  return {
    adaptiveCompartmentExtension,
    bindEditorView,
    reapplyAdaptiveExtensions,
    scrollGuardExtension,
  };
};
