import type { ReactNode } from "react";

export type CommandCategory = string;

export interface Command {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon?: ReactNode;
  shortcut?: string;
  action: () => void | Promise<void>;
  needsInput?: boolean;
  inputPlaceholder?: string;
}
