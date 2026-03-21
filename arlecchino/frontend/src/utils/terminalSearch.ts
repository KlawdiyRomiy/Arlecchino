export type TerminalSearchDirection = "next" | "prev";

export interface TerminalSearchStats {
  query: string;
  totalMatches: number;
  currentMatch: number;
  noMatches: boolean;
}

interface TerminalBufferLine {
  translateToString(trimRight?: boolean, startColumn?: number): string;
}

interface TerminalActiveBuffer {
  baseY: number;
  length: number;
  getLine(index: number): TerminalBufferLine | undefined;
}

interface TerminalLikeWithBuffer {
  buffer: {
    active: TerminalActiveBuffer;
  };
}

const normalizeSearchValue = (value: string, caseSensitive: boolean): string =>
  caseSensitive ? value : value.toLowerCase();

export const createEmptyTerminalSearchStats = (
  query = "",
): TerminalSearchStats => ({
  query,
  totalMatches: 0,
  currentMatch: 0,
  noMatches: false,
});

export const countTerminalSearchMatches = (
  lines: string[],
  query: string,
  caseSensitive = false,
): number => {
  const normalizedQuery = normalizeSearchValue(query.trim(), caseSensitive);
  if (!normalizedQuery) {
    return 0;
  }

  let matches = 0;
  for (const line of lines) {
    const normalizedLine = normalizeSearchValue(line, caseSensitive);
    let cursor = 0;
    while (cursor < normalizedLine.length) {
      const foundAt = normalizedLine.indexOf(normalizedQuery, cursor);
      if (foundAt < 0) {
        break;
      }
      matches += 1;
      cursor = foundAt + normalizedQuery.length;
    }
  }

  return matches;
};

export const getNextTerminalMatchIndex = (
  currentIndex: number,
  totalMatches: number,
  direction: TerminalSearchDirection,
): number => {
  if (totalMatches <= 0) {
    return 0;
  }

  if (direction === "next") {
    if (currentIndex <= 0 || currentIndex >= totalMatches) {
      return 1;
    }
    return currentIndex + 1;
  }

  if (currentIndex <= 1) {
    return totalMatches;
  }

  return currentIndex - 1;
};

export const readTerminalBufferLines = (
  terminal: TerminalLikeWithBuffer,
  maxLines = 2000,
): string[] => {
  const buffer = terminal.buffer.active;
  const start = Math.max(0, buffer.baseY + buffer.length - maxLines);
  const end = Math.max(start, buffer.baseY + buffer.length);

  const lines: string[] = [];
  for (let index = start; index < end; index += 1) {
    const line = buffer.getLine(index);
    if (!line) {
      continue;
    }
    lines.push(line.translateToString(true));
  }

  return lines;
};
