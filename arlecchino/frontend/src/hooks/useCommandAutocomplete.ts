import { useState, useCallback, useRef, useEffect } from "react";
import type { Terminal as XTerminal } from "@xterm/xterm";

interface UseCommandAutocompleteOptions {
  terminal: XTerminal | null;
  enabled?: boolean;
}

interface AutocompleteState {
  visible: boolean;
  input: string;
  position: { x: number; y: number };
  cursorPosition: number;
}

export function useCommandAutocomplete({
  terminal,
  enabled = true,
}: UseCommandAutocompleteOptions) {
  const [state, setState] = useState<AutocompleteState>({
    visible: false,
    input: "",
    position: { x: 0, y: 0 },
    cursorPosition: 0,
  });

  const inputBuffer = useRef("");
  const promptDetected = useRef(false);

  const detectPrompt = useCallback((data: string) => {
    const promptPatterns = [
      /\$ $/,
      /> $/,
      /% $/,
      /❯ $/,
      /→ $/,
      /\[.*\]\$ $/,
      /sail\s+artisan/,
      /php\s+artisan/,
    ];
    return promptPatterns.some((p) => p.test(data));
  }, []);

  const calculatePosition = useCallback(() => {
    if (!terminal) return { x: 0, y: 0 };

    const element = terminal.element;
    if (!element) return { x: 0, y: 0 };

    const rect = element.getBoundingClientRect();
    const cellWidth = rect.width / terminal.cols;
    const cellHeight = rect.height / terminal.rows;

    const cursorX = terminal.buffer.active.cursorX;
    const cursorY = terminal.buffer.active.cursorY;

    return {
      x: rect.left + cursorX * cellWidth,
      y: rect.top + (cursorY + 1) * cellHeight + 4,
    };
  }, [terminal]);

  const handleData = useCallback(
    (data: string) => {
      if (!enabled) return;

      if (data === "\r" || data === "\n") {
        inputBuffer.current = "";
        promptDetected.current = false;
        setState((s) => ({ ...s, visible: false, input: "" }));
        return;
      }

      if (data === "\x7f" || data === "\b") {
        inputBuffer.current = inputBuffer.current.slice(0, -1);
      } else if (data === "\x03") {
        inputBuffer.current = "";
        setState((s) => ({ ...s, visible: false, input: "" }));
        return;
      } else if (data.length === 1 && data >= " ") {
        inputBuffer.current += data;
      }

      const input = inputBuffer.current.trim();
      const isArtisanCommand =
        input.startsWith("php artisan") ||
        input.startsWith("artisan") ||
        input.startsWith("sail artisan") ||
        input.match(/^(make|migrate|route|cache|config|db|event|key|queue|schedule|storage|stub|vendor|view):?\w*/);

      if (isArtisanCommand && input.length > 3) {
        const position = calculatePosition();
        setState({
          visible: true,
          input,
          position,
          cursorPosition: inputBuffer.current.length,
        });
      } else {
        setState((s) => ({ ...s, visible: false }));
      }
    },
    [enabled, calculatePosition]
  );

  const close = useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const insertText = useCallback(
    (text: string) => {
      if (!terminal) return;

      const currentInput = inputBuffer.current;
      const parts = currentInput.split(/\s+/);
      const lastPart = parts[parts.length - 1] || "";

      let deleteCount = 0;
      if (lastPart && text.startsWith(lastPart.split(":")[0])) {
        deleteCount = lastPart.length;
      } else if (text.startsWith("--") && lastPart.startsWith("-")) {
        deleteCount = lastPart.length;
      }

      for (let i = 0; i < deleteCount; i++) {
        terminal.input?.("\x7f");
      }

      terminal.input?.(text + " ");

      inputBuffer.current =
        parts.slice(0, -1).join(" ") + (parts.length > 1 ? " " : "") + text + " ";

      close();
    },
    [terminal, close]
  );

  useEffect(() => {
    if (!terminal || !enabled) return;

    const disposable = terminal.onData(handleData);
    return () => disposable.dispose();
  }, [terminal, enabled, handleData]);

  return {
    ...state,
    close,
    insertText,
  };
}
