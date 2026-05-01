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
) => {
  const compartmentRef = useRef(new Compartment());
  const viewRef = useRef<EditorView | null>(null);
  const scrollingRef = useRef(false);
  const latestExtensionsRef = useRef(adaptiveExtensions);
  const pendingExtensionsRef = useRef<Extension[] | null>(adaptiveExtensions);
  const pendingForceRef = useRef(false);
  const appliedExtensionsRef = useRef<Extension[] | null>(null);

  const applyExtensions = useCallback(
    (extensions: Extension[], force = false) => {
      latestExtensionsRef.current = extensions;

      const view = viewRef.current;
      if (!view) {
        pendingExtensionsRef.current = extensions;
        pendingForceRef.current = force;
        return;
      }
      if (scrollingRef.current) {
        pendingExtensionsRef.current = extensions;
        pendingForceRef.current = pendingForceRef.current || force;
        return;
      }
      if (appliedExtensionsRef.current === extensions) {
        pendingExtensionsRef.current = null;
        pendingForceRef.current = false;
        if (!force) {
          return;
        }
      }

      pendingExtensionsRef.current = null;
      pendingForceRef.current = false;
      appliedExtensionsRef.current = extensions;
      const scrollSnapshot = readScrollSnapshot(view);
      view.dispatch({
        effects: compartmentRef.current.reconfigure(extensions),
      });
      restoreScrollSnapshot(view, scrollSnapshot);
    },
    [],
  );

  const flushPendingExtensions = useCallback(() => {
    scrollingRef.current = false;
    const pendingExtensions = pendingExtensionsRef.current;
    const pendingForce = pendingForceRef.current;
    if (pendingExtensions) {
      applyExtensions(pendingExtensions, pendingForce);
      return;
    }
    applyExtensions(latestExtensionsRef.current);
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
      viewRef.current = view;
      applyExtensions(latestExtensionsRef.current, true);
    },
    [applyExtensions],
  );

  const reapplyAdaptiveExtensions = useCallback(() => {
    window.requestAnimationFrame(() => {
      applyExtensions(latestExtensionsRef.current, true);
    });
  }, [applyExtensions]);

  useEffect(() => {
    applyExtensions(adaptiveExtensions);
  }, [adaptiveExtensions, applyExtensions]);

  useEffect(
    () => () => {
      viewRef.current = null;
      pendingExtensionsRef.current = null;
      pendingForceRef.current = false;
      appliedExtensionsRef.current = null;
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
