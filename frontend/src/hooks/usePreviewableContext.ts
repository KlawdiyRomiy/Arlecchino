import { useMemo } from "react";

import type { EditorTab } from "../stores/editorStore";
import { useEditorStore } from "../stores/editorStore";
import {
  type BrowserPreviewTarget,
  isAllowedPreviewUrl,
  normalizeProjectPathKey,
  useBrowserPreviewStore,
} from "../stores/browserPreviewStore";
import { useExplorerStore } from "../stores/explorerStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { OpenPreviewWindowInput } from "../stores/previewWindowStore";

const DEFAULT_PREVIEW_BUTTON_WINDOW_ID = "preview-browser-default";
const STATIC_PREVIEW_URL = "about:srcdoc";

const STATIC_HTML_EXTENSIONS = [".html", ".htm"];
const PREVIEWABLE_EXTENSIONS = [
  ".html",
  ".htm",
  ".jsx",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".php",
  ".blade.php",
  ".twig",
  ".njk",
  ".hbs",
  ".handlebars",
];
const PREVIEWABLE_LANGUAGES = new Set([
  "html",
  "vue",
  "svelte",
  "astro",
  "php",
  "blade",
  "javascriptreact",
  "typescriptreact",
  "jsx",
  "tsx",
]);
const FRONTEND_CONFIG_FILES = new Set([
  "package.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "nuxt.config.js",
  "astro.config.ts",
  "astro.config.mjs",
  "svelte.config.js",
  "webpack.config.js",
  "webpack.config.ts",
]);

export type PreviewButtonKind =
  | "none"
  | "live-url"
  | "static-html"
  | "empty-state";

export interface PreviewButtonState {
  enabled: boolean;
  active: boolean;
  kind: PreviewButtonKind;
  buttonTitle: string;
  launchInput: OpenPreviewWindowInput | null;
}

interface ResolvePreviewButtonStateInput {
  activeTab: EditorTab | null | undefined;
  projectPath: string;
  lastKnownTarget: BrowserPreviewTarget | null;
  allowedOrigins: string[];
}

function getBaseName(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  return segments[segments.length - 1] ?? "";
}

function hasMatchingExtension(path: string, extensions: string[]): boolean {
  const lowerPath = path.toLowerCase();
  return extensions.some((extension) => lowerPath.endsWith(extension));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toInlinePreviewDocument(content: string, title: string): string {
  const trimmedContent = content.trim();
  if (trimmedContent === "") {
    return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body></body></html>`;
  }

  if (/<html[\s>]/i.test(trimmedContent) || /<!doctype/i.test(trimmedContent)) {
    return content;
  }

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body>${content}</body></html>`;
}

function buildEmptyPreviewDocument(tab: EditorTab): string {
  const title = escapeHtml(tab.name || "Preview unavailable");
  const path = escapeHtml(tab.path || tab.name || "current file");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>No running preview</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #121212;
        --panel: #1b1b1b;
        --muted: #9ca3af;
        --text: #f3f4f6;
        --accent: #22c55e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(34, 197, 94, 0.14), transparent 34%),
          linear-gradient(180deg, #151515, var(--bg));
        color: var(--text);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      main {
        width: min(560px, calc(100vw - 32px));
        padding: 24px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
        box-shadow: 0 24px 80px rgba(0,0,0,0.32);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 12px;
        color: var(--muted);
        line-height: 1.6;
      }
      code {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.06);
        color: var(--text);
      }
      .hint {
        margin-top: 20px;
        padding: 14px 16px;
        border-radius: 14px;
        background: rgba(34, 197, 94, 0.08);
        color: var(--text);
      }
      .accent {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>No running preview</h1>
      <p><span class="accent">${title}</span> is previewable, but Arlecchino has not seen an active localhost target for this project yet.</p>
      <p>Start a dev server from the terminal, or reopen the last preview target once Arlecchino learns it from terminal, chat, MCP, or the Preview button.</p>
      <div class="hint">
        <p><strong>Current file</strong></p>
        <p><code>${path}</code></p>
      </div>
    </main>
  </body>
</html>`;
}

function isStaticHtmlTab(tab: EditorTab | null | undefined): tab is EditorTab {
  if (!tab) {
    return false;
  }
  return hasMatchingExtension(tab.path, STATIC_HTML_EXTENSIONS);
}

function isPreviewableTab(tab: EditorTab | null | undefined): tab is EditorTab {
  if (!tab) {
    return false;
  }

  const lowerLanguage = tab.language.trim().toLowerCase();
  if (PREVIEWABLE_LANGUAGES.has(lowerLanguage)) {
    return true;
  }

  if (hasMatchingExtension(tab.path, PREVIEWABLE_EXTENSIONS)) {
    return true;
  }

  return FRONTEND_CONFIG_FILES.has(getBaseName(tab.path).toLowerCase());
}

function buildLivePreviewInput(url: string): OpenPreviewWindowInput {
  return {
    id: DEFAULT_PREVIEW_BUTTON_WINDOW_ID,
    surface: "browser",
    title: "Browser Preview",
    payload: {
      title: "Browser Preview",
      url,
      htmlContent: "",
      sourceLabel: "",
    },
    side: "right",
    mode: "snapped",
  };
}

function buildStaticPreviewInput(tab: EditorTab): OpenPreviewWindowInput {
  return {
    id: DEFAULT_PREVIEW_BUTTON_WINDOW_ID,
    surface: "browser",
    title: `Preview ${tab.name}`,
    payload: {
      title: `Preview ${tab.name}`,
      url: "",
      htmlContent: toInlinePreviewDocument(tab.content, tab.name),
      sourceLabel: tab.name,
    },
    side: "right",
    mode: "snapped",
  };
}

function buildEmptyPreviewInput(tab: EditorTab): OpenPreviewWindowInput {
  return {
    id: DEFAULT_PREVIEW_BUTTON_WINDOW_ID,
    surface: "browser",
    title: "No running preview",
    payload: {
      title: "No running preview",
      url: "",
      htmlContent: buildEmptyPreviewDocument(tab),
      sourceLabel: STATIC_PREVIEW_URL,
    },
    side: "right",
    mode: "snapped",
  };
}

export function resolvePreviewButtonState({
  activeTab,
  projectPath: _projectPath,
  lastKnownTarget,
  allowedOrigins,
}: ResolvePreviewButtonStateInput): PreviewButtonState {
  if (
    lastKnownTarget &&
    isAllowedPreviewUrl(lastKnownTarget.url, allowedOrigins)
  ) {
    return {
      enabled: true,
      active: true,
      kind: "live-url",
      buttonTitle: `Open live preview (${lastKnownTarget.url})`,
      launchInput: buildLivePreviewInput(lastKnownTarget.url),
    };
  }

  if (isStaticHtmlTab(activeTab)) {
    return {
      enabled: true,
      active: true,
      kind: "static-html",
      buttonTitle: `Preview ${activeTab.name}`,
      launchInput: buildStaticPreviewInput(activeTab),
    };
  }

  if (isPreviewableTab(activeTab)) {
    return {
      enabled: true,
      active: false,
      kind: "empty-state",
      buttonTitle: "No running preview. Open preview status.",
      launchInput: buildEmptyPreviewInput(activeTab),
    };
  }

  return {
    enabled: false,
    active: false,
    kind: "none",
    buttonTitle: "Preview unavailable for the current context.",
    launchInput: null,
  };
}

export function usePreviewableContext(): PreviewButtonState {
  const activeTab = useEditorStore((state) =>
    state.getActiveTab(state.activePaneId),
  );
  const explorerProjectPath = useExplorerStore((state) => state.projectPath);
  const workspaceProjectPath = useWorkspaceStore((state) => {
    const activeProject = state.projects.find(
      (project) => project.id === state.activeId,
    );
    return activeProject?.path ?? "";
  });
  const allowedOrigins = useBrowserPreviewStore(
    (state) => state.allowedOrigins,
  );
  const lastKnownTargetByProject = useBrowserPreviewStore(
    (state) => state.lastKnownTargetByProject,
  );

  const projectPath = explorerProjectPath || workspaceProjectPath;
  const projectKey = normalizeProjectPathKey(projectPath);

  const lastKnownTarget = projectKey
    ? (lastKnownTargetByProject[projectKey] ?? null)
    : null;

  return useMemo(
    () =>
      resolvePreviewButtonState({
        activeTab,
        projectPath,
        lastKnownTarget,
        allowedOrigins,
      }),
    [activeTab, allowedOrigins, lastKnownTarget, projectPath],
  );
}
