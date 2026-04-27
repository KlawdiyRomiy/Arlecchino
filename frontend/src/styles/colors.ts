export const colors = {
  laravel: {
    red: "#FF0000",
    redHover: "#DC2626",
    redLight: "rgba(239, 68, 68, 0.1)",
    redGlow: "rgba(239, 68, 68, 0.5)",
    orange: "#F97316", // Pin icon color
  },

  // BLACKPRINT Color Scheme
  blackprint: {
    bg: "#0a0a0a",
    bgSecondary: "#111111",
    bgTertiary: "#1a1a1a",
    bgElevated: "#222222",
    bgHover: "#2a2a2a",
    textPrimary: "#ffffff",
    textSecondary: "#888888",
    textTertiary: "#555555",
    textMuted: "#444444",
    borderSubtle: "#2a2a2a",
    borderDefault: "#333333",
    gridLine: "rgba(255, 255, 255, 0.04)",
  },

  light: {
    bg: "#FFFFFF",
    bgSecondary: "#F9FAFB",
    bgTertiary: "#F3F4F6",
    bgPanel: "#FFFFFF",
    bgHover: "#F3F4F6",
    border: "#E5E7EB",
    borderSubtle: "#E5E7EB",
    borderLight: "#F3F4F6",
    text: "#111827",
    textPrimary: "#111827",
    textSecondary: "#6B7280",
    textMuted: "#9CA3AF",
  },

  dark: {
    bg: "#0a0a0a",
    bgSecondary: "#111111",
    bgTertiary: "#1a1a1a",
    bgPanel: "#111111",
    bgHover: "#2a2a2a",
    border: "#2a2a2a",
    borderSubtle: "#2a2a2a",
    borderLight: "#333333",
    text: "#ffffff",
    textPrimary: "#ffffff",
    textSecondary: "#888888",
    textMuted: "#444444",
  },

  syntax: {
    keyword: "#C678DD",
    string: "#98C379",
    number: "#D19A66",
    comment: "#5C6370",
    function: "#61AFEF",
    variable: "#E06C75",
    class: "#E5C07B",
    operator: "#56B6C2",
  },

  status: {
    success: "#22C55E",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
  },

  method: {
    get: "#3B82F6",
    post: "#22C55E",
    put: "#F59E0B",
    patch: "#F59E0B",
    delete: "#EF4444",
    options: "#8B5CF6",
  },

  fileType: {
    php: "#777BB4",
    blade: "#F05340",
    js: "#F7DF1E",
    ts: "#3178C6",
    jsx: "#61DAFB",
    tsx: "#61DAFB",
    vue: "#42B883",
    svelte: "#FF3E00",
    astro: "#FF5D01",
    json: "#CBCB41",
    css: "#264DE4",
    scss: "#CD6799",
    sass: "#CD6799",
    less: "#1D365D",
    html: "#E34F26",
    md: "#519ABA",
    txt: "#6B7280",
    env: "#ECD53F",
    yaml: "#CB171E",
    yml: "#CB171E",
    toml: "#9C4121",
    sql: "#336791",
    go: "#00ADD8",
    rs: "#DEA584",
    rust: "#DEA584",
    py: "#4B8BBE",
    rb: "#CC342D",
    java: "#ED8B00",
    kt: "#7F52FF",
    scala: "#DC322F",
    cs: "#512BD4",
    cpp: "#00599C",
    c: "#A8B9CC",
    h: "#A8B9CC",
    hpp: "#00599C",
    swift: "#F05138",
    dart: "#0175C2",
    lua: "#51A0CF",
    perl: "#6E7EC2",
    pl: "#6E7EC2",
    r: "#276DC3",
    hs: "#8B7EB8",
    haskell: "#8B7EB8",
    clj: "#5881D8",
    clojure: "#5881D8",
    erl: "#A90533",
    erlang: "#A90533",
    ex: "#6E4A7E",
    elixir: "#6E4A7E",
    groovy: "#4298B8",
    sh: "#4EAA25",
    bash: "#4EAA25",
    zsh: "#4EAA25",
    ps1: "#5391FE",
    powershell: "#5391FE",
    dockerfile: "#2496ED",
    docker: "#2496ED",
    nginx: "#009639",
    proto: "#4285F4",
    protobuf: "#4285F4",
    xml: "#E34C26",
    svg: "#FFB13B",
    diff: "#41B883",
    patch: "#41B883",
    m: "#438EFF",
    mm: "#438EFF",
    graphql: "#E10098",
    gql: "#E10098",
    prisma: "#2D3748",
    tf: "#844FBA",
    terraform: "#844FBA",
    sol: "#363636",
    zig: "#F7A41D",
    nim: "#FFE953",
    v: "#5D87BF",
    image: "#8B5CF6",
  },
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.05)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
  panel:
    "0 0 0 1px rgba(0, 0, 0, 0.1), 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 12px 16px -4px rgba(0, 0, 0, 0.35), 0 24px 32px -8px rgba(0, 0, 0, 0.3)",
  panelDark: "0 8px 32px rgba(0, 0, 0, 0.4)",
  glow: "0 0 20px rgba(239, 68, 68, 0.3)",
  floating: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
} as const;

export const transitions = {
  // Быстрые интерактивные элементы (hover, кнопки)
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  // Стандартные переходы (панели, меню)
  normal: "250ms cubic-bezier(0.4, 0, 0.2, 1)",
  // Медленные переходы (модалки, большие элементы)
  slow: "350ms cubic-bezier(0.4, 0, 0.2, 1)",
  // Пружинистый эффект (для выезжающих элементов)
  spring: "400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  // Плавный ease-out для панелей
  smooth: "300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  // Для появления/исчезновения
  fade: "200ms ease-in-out",
} as const;

export const blur = {
  sm: "blur(4px)",
  md: "blur(8px)",
  lg: "blur(16px)",
  xl: "blur(24px)",
  panel: "blur(20px)",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  xxl: "48px",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  xl: "20px",
  full: "9999px",
} as const;

export const zIndex = {
  base: 0,
  panel: 10,
  editorTabs: 15,
  floatingPanel: 20,
  dropdown: 30,
  modal: 40,
  notification: 50,
  tooltip: 60,
} as const;

export type Theme = "light" | "dark";

const cssThemeColors = {
  bg: "var(--surface-canvas)",
  bgSecondary: "var(--bg-secondary)",
  bgTertiary: "var(--bg-tertiary)",
  bgPanel: "var(--surface-elevated)",
  bgHover: "var(--bg-hover)",
  border: "var(--border-default)",
  borderSubtle: "var(--border-subtle)",
  borderLight: "var(--border-strong)",
  text: "var(--text-primary)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
} as const;

export const getThemeColors = (_isDark: boolean) => cssThemeColors;
