import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

export const CODEMIRROR_SCROLL_IDLE_DELAY_MS = 160;
const CODEMIRROR_VIEWPORT_REPAIR_MAX_ATTEMPTS = 2;
const CODEMIRROR_VIEWPORT_REPAIR_MIN_GAP_PX = 96;
const CODEMIRROR_VIEWPORT_REPAIR_GAP_LINES = 3;

interface CodeMirrorScrollGuardOptions {
  idleDelayMs?: number;
  onScrollStart?: () => void;
  onScrollIdle?: () => void;
}

export const createCodeMirrorScrollGuard = ({
  idleDelayMs = CODEMIRROR_SCROLL_IDLE_DELAY_MS,
  onScrollStart,
  onScrollIdle,
}: CodeMirrorScrollGuardOptions = {}): Extension =>
  ViewPlugin.fromClass(
    class {
      private idleTimer: number | null = null;
      private repairAttempts = 0;
      private repairFrame: number | null = null;
      private repairScrollTop: number | null = null;
      private scrolling = false;

      constructor(private readonly view: EditorView) {
        this.view.scrollDOM.addEventListener("scroll", this.handleScroll, {
          passive: true,
        });
      }

      private readonly handleScroll = () => {
        if (!this.scrolling) {
          this.scrolling = true;
          this.view.dom.dataset.scrollActive = "true";
          onScrollStart?.();
        }

        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
        }

        this.idleTimer = window.setTimeout(() => {
          this.idleTimer = null;
          this.scrolling = false;
          this.repairAttempts = 0;
          this.repairScrollTop = null;
          delete this.view.dom.dataset.scrollActive;
          onScrollIdle?.();
        }, idleDelayMs);

        this.scheduleViewportRepair();
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

        if (
          this.repairAttempts >= CODEMIRROR_VIEWPORT_REPAIR_MAX_ATTEMPTS ||
          !hasViewportGap(this.view)
        ) {
          return;
        }

        this.repairAttempts += 1;
        this.view.requestMeasure();
        this.scheduleViewportRepair();
      };

      destroy() {
        this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
        if (this.repairFrame !== null) {
          window.cancelAnimationFrame(this.repairFrame);
          this.repairFrame = null;
        }
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        delete this.view.dom.dataset.scrollActive;
      }
    },
  );

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
