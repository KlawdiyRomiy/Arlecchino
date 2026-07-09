import type { Completion } from "@codemirror/autocomplete";

type InstantItem = {
  label: string;
  kind: string;
  detail?: string;
  insertText?: string;
  boost?: number;
};

const MAX_INSTANT_OPTIONS = 32;
const MAX_DOCUMENT_INDEX_LENGTH = 160_000;
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  scss: "css",
  sass: "css",
  less: "css",
};

const KEYWORDS: Record<string, InstantItem[]> = {
  go: [
    { label: "package", kind: "keyword", boost: 1.2 },
    { label: "func", kind: "keyword", boost: 1.1 },
    { label: "import", kind: "keyword", boost: 1 },
    { label: "type", kind: "keyword", boost: 1 },
    { label: "struct", kind: "keyword" },
    { label: "interface", kind: "keyword" },
    { label: "var", kind: "keyword" },
    { label: "const", kind: "keyword" },
    { label: "return", kind: "keyword" },
    { label: "defer", kind: "keyword" },
    { label: "go", kind: "keyword" },
    { label: "if", kind: "keyword" },
    { label: "else", kind: "keyword" },
    { label: "for", kind: "keyword" },
    { label: "range", kind: "keyword" },
    { label: "switch", kind: "keyword" },
    { label: "case", kind: "keyword" },
    { label: "default", kind: "keyword" },
    { label: "make", kind: "function" },
    { label: "new", kind: "function" },
    { label: "append", kind: "function" },
    { label: "len", kind: "function" },
    { label: "cap", kind: "function" },
    { label: "nil", kind: "constant" },
    { label: "true", kind: "constant" },
    { label: "false", kind: "constant" },
  ],
  javascript: [
    { label: "const", kind: "keyword", boost: 1.1 },
    { label: "let", kind: "keyword" },
    { label: "function", kind: "keyword" },
    { label: "class", kind: "keyword" },
    { label: "import", kind: "keyword" },
    { label: "export", kind: "keyword" },
    { label: "return", kind: "keyword" },
    { label: "async", kind: "keyword" },
    { label: "await", kind: "keyword" },
    { label: "if", kind: "keyword" },
    { label: "else", kind: "keyword" },
    { label: "for", kind: "keyword" },
    { label: "while", kind: "keyword" },
    { label: "switch", kind: "keyword" },
    { label: "try", kind: "keyword" },
    { label: "catch", kind: "keyword" },
    { label: "Promise", kind: "class" },
    { label: "Array", kind: "class" },
    { label: "JSON", kind: "class" },
    { label: "console", kind: "variable" },
    { label: "true", kind: "constant" },
    { label: "false", kind: "constant" },
    { label: "null", kind: "constant" },
    { label: "undefined", kind: "constant" },
  ],
  typescript: [
    { label: "const", kind: "keyword", boost: 1.1 },
    { label: "let", kind: "keyword" },
    { label: "function", kind: "keyword" },
    { label: "class", kind: "keyword" },
    { label: "interface", kind: "keyword" },
    { label: "type", kind: "keyword" },
    { label: "enum", kind: "keyword" },
    { label: "import", kind: "keyword" },
    { label: "export", kind: "keyword" },
    { label: "return", kind: "keyword" },
    { label: "async", kind: "keyword" },
    { label: "await", kind: "keyword" },
    { label: "if", kind: "keyword" },
    { label: "else", kind: "keyword" },
    { label: "for", kind: "keyword" },
    { label: "while", kind: "keyword" },
    { label: "try", kind: "keyword" },
    { label: "catch", kind: "keyword" },
    { label: "Promise", kind: "class" },
    { label: "Array", kind: "class" },
    { label: "string", kind: "type" },
    { label: "number", kind: "type" },
    { label: "boolean", kind: "type" },
    { label: "void", kind: "type" },
    { label: "true", kind: "constant" },
    { label: "false", kind: "constant" },
    { label: "null", kind: "constant" },
    { label: "undefined", kind: "constant" },
  ],
  python: [
    { label: "def", kind: "keyword", boost: 1.1 },
    { label: "class", kind: "keyword" },
    { label: "import", kind: "keyword" },
    { label: "from", kind: "keyword" },
    { label: "return", kind: "keyword" },
    { label: "yield", kind: "keyword" },
    { label: "async", kind: "keyword" },
    { label: "await", kind: "keyword" },
    { label: "if", kind: "keyword" },
    { label: "elif", kind: "keyword" },
    { label: "else", kind: "keyword" },
    { label: "for", kind: "keyword" },
    { label: "while", kind: "keyword" },
    { label: "try", kind: "keyword" },
    { label: "except", kind: "keyword" },
    { label: "finally", kind: "keyword" },
    { label: "with", kind: "keyword" },
    { label: "self", kind: "variable" },
    { label: "print", kind: "function" },
    { label: "len", kind: "function" },
    { label: "range", kind: "function" },
    { label: "True", kind: "constant" },
    { label: "False", kind: "constant" },
    { label: "None", kind: "constant" },
  ],
  php: [
    { label: "function", kind: "keyword", boost: 1.1 },
    { label: "class", kind: "keyword" },
    { label: "public", kind: "keyword" },
    { label: "private", kind: "keyword" },
    { label: "protected", kind: "keyword" },
    { label: "static", kind: "keyword" },
    { label: "namespace", kind: "keyword" },
    { label: "use", kind: "keyword" },
    { label: "extends", kind: "keyword" },
    { label: "implements", kind: "keyword" },
    { label: "return", kind: "keyword" },
    { label: "new", kind: "keyword" },
    { label: "if", kind: "keyword" },
    { label: "else", kind: "keyword" },
    { label: "foreach", kind: "keyword" },
    { label: "while", kind: "keyword" },
    { label: "try", kind: "keyword" },
    { label: "catch", kind: "keyword" },
    { label: "$this", kind: "variable" },
    { label: "self", kind: "keyword" },
    { label: "null", kind: "constant" },
    { label: "true", kind: "constant" },
    { label: "false", kind: "constant" },
  ],
  ruby: [
    { label: "def", kind: "keyword", boost: 1.1 },
    { label: "class", kind: "keyword" },
    { label: "module", kind: "keyword" },
    { label: "require", kind: "keyword" },
    { label: "include", kind: "keyword" },
    { label: "return", kind: "keyword" },
    { label: "if", kind: "keyword" },
    { label: "elsif", kind: "keyword" },
    { label: "else", kind: "keyword" },
    { label: "end", kind: "keyword" },
    { label: "do", kind: "keyword" },
    { label: "nil", kind: "constant" },
    { label: "true", kind: "constant" },
    { label: "false", kind: "constant" },
  ],
  rust: [
    { label: "fn", kind: "keyword", boost: 1.1 },
    { label: "let", kind: "keyword" },
    { label: "mut", kind: "keyword" },
    { label: "struct", kind: "keyword" },
    { label: "enum", kind: "keyword" },
    { label: "impl", kind: "keyword" },
    { label: "trait", kind: "keyword" },
    { label: "pub", kind: "keyword" },
    { label: "use", kind: "keyword" },
    { label: "mod", kind: "keyword" },
    { label: "match", kind: "keyword" },
    { label: "async", kind: "keyword" },
    { label: "await", kind: "keyword" },
    { label: "Some", kind: "function" },
    { label: "None", kind: "constant" },
    { label: "Ok", kind: "function" },
    { label: "Err", kind: "function" },
  ],
  css: [
    { label: "color", kind: "property" },
    { label: "background", kind: "property" },
    { label: "display", kind: "property" },
    { label: "position", kind: "property" },
    { label: "margin", kind: "property" },
    { label: "padding", kind: "property" },
    { label: "width", kind: "property" },
    { label: "height", kind: "property" },
    { label: "font-size", kind: "property" },
    { label: "border", kind: "property" },
    { label: "@media", kind: "keyword" },
    { label: "@import", kind: "keyword" },
  ],
  html: [
    { label: "div", kind: "keyword" },
    { label: "span", kind: "keyword" },
    { label: "section", kind: "keyword" },
    { label: "header", kind: "keyword" },
    { label: "footer", kind: "keyword" },
    { label: "main", kind: "keyword" },
    { label: "button", kind: "keyword" },
    { label: "input", kind: "keyword" },
    { label: "form", kind: "keyword" },
  ],
  sql: [
    { label: "SELECT", kind: "keyword", boost: 1.1 },
    { label: "FROM", kind: "keyword" },
    { label: "WHERE", kind: "keyword" },
    { label: "INSERT", kind: "keyword" },
    { label: "UPDATE", kind: "keyword" },
    { label: "DELETE", kind: "keyword" },
    { label: "CREATE", kind: "keyword" },
    { label: "TABLE", kind: "keyword" },
    { label: "JOIN", kind: "keyword" },
    { label: "ORDER BY", kind: "keyword" },
    { label: "GROUP BY", kind: "keyword" },
  ],
  bash: [
    { label: "if", kind: "keyword" },
    { label: "for", kind: "keyword" },
    { label: "while", kind: "keyword" },
    { label: "case", kind: "keyword" },
    { label: "function", kind: "keyword" },
    { label: "echo", kind: "function" },
    { label: "printf", kind: "function" },
    { label: "export", kind: "keyword" },
  ],
  yaml: [
    { label: "version", kind: "property" },
    { label: "services", kind: "property" },
    { label: "image", kind: "property" },
    { label: "build", kind: "property" },
    { label: "ports", kind: "property" },
  ],
  dockerfile: [
    { label: "FROM", kind: "keyword" },
    { label: "RUN", kind: "keyword" },
    { label: "CMD", kind: "keyword" },
    { label: "COPY", kind: "keyword" },
    { label: "WORKDIR", kind: "keyword" },
    { label: "ENV", kind: "keyword" },
  ],
};

function normalizeLanguage(language: string): string {
  const lower = language.toLowerCase();
  return LANGUAGE_ALIASES[lower] || lower;
}

function completionFromItem(
  item: InstantItem,
  detail: string,
  boostOffset: number,
  rankBoost: number = 0,
): Completion {
  const completion: Completion = {
    label: item.label,
    detail: item.detail || detail,
    type: item.kind,
    apply: item.insertText || item.label,
    boost: boostOffset + rankBoost + (item.boost || 0),
  };
  (completion as unknown as Record<string, unknown>).__source = "Instant";
  return completion;
}

function startsWithPrefix(label: string, prefix: string): boolean {
  return label.toLowerCase().startsWith(prefix.toLowerCase());
}

function uniqueByLabel(items: Completion[]): Completion[] {
  const seen = new Set<string>();
  const unique: Completion[] = [];
  for (const item of items) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function getInstantKeywordCompletions(
  language: string,
  prefix: string,
): Completion[] {
  if (!prefix) {
    return [];
  }
  const normalized = normalizeLanguage(language);
  const items = KEYWORDS[normalized] || [];
  return items
    .filter((item) => startsWithPrefix(item.label, prefix))
    .slice(0, MAX_INSTANT_OPTIONS)
    .map((item) => completionFromItem(item, "keyword", -0.15));
}

export function getInstantKeywordCompletionOptions(
  language: string,
): Completion[] {
  const normalized = normalizeLanguage(language);
  const items = KEYWORDS[normalized] || [];
  return items.map((item) => completionFromItem(item, "keyword", -0.15));
}

export function getInstantDocumentCompletions(
  fullText: string,
  prefix: string,
): Completion[] {
  if (!prefix || fullText.length > MAX_DOCUMENT_INDEX_LENGTH) {
    return [];
  }

  const prefixLower = prefix.toLowerCase();
  const counts = new Map<string, number>();
  const declarations =
    /\b(?:func|function|def|class|type|interface|struct|const|let|var|enum|trait|module)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of fullText.matchAll(declarations)) {
    const label = match[1];
    if (!label || label.toLowerCase() === prefixLower) {
      continue;
    }
    if (startsWithPrefix(label, prefix)) {
      counts.set(label, (counts.get(label) || 0) + 6);
    }
  }

  const identifiers = /\b[A-Za-z_$][\w$]{1,}\b/g;
  for (const match of fullText.matchAll(identifiers)) {
    const label = match[0];
    if (label.toLowerCase() === prefixLower) {
      continue;
    }
    if (startsWithPrefix(label, prefix)) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    if (counts.size > 160) {
      break;
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, MAX_INSTANT_OPTIONS)
    .map(([label], index) =>
      completionFromItem(
        { label, kind: "variable", detail: "current file" },
        "current file",
        -0.35 - index / 1000,
      ),
    );
}

export function mergeInstantCompletions(
  ...groups: Completion[][]
): Completion[] {
  return uniqueByLabel(groups.flat()).slice(0, MAX_INSTANT_OPTIONS);
}
