import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

export const CODEMIRROR_SCROLL_IDLE_DELAY_MS = 160;
const CODEMIRROR_VIEWPORT_REPAIR_MAX_ATTEMPTS = 6;
const CODEMIRROR_VIEWPORT_REPAIR_MIN_GAP_PX = 96;
const CODEMIRROR_VIEWPORT_REPAIR_GAP_LINES = 3;
const CODEMIRROR_SCROLL_EPSILON_PX = 0.5;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

const setCodeMirrorScrollActiveEffect = StateEffect.define<boolean>();

export const codeMirrorScrollActiveField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCodeMirrorScrollActiveEffect)) {
        return effect.value;
      }
    }

    return value;
  },
});

interface CodeMirrorScrollGuardOptions {
  idleDelayMs?: number;
  onScrollStart?: () => void;
  onScrollIdle?: () => void;
}

export const createCodeMirrorScrollGuard = ({
  idleDelayMs = CODEMIRROR_SCROLL_IDLE_DELAY_MS,
  onScrollStart,
  onScrollIdle,
}: CodeMirrorScrollGuardOptions = {}): Extension => [
  codeMirrorScrollActiveField,
  ViewPlugin.fromClass(
    class {
      private idleTimer: number | null = null;
      private repairAttempts = 0;
      private repairFrame: number | null = null;
      private repairScrollTop: number | null = null;
      private destroyed = false;
      private scrolling = false;

      constructor(private readonly view: EditorView) {
        this.view.scrollDOM.addEventListener("scroll", this.handleScroll, {
          passive: true,
        });
        this.view.scrollDOM.addEventListener("wheel", this.handleWheel, {
          passive: false,
        });
      }

      private readonly handleScroll = () => {
        this.markScrollActive();
        this.scheduleScrollIdle();
        this.scheduleViewportRepair();
      };

      private readonly handleWheel = (event: WheelEvent) => {
        if (event.defaultPrevented || event.ctrlKey || !event.cancelable) {
          return;
        }

        const target = getWheelScrollTarget(this.view, event);
        if (!target) {
          return;
        }

        event.preventDefault();
        this.markScrollActive();
        this.view.scrollDOM.scrollLeft = target.left;
        this.view.scrollDOM.scrollTop = target.top;
        this.view.requestMeasure();
        this.scheduleViewportRepair();
        this.scheduleScrollIdle();
      };

      private markScrollActive() {
        if (!this.scrolling) {
          this.scrolling = true;
          this.view.dom.dataset.scrollActive = "true";
          onScrollStart?.();
        }

        if (!this.view.state.field(codeMirrorScrollActiveField, false)) {
          this.view.dispatch({
            effects: setCodeMirrorScrollActiveEffect.of(true),
          });
        }
      }

      private scheduleScrollIdle() {
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
        }

        this.idleTimer = window.setTimeout(this.finishScrollIdle, idleDelayMs);
      }

      private readonly finishScrollIdle = () => {
        if (this.destroyed) {
          return;
        }

        this.idleTimer = null;
        this.scrolling = false;
        this.repairAttempts = 0;
        this.repairScrollTop = null;
        delete this.view.dom.dataset.scrollActive;
        delete this.view.dom.dataset.viewportGap;
        if (this.view.state.field(codeMirrorScrollActiveField, false)) {
          this.view.dispatch({
            effects: setCodeMirrorScrollActiveEffect.of(false),
          });
        }
        onScrollIdle?.();
      };

      private scheduleViewportRepair() {
        if (this.repairFrame !== null) return;
        this.repairFrame = window.requestAnimationFrame(
          this.repairViewportIfNeeded,
        );
      }

      private readonly repairViewportIfNeeded = () => {
        this.repairFrame = null;
        const currentScrollTop = this.view.scrollDOM.scrollTop;

        if (this.repairScrollTop !== currentScrollTop) {
          this.repairAttempts = 0;
          this.repairScrollTop = currentScrollTop;
        }

        const hasGap = hasViewportGap(this.view);
        if (hasGap) {
          this.view.dom.dataset.viewportGap = "true";
        } else {
          delete this.view.dom.dataset.viewportGap;
        }

        if (
          this.repairAttempts >= CODEMIRROR_VIEWPORT_REPAIR_MAX_ATTEMPTS ||
          !hasGap
        ) {
          return;
        }

        this.repairAttempts += 1;
        this.view.requestMeasure();
        this.scheduleViewportRepair();
      };

      destroy() {
        this.destroyed = true;
        this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
        this.view.scrollDOM.removeEventListener("wheel", this.handleWheel);
        if (this.repairFrame !== null) {
          window.cancelAnimationFrame(this.repairFrame);
          this.repairFrame = null;
        }
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        delete this.view.dom.dataset.scrollActive;
        delete this.view.dom.dataset.viewportGap;
      }
    },
  ),
];

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const wheelDeltaToPixels = (
  event: WheelEvent,
  axis: "x" | "y",
  view: EditorView,
): number => {
  const rawDelta = axis === "x" ? event.deltaX : event.deltaY;
  if (!Number.isFinite(rawDelta) || rawDelta === 0) {
    return 0;
  }

  if (event.deltaMode === WHEEL_DELTA_LINE) {
    const lineHeight =
      Number.isFinite(view.defaultLineHeight) && view.defaultLineHeight > 0
        ? view.defaultLineHeight
        : 16;
    return rawDelta * lineHeight;
  }

  if (event.deltaMode === WHEEL_DELTA_PAGE) {
    const pageSize =
      axis === "x" ? view.scrollDOM.clientWidth : view.scrollDOM.clientHeight;
    return rawDelta * pageSize;
  }

  return rawDelta;
};

const getWheelScrollTarget = (
  view: EditorView,
  event: WheelEvent,
): { left: number; top: number } | null => {
  const scrollDOM = view.scrollDOM;
  const maxTop = Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight);
  const maxLeft = Math.max(0, scrollDOM.scrollWidth - scrollDOM.clientWidth);
  const deltaTop = wheelDeltaToPixels(event, "y", view);
  const deltaLeft = wheelDeltaToPixels(event, "x", view);
  const nextTop = clamp(scrollDOM.scrollTop + deltaTop, 0, maxTop);
  const nextLeft = clamp(scrollDOM.scrollLeft + deltaLeft, 0, maxLeft);
  const movedTop =
    Math.abs(nextTop - scrollDOM.scrollTop) > CODEMIRROR_SCROLL_EPSILON_PX;
  const movedLeft =
    Math.abs(nextLeft - scrollDOM.scrollLeft) > CODEMIRROR_SCROLL_EPSILON_PX;

  if (!movedTop && !movedLeft) {
    return null;
  }

  return {
    left: nextLeft,
    top: nextTop,
  };
};

const hasViewportGap = (view: EditorView): boolean => {
  const blocks = view.viewportLineBlocks;
  if (blocks.length === 0) {
    return true;
  }

  const scaleY =
    Number.isFinite(view.scaleY) && view.scaleY > 0 ? view.scaleY : 1;
  const visibleTop = view.scrollDOM.scrollTop * scaleY;
  const visibleBottom = visibleTop + view.scrollDOM.clientHeight * scaleY;
  const firstBlock = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  const lineGap =
    Math.max(
      CODEMIRROR_VIEWPORT_REPAIR_MIN_GAP_PX,
      view.defaultLineHeight * CODEMIRROR_VIEWPORT_REPAIR_GAP_LINES,
    ) * scaleY;

  return (
    firstBlock.top > visibleTop + lineGap ||
    (lastBlock.to < view.state.doc.length &&
      lastBlock.bottom < visibleBottom - lineGap)
  );
};
