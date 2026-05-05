import type { Completion } from "@codemirror/autocomplete";

type InstantItem = {
  label: string;
  kind: string;
  detail?: string;
  insertText?: string;
  boost?: number;
};

type InstantStub = {
  packageName: string;
  aliases: string[];
  exports: InstantItem[];
};

const MAX_INSTANT_OPTIONS = 32;
const MAX_DOCUMENT_INDEX_LENGTH = 160_000;
const DOCUMENT_SYMBOL_PREFIX_MIN = 2;

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

const SHARED_STUBS: Record<string, InstantStub[]> = {
  javascript: [
    {
      packageName: "console",
      aliases: ["console"],
      exports: [
        { label: "log", kind: "method", detail: "log(message?: any): void" },
        {
          label: "error",
          kind: "method",
          detail: "error(message?: any): void",
        },
        { label: "warn", kind: "method", detail: "warn(message?: any): void" },
        { label: "info", kind: "method", detail: "info(message?: any): void" },
      ],
    },
    {
      packageName: "Math",
      aliases: ["Math"],
      exports: [
        { label: "max", kind: "method", detail: "max(...values): number" },
        { label: "min", kind: "method", detail: "min(...values): number" },
        { label: "round", kind: "method", detail: "round(value): number" },
        { label: "floor", kind: "method", detail: "floor(value): number" },
      ],
    },
    {
      packageName: "JSON",
      aliases: ["JSON"],
      exports: [
        { label: "parse", kind: "method", detail: "parse(text: string)" },
        {
          label: "stringify",
          kind: "method",
          detail: "stringify(value: unknown)",
        },
      ],
    },
    {
      packageName: "axios",
      aliases: ["axios"],
      exports: [
        { label: "create", kind: "function", detail: "create(config?)" },
        { label: "get", kind: "function", detail: "get(url, config?)" },
        {
          label: "post",
          kind: "function",
          detail: "post(url, data?, config?)",
        },
        { label: "interceptors", kind: "property", detail: "interceptors" },
      ],
    },
  ],
  typescript: [
    {
      packageName: "React",
      aliases: ["React"],
      exports: [
        { label: "useState", kind: "function", detail: "useState(initial)" },
        { label: "useEffect", kind: "function", detail: "useEffect(effect)" },
        { label: "useMemo", kind: "function", detail: "useMemo(factory)" },
        {
          label: "createElement",
          kind: "function",
          detail: "createElement(type, props)",
        },
      ],
    },
    {
      packageName: "zod",
      aliases: ["z"],
      exports: [
        { label: "string", kind: "function", detail: "string(): ZodString" },
        { label: "number", kind: "function", detail: "number(): ZodNumber" },
        { label: "object", kind: "function", detail: "object(shape)" },
        { label: "array", kind: "function", detail: "array(item)" },
      ],
    },
  ],
  python: [
    {
      packageName: "requests",
      aliases: ["requests"],
      exports: [
        { label: "get", kind: "function", detail: "get(url, **kwargs)" },
        { label: "post", kind: "function", detail: "post(url, **kwargs)" },
        { label: "put", kind: "function", detail: "put(url, **kwargs)" },
        { label: "delete", kind: "function", detail: "delete(url, **kwargs)" },
        { label: "Session", kind: "class", detail: "class Session" },
      ],
    },
    {
      packageName: "json",
      aliases: ["json"],
      exports: [
        { label: "dump", kind: "function", detail: "dump(obj, fp)" },
        { label: "dumps", kind: "function", detail: "dumps(obj)" },
        { label: "load", kind: "function", detail: "load(fp)" },
        { label: "loads", kind: "function", detail: "loads(s)" },
      ],
    },
    {
      packageName: "os.path",
      aliases: ["os.path"],
      exports: [
        { label: "join", kind: "function", detail: "join(path, *paths)" },
        { label: "basename", kind: "function", detail: "basename(path)" },
        { label: "dirname", kind: "function", detail: "dirname(path)" },
        { label: "exists", kind: "function", detail: "exists(path)" },
      ],
    },
  ],
  php: [
    {
      packageName: "Carbon\\Carbon",
      aliases: ["Carbon"],
      exports: [
        { label: "now", kind: "method", detail: "now(): Carbon" },
        { label: "parse", kind: "method", detail: "parse(string $time)" },
        { label: "create", kind: "method", detail: "create(...$args)" },
      ],
    },
  ],
  go: [
    {
      packageName: "fmt",
      aliases: ["fmt"],
      exports: [
        {
          label: "Println",
          kind: "function",
          detail: "func Println(a ...any) (n int, err error)",
        },
        {
          label: "Printf",
          kind: "function",
          detail: "func Printf(format string, a ...any) (n int, err error)",
        },
        {
          label: "Sprintf",
          kind: "function",
          detail: "func Sprintf(format string, a ...any) string",
        },
        {
          label: "Formatter",
          kind: "interface",
          detail: "type Formatter interface",
        },
      ],
    },
    {
      packageName: "context",
      aliases: ["context"],
      exports: [
        {
          label: "AfterFunc",
          kind: "function",
          detail: "func AfterFunc(ctx Context, f func()) func() bool",
        },
        {
          label: "Background",
          kind: "function",
          detail: "func Background() Context",
        },
        {
          label: "Cause",
          kind: "function",
          detail: "func Cause(c Context) error",
        },
        { label: "TODO", kind: "function", detail: "func TODO() Context" },
        {
          label: "WithCancel",
          kind: "function",
          detail: "func WithCancel(parent Context)",
        },
        {
          label: "WithTimeout",
          kind: "function",
          detail: "func WithTimeout(parent Context, timeout)",
        },
      ],
    },
    {
      packageName: "strings",
      aliases: ["strings"],
      exports: [
        {
          label: "Contains",
          kind: "function",
          detail: "func Contains(s, substr string) bool",
        },
        {
          label: "HasPrefix",
          kind: "function",
          detail: "func HasPrefix(s, prefix string) bool",
        },
        {
          label: "HasSuffix",
          kind: "function",
          detail: "func HasSuffix(s, suffix string) bool",
        },
        {
          label: "TrimSpace",
          kind: "function",
          detail: "func TrimSpace(s string) string",
        },
        {
          label: "Split",
          kind: "function",
          detail: "func Split(s, sep string) []string",
        },
      ],
    },
    {
      packageName: "os",
      aliases: ["os"],
      exports: [
        {
          label: "ReadFile",
          kind: "function",
          detail: "func ReadFile(name string) ([]byte, error)",
        },
        {
          label: "WriteFile",
          kind: "function",
          detail:
            "func WriteFile(name string, data []byte, perm FileMode) error",
        },
        {
          label: "Getenv",
          kind: "function",
          detail: "func Getenv(key string) string",
        },
        { label: "Exit", kind: "function", detail: "func Exit(code int)" },
      ],
    },
  ],
  ruby: [
    {
      packageName: "json",
      aliases: ["JSON"],
      exports: [
        { label: "parse", kind: "method", detail: "parse(source)" },
        { label: "generate", kind: "method", detail: "generate(obj)" },
        { label: "dump", kind: "method", detail: "dump(obj)" },
      ],
    },
    {
      packageName: "File",
      aliases: ["File"],
      exports: [
        { label: "read", kind: "method", detail: "read(path)" },
        { label: "open", kind: "method", detail: "open(path)" },
        { label: "write", kind: "method", detail: "write(path, string)" },
      ],
    },
  ],
  rust: [
    {
      packageName: "serde_json",
      aliases: ["serde_json"],
      exports: [
        {
          label: "from_str",
          kind: "function",
          detail: "fn from_str<T>(s) -> Result<T>",
        },
        {
          label: "to_string",
          kind: "function",
          detail: "fn to_string<T>(value) -> Result<String>",
        },
        { label: "Value", kind: "type", detail: "enum Value" },
      ],
    },
    {
      packageName: "String",
      aliases: ["String"],
      exports: [
        { label: "new", kind: "method", detail: "fn new() -> String" },
        {
          label: "from",
          kind: "method",
          detail: "fn from<T>(value) -> String",
        },
        {
          label: "with_capacity",
          kind: "method",
          detail: "fn with_capacity(capacity)",
        },
      ],
    },
  ],
  java: [
    {
      packageName: "java.lang.System.out",
      aliases: ["System.out"],
      exports: [
        { label: "print", kind: "method", detail: "print(String value)" },
        { label: "println", kind: "method", detail: "println(String value)" },
        {
          label: "printf",
          kind: "method",
          detail: "printf(String format, Object... args)",
        },
      ],
    },
  ],
  csharp: [
    {
      packageName: "Newtonsoft.Json.JsonConvert",
      aliases: ["JsonConvert"],
      exports: [
        {
          label: "SerializeObject",
          kind: "method",
          detail: "SerializeObject(object value)",
        },
        {
          label: "DeserializeObject",
          kind: "method",
          detail: "DeserializeObject<T>(string value)",
        },
      ],
    },
    {
      packageName: "Console",
      aliases: ["Console"],
      exports: [
        { label: "WriteLine", kind: "method", detail: "WriteLine(value)" },
        { label: "ReadLine", kind: "method", detail: "ReadLine()" },
      ],
    },
  ],
  swift: [
    {
      packageName: "URLSession",
      aliases: ["URLSession"],
      exports: [
        {
          label: "shared",
          kind: "property",
          detail: "class var shared: URLSession",
        },
        {
          label: "configuration",
          kind: "property",
          detail: "var configuration",
        },
        {
          label: "dataTask",
          kind: "method",
          detail: "func dataTask(with request)",
        },
      ],
    },
    {
      packageName: "Alamofire",
      aliases: ["AF"],
      exports: [
        { label: "request", kind: "method", detail: "request(_ convertible)" },
        { label: "upload", kind: "method", detail: "upload(_ data)" },
        {
          label: "download",
          kind: "method",
          detail: "download(_ convertible)",
        },
      ],
    },
  ],
  dart: [
    {
      packageName: "http",
      aliases: ["http"],
      exports: [
        {
          label: "get",
          kind: "function",
          detail: "Future<Response> get(Uri url)",
        },
        {
          label: "post",
          kind: "function",
          detail: "Future<Response> post(Uri url)",
        },
        { label: "Client", kind: "class", detail: "class Client" },
      ],
    },
    {
      packageName: "dio",
      aliases: ["Dio"],
      exports: [
        { label: "get", kind: "method", detail: "get(String path)" },
        { label: "post", kind: "method", detail: "post(String path)" },
        { label: "put", kind: "method", detail: "put(String path)" },
        { label: "delete", kind: "method", detail: "delete(String path)" },
      ],
    },
  ],
};

const STUBS: Record<string, InstantStub[]> = {
  ...SHARED_STUBS,
  typescript: [
    ...(SHARED_STUBS.javascript || []),
    ...(SHARED_STUBS.typescript || []),
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

function normalizeAccessOwner(accessChain: string): string {
  return accessChain.replace(/(?:->|::|\.)$/, "").trim();
}

function stubAliases(stub: InstantStub): string[] {
  return [stub.packageName, ...stub.aliases];
}

function accessKindPriority(kind: string): number {
  switch (kind) {
    case "function":
    case "method":
      return 5;
    case "property":
    case "field":
    case "variable":
      return 4;
    case "constant":
      return 3;
    case "class":
    case "type":
    case "interface":
      return 2;
    default:
      return 1;
  }
}

export function getInstantAccessCompletions(
  language: string,
  accessChain: string,
  prefix: string,
): Completion[] {
  const normalized = normalizeLanguage(language);
  const owner = normalizeAccessOwner(accessChain);
  if (!owner) {
    return [];
  }

  const ownerLower = owner.toLowerCase();
  const stubs = STUBS[normalized] || [];
  const stub = stubs.find((candidate) =>
    stubAliases(candidate).some((alias) => alias.toLowerCase() === ownerLower),
  );
  if (!stub) {
    return [];
  }

  return stub.exports
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => startsWithPrefix(item.label, prefix))
    .sort(
      (left, right) =>
        accessKindPriority(right.item.kind) -
          accessKindPriority(left.item.kind) || left.index - right.index,
    )
    .slice(0, MAX_INSTANT_OPTIONS)
    .map(({ item }, rank) =>
      completionFromItem(
        item,
        stub.packageName,
        0.2,
        accessKindPriority(item.kind) / 100 +
          (MAX_INSTANT_OPTIONS - rank) / 1000,
      ),
    );
}

export function getInstantDocumentCompletions(
  fullText: string,
  prefix: string,
): Completion[] {
  if (
    prefix.length < DOCUMENT_SYMBOL_PREFIX_MIN ||
    fullText.length > MAX_DOCUMENT_INDEX_LENGTH
  ) {
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
