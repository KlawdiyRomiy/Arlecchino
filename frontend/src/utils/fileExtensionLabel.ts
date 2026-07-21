// Shared file-extension label helpers. Mirrors the FileExplorer inline
// extension labels (filename.EXT) so other surfaces (browser rail, palettes)
// can render the same compact language badge with the same theme-derived
// color slot without importing FileExplorer internals.

const FILE_LABEL_SLOT_COUNT = 10;

const EXTENSION_LABEL_MAP: Record<string, string> = {
  ts: "TS",
  tsx: "TSX",
  js: "JS",
  jsx: "JSX",
  mjs: "JS",
  cjs: "JS",
  go: "GO",
  mod: "MOD",
  sum: "SUM",
  rs: "RS",
  py: "PY",
  rb: "RB",
  php: "PHP",
  vue: "VUE",
  svelte: "SVLT",
  astro: "ASTRO",
  css: "CSS",
  scss: "SCSS",
  sass: "SASS",
  less: "LESS",
  html: "HTML",
  htm: "HTML",
  json: "JSON",
  yaml: "YML",
  yml: "YML",
  toml: "TOML",
  sql: "SQL",
  md: "MD",
  mdx: "MD",
  txt: "TXT",
  java: "JAVA",
  kt: "KT",
  kts: "KT",
  scala: "SCALA",
  cs: "C#",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  c: "C",
  h: "H",
  hpp: "H++",
  swift: "SWIFT",
  dart: "DART",
  lua: "LUA",
  r: "R",
  hs: "HS",
  ex: "EX",
  exs: "EX",
  erl: "ERL",
  zig: "ZIG",
  sh: "SH",
  bash: "SH",
  zsh: "SH",
  ps1: "PS",
  dockerfile: "DOCKER",
  tf: "TF",
  xml: "XML",
  gql: "GQL",
  prisma: "PRISMA",
  wgsl: "WGSL",
  sol: "SOL",
};

const FILE_LABEL_SLOT_OVERRIDES: Record<string, number> = {
  TS: 1,
  TSX: 1,
  JS: 3,
  JSX: 3,
  GO: 5,
  MOD: 5,
  RS: 5,
  SWIFT: 5,
  SOL: 5,
  WGSL: 5,
  SUM: 9,
  C: 1,
  "C++": 1,
  H: 1,
  "H++": 1,
  XML: 1,
  PS: 1,
  "C#": 6,
  KT: 6,
  SCALA: 6,
  TF: 6,
  DOCKER: 1,
  YML: 2,
  ZIG: 3,
  PY: 3,
  TOML: 3,
  JSON: 4,
  SH: 2,
  PHP: 6,
  SCSS: 6,
  SASS: 6,
  LESS: 6,
  CSS: 1,
  HTML: 4,
  MD: 9,
  SQL: 7,
  RB: 4,
  JAVA: 4,
  GQL: 6,
  PRISMA: 7,
  ERL: 7,
  EX: 7,
  DART: 0,
  LUA: 0,
  HS: 0,
  R: 8,
};

const getFileLabelSlot = (label: string): number => {
  const overrideSlot = FILE_LABEL_SLOT_OVERRIDES[label];
  if (typeof overrideSlot === "number") {
    return overrideSlot;
  }

  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return hash % FILE_LABEL_SLOT_COUNT;
};

export const getFileExtensionLabel = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return fileName.slice(0, 2).toUpperCase();
  }

  const extension = fileName.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_LABEL_MAP[extension] ?? extension.slice(0, 4).toUpperCase();
};

export const getFileExtensionLabelColor = (label: string): string =>
  `var(--explorer-file-label-${getFileLabelSlot(label)}, var(--text-secondary))`;
