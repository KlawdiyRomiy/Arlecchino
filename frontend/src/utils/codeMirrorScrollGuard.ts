import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

export const CODEMIRROR_SCROLL_IDLE_DELAY_MS = 160;

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
          delete this.view.dom.dataset.scrollActive;
          onScrollIdle?.();
        }, idleDelayMs);
      };

      destroy() {
        this.view.scrollDOM.removeEventListener("scroll", this.handleScroll);
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        delete this.view.dom.dataset.scrollActive;
      }
    },
  );
