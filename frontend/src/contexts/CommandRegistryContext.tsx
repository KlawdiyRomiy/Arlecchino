import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Command } from "../types/commands";

interface CommandRegistryContextValue {
  commands: Command[];
  registerCommands: (pluginId: string, commands: Command[]) => void;
  unregisterCommands: (pluginId: string) => void;
}

const CommandRegistryContext =
  createContext<CommandRegistryContextValue | null>(null);

export const CommandRegistryProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [commandsByPlugin, setCommandsByPlugin] = useState<
    Record<string, Command[]>
  >({});

  const registerCommands = useCallback(
    (pluginId: string, commands: Command[]) => {
      setCommandsByPlugin((current) => {
        if (current[pluginId] === commands) {
          return current;
        }
        return {
          ...current,
          [pluginId]: commands,
        };
      });
    },
    [],
  );

  const unregisterCommands = useCallback((pluginId: string) => {
    setCommandsByPlugin((current) => {
      if (!(pluginId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[pluginId];
      return next;
    });
  }, []);

  const commands = useMemo(
    () => Object.values(commandsByPlugin).flat(),
    [commandsByPlugin],
  );

  const value = useMemo(
    () => ({ commands, registerCommands, unregisterCommands }),
    [commands, registerCommands, unregisterCommands],
  );

  return (
    <CommandRegistryContext.Provider value={value}>
      {children}
    </CommandRegistryContext.Provider>
  );
};

export const useCommandRegistry = () => {
  const context = useContext(CommandRegistryContext);
  if (!context) {
    throw new Error(
      "useCommandRegistry must be used within CommandRegistryProvider",
    );
  }
  return context;
};
