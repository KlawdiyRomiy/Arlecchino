import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";

type CompletionOrchestratorOptions = {
  onRequest?: (requestId: number) => void;
  onResponse?: (requestId: number) => void;
  onCancel?: (requestId: number) => void;
};

export type CompletionOrchestrator = {
  extension: Extension;
  nextRequestId: () => number;
  isStale: (requestId: number) => boolean;
  markResponse: (requestId: number) => void;
  cancelPending: () => void;
};

export function createCompletionOrchestrator(
  options: CompletionOrchestratorOptions,
): CompletionOrchestrator {
  let activeRequestId = 0;

  const extension = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    activeRequestId += 1;
    options.onCancel?.(activeRequestId);
  });

  const nextRequestId = () => {
    activeRequestId += 1;
    options.onRequest?.(activeRequestId);
    return activeRequestId;
  };

  const isStale = (requestId: number) => requestId !== activeRequestId;

  const markResponse = (requestId: number) => {
    if (!isStale(requestId)) {
      options.onResponse?.(requestId);
    }
  };

  const cancelPending = () => {
    activeRequestId += 1;
    options.onCancel?.(activeRequestId);
  };

  return { extension, nextRequestId, isStale, markResponse, cancelPending };
}
