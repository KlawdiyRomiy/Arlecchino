import type { Completion } from "@codemirror/autocomplete";

const DEFAULT_COMPLETION_CACHE_TTL_MS = 1200;

export interface CachedCompletion {
  items: Completion[];
  prefix: string;
  timestamp: number;
  filePath: string;
  semanticKey: string;
}

export class CompletionCache {
  private cache: CachedCompletion | null = null;

  constructor(
    private readonly ttlMs: number = DEFAULT_COMPLETION_CACHE_TTL_MS,
  ) {}

  set(data: CachedCompletion): void {
    this.cache = data;
  }

  get(
    filePath: string,
    semanticKey: string,
    prefix: string,
  ): Completion[] | null {
    if (!this.cache) return null;

    const now = Date.now();
    const isExpired = now - this.cache.timestamp > this.ttlMs;
    const isSameLocation =
      this.cache.filePath === filePath &&
      this.cache.semanticKey === semanticKey;

    if (isExpired || !isSameLocation) {
      this.cache = null;
      return null;
    }

    const cachedPrefix = this.cache.prefix.toLowerCase();
    const newPrefix = prefix.toLowerCase();

    if (!newPrefix.startsWith(cachedPrefix) || this.cache.items.length === 0) {
      return null;
    }

    return this.cache.items.filter((item) => {
      const filterText = (item.label || "").toLowerCase();
      return filterText.startsWith(newPrefix);
    });
  }

  invalidate(): void {
    this.cache = null;
  }
}

export function createCompletionCache(ttlMs?: number): CompletionCache {
  return new CompletionCache(ttlMs);
}
