import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { less } from "@codemirror/lang-less";
import { sass } from "@codemirror/lang-sass";
import { vue } from "@codemirror/lang-vue";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { r } from "@codemirror/legacy-modes/mode/r";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { clike } from "@codemirror/legacy-modes/mode/clike";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { oCaml, fSharp } from "@codemirror/legacy-modes/mode/mllike";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { cobol } from "@codemirror/legacy-modes/mode/cobol";
import { gas } from "@codemirror/legacy-modes/mode/gas";

type LanguageExtensionFactory = () => Extension;

const normalizeCodeMirrorLanguage = (language: string): string =>
  language.trim().toLowerCase();

const officialLanguageFactories: Record<string, LanguageExtensionFactory> = {
  javascript: () => javascript(),
  js: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  ts: () => javascript({ typescript: true }),
  javascriptreact: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  typescriptreact: () => javascript({ jsx: true, typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  astro: () => javascript({ jsx: true, typescript: true }),
  vue: () => vue({ base: html() }),
  svelte: () => html(),
  blade: () => html(),
  erb: () => html(),
  php: () => php(),
  go: () => go(),
  python: () => python(),
  py: () => python(),
  html: () => html(),
  css: () => css(),
  scss: () => sass(),
  sass: () => sass({ indented: true }),
  less: () => less(),
  json: () => json(),
  markdown: () => markdown(),
  md: () => markdown(),
  rust: () => rust(),
  rs: () => rust(),
  cpp: () => cpp(),
  c: () => cpp(),
  java: () => java(),
  sql: () => sql(),
  xml: () => xml(),
  yaml: () => yaml(),
  yml: () => yaml(),
};

const legacyLanguageFactories: Record<string, LanguageExtensionFactory> = {
  ruby: () => StreamLanguage.define(ruby),
  rb: () => StreamLanguage.define(ruby),
  swift: () => StreamLanguage.define(swift),
  bash: () => StreamLanguage.define(shell),
  shell: () => StreamLanguage.define(shell),
  sh: () => StreamLanguage.define(shell),
  zsh: () => StreamLanguage.define(shell),
  fish: () => StreamLanguage.define(shell),
  perl: () => StreamLanguage.define(perl),
  lua: () => StreamLanguage.define(lua),
  r: () => StreamLanguage.define(r),
  haskell: () => StreamLanguage.define(haskell),
  clojure: () => StreamLanguage.define(clojure),
  erlang: () => StreamLanguage.define(erlang),
  groovy: () => StreamLanguage.define(groovy),
  diff: () => StreamLanguage.define(diff),
  patch: () => StreamLanguage.define(diff),
  dockerfile: () => StreamLanguage.define(dockerFile),
  toml: () => StreamLanguage.define(toml),
  ini: () => StreamLanguage.define(toml),
  env: () => StreamLanguage.define(shell),
  nginx: () => StreamLanguage.define(nginx),
  protobuf: () => StreamLanguage.define(protobuf),
  powershell: () => StreamLanguage.define(powerShell),
  ps1: () => StreamLanguage.define(powerShell),
  fortran: () => StreamLanguage.define(fortran),
  julia: () => StreamLanguage.define(julia),
  ocaml: () => StreamLanguage.define(oCaml),
  fsharp: () => StreamLanguage.define(fSharp),
  lisp: () => StreamLanguage.define(commonLisp),
  delphi: () => StreamLanguage.define(pascal),
  pascal: () => StreamLanguage.define(pascal),
  vb: () => StreamLanguage.define(vb),
  vba: () => StreamLanguage.define(vb),
  cobol: () => StreamLanguage.define(cobol),
  assembly: () => StreamLanguage.define(gas),
  asm: () => StreamLanguage.define(gas),
  kotlin: () => StreamLanguage.define(clike({ name: "kotlin" })),
  scala: () => StreamLanguage.define(clike({ name: "scala" })),
  csharp: () => StreamLanguage.define(clike({ name: "csharp" })),
  objectivec: () => StreamLanguage.define(clike({ name: "objectivec" })),
  dart: () => StreamLanguage.define(clike({ name: "dart" })),
  elixir: () => StreamLanguage.define(ruby),
  zig: () => StreamLanguage.define(clike({ name: "clike" })),
  ada: () => StreamLanguage.define(clike({ name: "clike" })),
  prolog: () => StreamLanguage.define(clike({ name: "clike" })),
  matlab: () => StreamLanguage.define(clike({ name: "clike" })),
  gleam: () => StreamLanguage.define(clike({ name: "clike" })),
  gdscript: () => python(),
  graphql: () => StreamLanguage.define(clike({ name: "clike" })),
  terraform: () => StreamLanguage.define(toml),
  makefile: () => StreamLanguage.define(shell),
  cmake: () => StreamLanguage.define(clike({ name: "clike" })),
  latex: () => markdown(),
  solidity: () => StreamLanguage.define(clike({ name: "clike" })),
  wgsl: () => StreamLanguage.define(clike({ name: "clike" })),
  glsl: () => StreamLanguage.define(clike({ name: "clike" })),
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
  const officialFactory = officialLanguageFactories[normalized];
  if (officialFactory) {
    return officialFactory();
  }

  const legacyFactory = legacyLanguageFactories[normalized];
  if (legacyFactory) {
    return legacyFactory();
  }

  return null;
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
