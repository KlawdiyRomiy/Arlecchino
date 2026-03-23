import { useState, useCallback, useEffect } from "react";
import {
  DispatchCommand,
  GetDispatcherSuggestions,
  GetDispatcherRecent,
  GetDispatcherPinned,
  ExpandTag,
  PinCommand,
  UnpinCommand,
  InitDispatcherForProject,
} from "../../wailsjs/go/main/App";
import { useTerminalStore } from "../stores/terminalStore";

interface DispatcherItem {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  action: string;
  actionLabel: string;
  filePath: string;
  line: number;
  score: number;
}

interface DispatcherResult {
  success: boolean;
  output: string;
  error: string;
  resultType: number;
  items: DispatcherItem[];
  preview: string;
  shouldClose: boolean;
}

export function useDispatcher() {
  const isDispatcherPaused = useTerminalStore(
    (state) => state.isDispatcherPaused,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<DispatcherItem[]>([]);
  const [pinnedItems, setPinnedItems] = useState<string[]>([]);
  const [recentItems, setRecentItems] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await InitDispatcherForProject();
        setIsInitialized(true);
        await loadPinnedAndRecent();
      } catch (err) {
        console.error("[Dispatcher] Init failed:", err);
      }
    };
    init();
  }, []);

  const loadPinnedAndRecent = useCallback(async () => {
    try {
      const [pinned, recent] = await Promise.all([
        GetDispatcherPinned(),
        GetDispatcherRecent(),
      ]);
      setPinnedItems(pinned?.map((p) => p.title) || []);
      setRecentItems(recent?.map((r) => r.title) || []);
    } catch (err) {
      console.error("[Dispatcher] Load pinned/recent failed:", err);
    }
  }, []);

  const open = useCallback(() => {
    if (isDispatcherPaused) {
      return;
    }
    setIsOpen(true);
    setInput("");
    loadPinnedAndRecent();
  }, [isDispatcherPaused, loadPinnedAndRecent]);

  const close = useCallback(() => {
    setIsOpen(false);
    setInput("");
    setSuggestions([]);
  }, []);

  const updateSuggestions = useCallback(
    async (value: string) => {
      if (isDispatcherPaused) {
        setInput(value);
        setSuggestions([]);
        return;
      }

      setInput(value);
      if (!value) {
        setSuggestions([]);
        return;
      }
      try {
        const results = await GetDispatcherSuggestions(value);
        setSuggestions(results || []);
      } catch (err) {
        console.error("[Dispatcher] Suggestions failed:", err);
        setSuggestions([]);
      }
    },
    [isDispatcherPaused],
  );

  const execute = useCallback(
    async (command: string): Promise<DispatcherResult | null> => {
      if (isDispatcherPaused) {
        return {
          success: false,
          output: "",
          error: "Command dispatcher is paused while TUI mode is active",
          resultType: 0,
          items: [],
          preview: "",
          shouldClose: true,
        };
      }

      try {
        const result = await DispatchCommand(command);
        await loadPinnedAndRecent();
        return result;
      } catch (err) {
        console.error("[Dispatcher] Execute failed:", err);
        return null;
      }
    },
    [isDispatcherPaused, loadPinnedAndRecent],
  );

  useEffect(() => {
    if (!isDispatcherPaused) {
      return;
    }

    setIsOpen(false);
    setSuggestions([]);
  }, [isDispatcherPaused]);

  const expandTagCommand = useCallback(
    async (input: string): Promise<string> => {
      if (!input.startsWith("@")) {
        return input;
      }
      try {
        const expanded = await ExpandTag(input);
        return expanded || input;
      } catch (err) {
        console.error("[Dispatcher] ExpandTag failed:", err);
        return input;
      }
    },
    [],
  );

  const pin = useCallback(
    async (command: string) => {
      try {
        await PinCommand(command);
        await loadPinnedAndRecent();
      } catch (err) {
        console.error("[Dispatcher] Pin failed:", err);
      }
    },
    [loadPinnedAndRecent],
  );

  const unpin = useCallback(
    async (command: string) => {
      try {
        await UnpinCommand(command);
        await loadPinnedAndRecent();
      } catch (err) {
        console.error("[Dispatcher] Unpin failed:", err);
      }
    },
    [loadPinnedAndRecent],
  );

  return {
    isOpen,
    input,
    suggestions,
    pinnedItems,
    recentItems,
    isInitialized,
    open,
    close,
    setInput: updateSuggestions,
    execute,
    expandTagCommand,
    pin,
    unpin,
  };
}

export type UseDispatcherReturn = ReturnType<typeof useDispatcher>;
