import { normalizeProjectPath } from "../../utils/projectPaths";

export const joinProjectEntryPath = (
  directoryPath: string,
  entryName: string,
): string => `${normalizeProjectPath(directoryPath)}/${entryName}`;

export const getNextWrappedIndex = (
  currentIndex: number,
  direction: 1 | -1,
  total: number,
): number => {
  if (total <= 0) {
    return -1;
  }

  return (currentIndex + direction + total) % total;
};

export const getCodePanelTabTestId = (path: string): string => {
  const normalized = path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `code-panel-tab-${normalized || "file"}`;
};
