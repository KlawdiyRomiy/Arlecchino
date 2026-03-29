import { useState, useEffect, useCallback, useRef } from "react";
import {
  PredictTerminalCommand,
  RecordCommandExecution,
  GetCurrentProjectID,
} from "../../wailsjs/go/main/App";
import { terminal } from "../../wailsjs/go/models";
import { useTerminalStore } from "../stores/terminalStore";

export interface TerminalPredictionState {
  ghostText: string;
  predictions: terminal.PredictionResult[];
  isLoading: boolean;
}

export const useTerminalPrediction = (currentInput: string) => {
  const isArlePaused = useTerminalStore((state) => state.isArlePaused);
  const tuiModeActive = useTerminalStore((state) => state.tuiModeActive);
  const activeProjectPath = useTerminalStore(
    (state) => state.activeProjectPath,
  );

  const [state, setState] = useState<TerminalPredictionState>({
    ghostText: "",
    predictions: [],
    isLoading: false,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const projectIDRef = useRef<string>("");
  const workDirRef = useRef<string>("");

  useEffect(() => {
    let disposed = false;
    workDirRef.current = activeProjectPath ?? "";
    projectIDRef.current = "";

    const loadProjectID = async () => {
      try {
        const pid = await GetCurrentProjectID();
        if (!disposed && workDirRef.current === (activeProjectPath ?? "")) {
          projectIDRef.current = pid;
        }
      } catch (err) {
        console.error("[TerminalPrediction] Failed to load context:", err);
      }
    };
    void loadProjectID();

    return () => {
      disposed = true;
    };
  }, [activeProjectPath]);

  const fetchPredictions = useCallback(
    async (input: string) => {
      if (isArlePaused || tuiModeActive) {
        setState({ ghostText: "", predictions: [], isLoading: false });
        return;
      }

      if (!input || input.length < 3) {
        setState({ ghostText: "", predictions: [], isLoading: false });
        return;
      }

      setState((prev) => ({ ...prev, isLoading: true }));

      try {
        const response = await PredictTerminalCommand({
          input,
          workDir: workDirRef.current,
          projectID: projectIDRef.current,
        });

        if (response.predictions && response.predictions.length > 0) {
          const topPrediction = response.predictions[0];
          const lastToken = input.split(/\s+/).pop() || "";

          let ghostSuffix = "";
          if (
            topPrediction.Completion &&
            topPrediction.Completion.toLowerCase().startsWith(
              lastToken.toLowerCase(),
            )
          ) {
            ghostSuffix = topPrediction.Completion.slice(lastToken.length);
          }

          setState({
            ghostText: ghostSuffix,
            predictions: response.predictions,
            isLoading: false,
          });
        } else {
          setState({ ghostText: "", predictions: [], isLoading: false });
        }
      } catch (err) {
        console.error("[TerminalPrediction] Fetch failed:", err);
        setState({ ghostText: "", predictions: [], isLoading: false });
      }
    },
    [isArlePaused, tuiModeActive],
  );

  useEffect(() => {
    if (isArlePaused || tuiModeActive) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      setState({ ghostText: "", predictions: [], isLoading: false });
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchPredictions(currentInput.trim());
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [currentInput, fetchPredictions, isArlePaused, tuiModeActive]);

  const recordExecution = useCallback(
    async (command: string) => {
      if (isArlePaused || tuiModeActive) {
        return;
      }

      if (!command.trim()) return;

      try {
        await RecordCommandExecution(
          projectIDRef.current,
          command.trim(),
          workDirRef.current,
        );
      } catch (err) {
        console.error("[TerminalPrediction] Record failed:", err);
      }
    },
    [isArlePaused, tuiModeActive],
  );

  const clearGhost = useCallback(() => {
    setState((prev) => ({ ...prev, ghostText: "" }));
  }, []);

  return {
    ...state,
    recordExecution,
    clearGhost,
  };
};
