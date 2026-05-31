import type { Completion } from "@codemirror/autocomplete";

const DEFAULT_COMPLETION_CACHE_TTL_MS = 1200;

export interface CachedCompletion {
  items: Completion[];
  prefix: string;
  timestamp: number;
  filePath: string;
  semanticKey: string;
}

const DEFAULT_COMPLETION_CACHE_CAPACITY = 24;

export class CompletionCache {
  private cache = new Map<string, CachedCompletion>();

  constructor(
    private readonly ttlMs: number = DEFAULT_COMPLETION_CACHE_TTL_MS,
    private readonly capacity: number = DEFAULT_COMPLETION_CACHE_CAPACITY,
  ) {}

  private entryKey(filePath: string, semanticKey: string): string {
    return `${filePath}::${semanticKey}`;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }

    while (this.cache.size > this.capacity) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  set(data: CachedCompletion): void {
    const now = Date.now();
    const key = this.entryKey(data.filePath, data.semanticKey);
    this.cache.delete(key);
    this.cache.set(key, { ...data, timestamp: now });
    this.prune(now);
  }

  get(
    filePath: string,
    semanticKey: string,
    prefix: string,
  ): Completion[] | null {
    const now = Date.now();
    this.prune(now);

    const key = this.entryKey(filePath, semanticKey);
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const cachedPrefix = entry.prefix.toLowerCase();
    const newPrefix = prefix.toLowerCase();

    if (!newPrefix.startsWith(cachedPrefix) || entry.items.length === 0) {
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.items.filter((item) => {
      const metadata = item as Completion & { __filterText?: string };
      const filterText = (
        metadata.__filterText ||
        item.label ||
        ""
      ).toLowerCase();
      return filterText.startsWith(newPrefix);
    });
  }

  invalidate(): void {
    this.cache.clear();
  }
}

export function createCompletionCache(
  ttlMs?: number,
  capacity?: number,
): CompletionCache {
  return new CompletionCache(ttlMs, capacity);
}
