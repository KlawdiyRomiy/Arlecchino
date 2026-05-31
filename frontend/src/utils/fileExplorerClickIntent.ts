export type ExplorerNodeClickIntent =
  | "toggleSelection"
  | "openDependencyTree"
  | "openQuickRelations"
  | "default";

export interface ExplorerNodeClickModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export const resolveExplorerNodeClickIntent = (
  modifiers: ExplorerNodeClickModifiers,
  isDirectory: boolean,
): ExplorerNodeClickIntent => {
  const { shiftKey, metaKey, ctrlKey, altKey } = modifiers;

  if (shiftKey && !metaKey && !ctrlKey && !altKey) {
    return "toggleSelection";
  }

  if (!shiftKey && !ctrlKey && !altKey && metaKey && !isDirectory) {
    return "openDependencyTree";
  }

  if (!shiftKey && !metaKey && !ctrlKey && altKey && !isDirectory) {
    return "openQuickRelations";
  }

  return "default";
};
