import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

type LanguageExtensionFactory = () => Promise<Extension | null>;
type LegacyStreamParser = Parameters<typeof StreamLanguage.define>[0];

const normalizeCodeMirrorLanguage = (language: string): string =>
  language.trim().toLowerCase();

const extensionCache = new Map<string, Extension | null>();
const extensionPromiseCache = new Map<string, Promise<Extension | null>>();

const createLegacyLanguage = async <TModule>(
  loadModule: () => Promise<TModule>,
  selectMode: (module: TModule) => LegacyStreamParser,
): Promise<Extension> => {
  const module = await loadModule();
  return StreamLanguage.define(selectMode(module));
};

const createClikeLanguage = (name: string): Promise<Extension> =>
  createLegacyLanguage(
    () => import("@codemirror/legacy-modes/mode/clike"),
    (module) => module.clike({ name }),
  );

const officialLanguageFactories: Record<string, LanguageExtensionFactory> = {
  javascript: async () =>
    (await import("@codemirror/lang-javascript")).javascript(),
  js: async () => (await import("@codemirror/lang-javascript")).javascript(),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      typescript: true,
    }),
  ts: async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      typescript: true,
    }),
  javascriptreact: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  jsx: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  typescriptreact: async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      jsx: true,
      typescript: true,
    }),
  tsx: async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      jsx: true,
      typescript: true,
    }),
  astro: async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      jsx: true,
      typescript: true,
    }),
  vue: async () => {
    const [vueModule, htmlModule] = await Promise.all([
      import("@codemirror/lang-vue"),
      import("@codemirror/lang-html"),
    ]);
    return vueModule.vue({ base: htmlModule.html() });
  },
  svelte: async () => (await import("@codemirror/lang-html")).html(),
  blade: async () => (await import("@codemirror/lang-html")).html(),
  erb: async () => (await import("@codemirror/lang-html")).html(),
  php: async () => (await import("@codemirror/lang-php")).php(),
  go: async () => (await import("@codemirror/lang-go")).go(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  py: async () => (await import("@codemirror/lang-python")).python(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  scss: async () => (await import("@codemirror/lang-sass")).sass(),
  sass: async () =>
    (await import("@codemirror/lang-sass")).sass({ indented: true }),
  less: async () => (await import("@codemirror/lang-less")).less(),
  json: async () => (await import("@codemirror/lang-json")).json(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  md: async () => (await import("@codemirror/lang-markdown")).markdown(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  rs: async () => (await import("@codemirror/lang-rust")).rust(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  c: async () => (await import("@codemirror/lang-cpp")).cpp(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  yml: async () => (await import("@codemirror/lang-yaml")).yaml(),
};

const legacyLanguageFactories: Record<string, LanguageExtensionFactory> = {
  ruby: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/ruby"),
      (module) => module.ruby,
    ),
  rb: () => legacyLanguageFactories.ruby(),
  swift: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/swift"),
      (module) => module.swift,
    ),
  bash: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/shell"),
      (module) => module.shell,
    ),
  shell: () => legacyLanguageFactories.bash(),
  sh: () => legacyLanguageFactories.bash(),
  zsh: () => legacyLanguageFactories.bash(),
  fish: () => legacyLanguageFactories.bash(),
  perl: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/perl"),
      (module) => module.perl,
    ),
  lua: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/lua"),
      (module) => module.lua,
    ),
  r: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/r"),
      (module) => module.r,
    ),
  haskell: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/haskell"),
      (module) => module.haskell,
    ),
  clojure: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/clojure"),
      (module) => module.clojure,
    ),
  erlang: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/erlang"),
      (module) => module.erlang,
    ),
  groovy: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/groovy"),
      (module) => module.groovy,
    ),
  diff: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/diff"),
      (module) => module.diff,
    ),
  patch: () => legacyLanguageFactories.diff(),
  dockerfile: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/dockerfile"),
      (module) => module.dockerFile,
    ),
  toml: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/toml"),
      (module) => module.toml,
    ),
  ini: () => legacyLanguageFactories.toml(),
  env: () => legacyLanguageFactories.bash(),
  nginx: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/nginx"),
      (module) => module.nginx,
    ),
  protobuf: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/protobuf"),
      (module) => module.protobuf,
    ),
  powershell: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/powershell"),
      (module) => module.powerShell,
    ),
  ps1: () => legacyLanguageFactories.powershell(),
  fortran: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/fortran"),
      (module) => module.fortran,
    ),
  julia: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/julia"),
      (module) => module.julia,
    ),
  ocaml: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/mllike"),
      (module) => module.oCaml,
    ),
  fsharp: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/mllike"),
      (module) => module.fSharp,
    ),
  lisp: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/commonlisp"),
      (module) => module.commonLisp,
    ),
  delphi: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/pascal"),
      (module) => module.pascal,
    ),
  pascal: () => legacyLanguageFactories.delphi(),
  vb: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/vb"),
      (module) => module.vb,
    ),
  vba: () => legacyLanguageFactories.vb(),
  cobol: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/cobol"),
      (module) => module.cobol,
    ),
  assembly: () =>
    createLegacyLanguage(
      () => import("@codemirror/legacy-modes/mode/gas"),
      (module) => module.gas,
    ),
  asm: () => legacyLanguageFactories.assembly(),
  kotlin: () => createClikeLanguage("kotlin"),
  scala: () => createClikeLanguage("scala"),
  csharp: () => createClikeLanguage("csharp"),
  objectivec: () => createClikeLanguage("objectivec"),
  dart: () => createClikeLanguage("dart"),
  elixir: () => legacyLanguageFactories.ruby(),
  zig: () => createClikeLanguage("clike"),
  ada: () => createClikeLanguage("clike"),
  prolog: () => createClikeLanguage("clike"),
  matlab: () => createClikeLanguage("clike"),
  gleam: () => createClikeLanguage("clike"),
  gdscript: () => officialLanguageFactories.python(),
  graphql: () => createClikeLanguage("clike"),
  terraform: () => legacyLanguageFactories.toml(),
  makefile: () => legacyLanguageFactories.bash(),
  cmake: () => createClikeLanguage("clike"),
  latex: () => officialLanguageFactories.markdown(),
  solidity: () => createClikeLanguage("clike"),
  wgsl: () => createClikeLanguage("clike"),
  glsl: () => createClikeLanguage("clike"),
};

const extensionLanguageMap: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  astro: "astro",
  vue: "vue",
  svelte: "svelte",
  blade: "blade",
  php: "php",
  go: "go",
  py: "python",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  rs: "rust",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  java: "java",
  sql: "sql",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  rb: "ruby",
  swift: "swift",
  sh: "shell",
  bash: "bash",
  zsh: "zsh",
  fish: "fish",
  pl: "perl",
  lua: "lua",
  r: "r",
  hs: "haskell",
  clj: "clojure",
  erl: "erlang",
  groovy: "groovy",
  diff: "diff",
  patch: "patch",
  dockerfile: "dockerfile",
  toml: "toml",
  ini: "ini",
  env: "env",
  nginx: "nginx",
  proto: "protobuf",
  ps1: "powershell",
  f90: "fortran",
  jl: "julia",
  ml: "ocaml",
  fs: "fsharp",
  lisp: "lisp",
  pas: "pascal",
  vb: "vb",
  vba: "vba",
  cob: "cobol",
  asm: "assembly",
  kt: "kotlin",
  scala: "scala",
  cs: "csharp",
  m: "objectivec",
  dart: "dart",
  ex: "elixir",
  zig: "zig",
  tf: "terraform",
  makefile: "makefile",
  cmake: "cmake",
  tex: "latex",
  sol: "solidity",
  wgsl: "wgsl",
  glsl: "glsl",
};

const styleLanguages = new Set(["css", "scss", "sass", "less"]);
const scriptThemeLanguages = new Set([
  "javascript",
  "js",
  "typescript",
  "ts",
  "json",
]);

export function getCodeMirrorLanguageExtension(
  language: string,
): Extension | null {
  const normalized = normalizeCodeMirrorLanguage(language);
  return extensionCache.get(normalized) ?? null;
}

export function getLoadedCodeMirrorLanguageExtension(
  language: string,
): Extension | null {
  return getCodeMirrorLanguageExtension(language);
}

export function loadCodeMirrorLanguageExtension(
  language: string,
): Promise<Extension | null> {
  const normalized = normalizeCodeMirrorLanguage(language);
  if (!normalized) {
    return Promise.resolve(null);
  }

  if (extensionCache.has(normalized)) {
    return Promise.resolve(extensionCache.get(normalized) ?? null);
  }

  const pending = extensionPromiseCache.get(normalized);
  if (pending) {
    return pending;
  }

  const factory =
    officialLanguageFactories[normalized] ??
    legacyLanguageFactories[normalized];
  if (!factory) {
    extensionCache.set(normalized, null);
    return Promise.resolve(null);
  }

  const promise = factory()
    .then((extension) => {
      extensionCache.set(normalized, extension);
      return extension;
    })
    .catch((error) => {
      console.warn(
        `Failed to load CodeMirror language extension: ${normalized}`,
        error,
      );
      return null;
    })
    .finally(() => {
      extensionPromiseCache.delete(normalized);
    });

  extensionPromiseCache.set(normalized, promise);
  return promise;
}

export function inferCodeMirrorLanguageFromPath(filePath: string): string {
  const normalizedPath = filePath.trim().toLowerCase();
  const fileName = normalizedPath.split(/[\\/]/).pop() ?? normalizedPath;

  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return "dockerfile";
  }
  if (fileName === "makefile") {
    return "makefile";
  }

  const extension = fileName.includes(".")
    ? (fileName.split(".").pop() ?? "")
    : fileName;
  return extensionLanguageMap[extension] ?? "";
}

export function isCodeMirrorStyleLanguage(language: string): boolean {
  return styleLanguages.has(normalizeCodeMirrorLanguage(language));
}

export function isCodeMirrorColorToolTarget(
  language: string,
  filePath?: string,
): boolean {
  const normalizedLanguage = normalizeCodeMirrorLanguage(language);
  if (isCodeMirrorStyleLanguage(normalizedLanguage)) {
    return true;
  }

  if (!scriptThemeLanguages.has(normalizedLanguage) || !filePath) {
    return false;
  }

  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return /(?:^|[-_.])(theme|themes|color|colors|palette)(?:[-_.]|$)/.test(
    fileName,
  );
}
