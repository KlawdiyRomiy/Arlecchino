import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Home,
  RefreshCw,
  X,
  Zap,
  ZapOff,
} from "lucide-react";

import { openExternalUrlWithCapability } from "../shell/browser";
import { useTheme } from "../hooks/useTheme";
import {
  isAllowedPreviewUrl,
  useBrowserPreviewStore,
} from "../stores/browserPreviewStore";
import { getThemeColors, radius } from "../styles/colors";

interface BrowserPreviewProps {
  initialUrl?: string;
  currentUrl?: string;
  htmlContent?: string;
  sourceLabel?: string;
  revision?: number;
  onClose?: () => void;
}

const DEFAULT_PREVIEW_URL = "http://localhost:8000";
const STATIC_PREVIEW_URL = "about:srcdoc";

const normalizeInlinePreviewDocument = (value?: string): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : value;
};

export const BrowserPreview: React.FC<BrowserPreviewProps> = ({
  initialUrl = DEFAULT_PREVIEW_URL,
  currentUrl,
  htmlContent,
  sourceLabel,
  revision,
  onClose,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const allowedOrigins = useBrowserPreviewStore((s) => s.allowedOrigins);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initialInlineDocumentRef = useRef<string | null>(
    normalizeInlinePreviewDocument(htmlContent),
  );

  const initialInlineDocument = normalizeInlinePreviewDocument(htmlContent);
  const startsWithInlineDocument = initialInlineDocument !== null;

  const [url, setUrl] = useState(
    startsWithInlineDocument ? STATIC_PREVIEW_URL : initialUrl,
  );
  const [inputUrl, setInputUrl] = useState(
    startsWithInlineDocument ? STATIC_PREVIEW_URL : initialUrl,
  );
  const [isLoading, setIsLoading] = useState(!startsWithInlineDocument);
  const [history, setHistory] = useState<string[]>([
    startsWithInlineDocument ? STATIC_PREVIEW_URL : initialUrl,
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [urlWarning, setUrlWarning] = useState<string | null>(null);
  const [inlineDocument, setInlineDocument] = useState<string | null>(
    initialInlineDocument,
  );

  const focusPreviewFrame = useCallback(() => {
    iframeRef.current?.focus();
  }, []);

  const navigate = useCallback(
    (newUrl: string) => {
      let finalUrl = newUrl.trim();
      if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
        finalUrl = "http://" + finalUrl;
      }
      if (!isAllowedPreviewUrl(finalUrl, allowedOrigins)) {
        setUrlWarning(
          "URL not allowed: only localhost and loopback addresses are supported.",
        );
        setTimeout(() => setUrlWarning(null), 3000);
        return;
      }
      setUrlWarning(null);
      setInlineDocument(null);
      setUrl(finalUrl);
      setInputUrl(finalUrl);
      setIsLoading(true);
      setHistory((prev) => [...prev.slice(0, historyIndex + 1), finalUrl]);
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex, allowedOrigins],
  );

  const restoreInlinePreview = useCallback(() => {
    if (initialInlineDocumentRef.current === null) {
      return;
    }

    setInlineDocument(initialInlineDocumentRef.current);
    setUrl(STATIC_PREVIEW_URL);
    setInputUrl(STATIC_PREVIEW_URL);
    setIsLoading(true);
  }, []);

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const nextLocation = history[newIndex];
      setHistoryIndex(newIndex);
      if (
        nextLocation === STATIC_PREVIEW_URL &&
        initialInlineDocumentRef.current !== null
      ) {
        restoreInlinePreview();
      } else {
        setInlineDocument(null);
        setUrl(nextLocation);
        setInputUrl(nextLocation);
        setIsLoading(true);
      }
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const nextLocation = history[newIndex];
      setHistoryIndex(newIndex);
      if (
        nextLocation === STATIC_PREVIEW_URL &&
        initialInlineDocumentRef.current !== null
      ) {
        restoreInlinePreview();
      } else {
        setInlineDocument(null);
        setUrl(nextLocation);
        setInputUrl(nextLocation);
        setIsLoading(true);
      }
    }
  };

  const refresh = useCallback(() => {
    setIsLoading(true);
    setLastRefresh(Date.now());
    if (inlineDocument || !iframeRef.current) {
      return;
    }

    iframeRef.current.src = url;
  }, [inlineDocument, url]);

  const goHome = () => {
    if (initialInlineDocumentRef.current !== null) {
      restoreInlinePreview();
      setHistory([STATIC_PREVIEW_URL]);
      setHistoryIndex(0);
      setLastRefresh(Date.now());
      return;
    }

    navigate(initialUrl);
  };

  const openExternal = () => {
    if (inlineDocument) {
      return;
    }
    void openExternalUrlWithCapability(url);
  };

  useEffect(() => {
    if (!autoRefresh) return;

    const handleFileSaved = (e: Event) => {
      const event = e as CustomEvent<{ path: string }>;
      const path = event.detail?.path || "";

      const refreshableExts = [
        "php",
        "blade",
        "html",
        "css",
        "scss",
        "js",
        "ts",
        "vue",
        "jsx",
        "tsx",
      ];
      if (refreshableExts.some((ext) => path.includes(`.${ext}`))) {
        console.log("[BrowserPreview] Auto-refresh triggered by:", path);
        setTimeout(refresh, 100);
      }
    };

    window.addEventListener("file-saved", handleFileSaved);
    return () => window.removeEventListener("file-saved", handleFileSaved);
  }, [autoRefresh, refresh]);

  useEffect(() => {
    if (currentUrl && currentUrl !== url) {
      navigate(currentUrl);
    }
  }, [currentUrl, url, navigate]);

  useEffect(() => {
    const nextInlineDocument = normalizeInlinePreviewDocument(htmlContent);
    initialInlineDocumentRef.current = nextInlineDocument;

    if (nextInlineDocument === null) {
      return;
    }

    setInlineDocument(nextInlineDocument);
    setUrl(STATIC_PREVIEW_URL);
    setInputUrl(STATIC_PREVIEW_URL);
    setHistory([STATIC_PREVIEW_URL]);
    setHistoryIndex(0);
    setUrlWarning(null);
    setIsLoading(true);
    setLastRefresh(Date.now());
  }, [htmlContent, revision, sourceLabel]);

  return (
    <div
      data-testid="browser-preview-root"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: theme.bg,
        fontSize: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: `1px solid ${theme.border}`,
          background: theme.bgSecondary,
        }}
      >
        <button
          type="button"
          onClick={goBack}
          disabled={historyIndex <= 0}
          style={{
            background: "transparent",
            border: "none",
            cursor: historyIndex > 0 ? "pointer" : "not-allowed",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
            opacity: historyIndex > 0 ? 1 : 0.4,
          }}
        >
          <ArrowLeft size={16} style={{ color: theme.textMuted }} />
        </button>

        <button
          type="button"
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          style={{
            background: "transparent",
            border: "none",
            cursor:
              historyIndex < history.length - 1 ? "pointer" : "not-allowed",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
            opacity: historyIndex < history.length - 1 ? 1 : 0.4,
          }}
        >
          <ArrowRight size={16} style={{ color: theme.textMuted }} />
        </button>

        <button
          type="button"
          onClick={refresh}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
          }}
        >
          <RefreshCw
            size={16}
            style={{
              color: theme.textMuted,
              animation: isLoading ? "spin 1s linear infinite" : "none",
            }}
          />
        </button>

        <button
          type="button"
          onClick={goHome}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
          }}
        >
          <Home size={16} style={{ color: theme.textMuted }} />
        </button>

        <input
          type="text"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              navigate(inputUrl);
            }
          }}
          placeholder={DEFAULT_PREVIEW_URL}
          title={inlineDocument && sourceLabel ? sourceLabel : undefined}
          style={{
            flex: 1,
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            borderRadius: radius.sm,
            padding: "4px 10px",
            fontSize: 12,
            color: theme.text,
            outline: "none",
          }}
        />

        {inlineDocument && sourceLabel && (
          <span
            style={{
              maxWidth: 160,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 11,
              color: theme.textMuted,
            }}
            title={sourceLabel}
          >
            {sourceLabel}
          </span>
        )}

        <button
          type="button"
          onClick={() => setAutoRefresh(!autoRefresh)}
          style={{
            background: autoRefresh
              ? isDark
                ? "rgba(34, 197, 94, 0.2)"
                : "rgba(34, 197, 94, 0.1)"
              : "transparent",
            border: `1px solid ${autoRefresh ? "#22C55E" : theme.border}`,
            cursor: "pointer",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
          }}
          title={autoRefresh ? "Auto-refresh enabled" : "Auto-refresh disabled"}
        >
          {autoRefresh ? (
            <Zap size={16} style={{ color: "#22C55E" }} />
          ) : (
            <ZapOff size={16} style={{ color: theme.textMuted }} />
          )}
        </button>

        <button
          type="button"
          onClick={openExternal}
          disabled={inlineDocument !== null}
          style={{
            background: "transparent",
            border: "none",
            cursor: inlineDocument ? "not-allowed" : "pointer",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
            opacity: inlineDocument ? 0.45 : 1,
          }}
          title={
            inlineDocument
              ? "Static preview cannot be opened externally"
              : "Open in browser"
          }
        >
          <ExternalLink size={16} style={{ color: theme.textMuted }} />
        </button>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: radius.sm,
              display: "flex",
            }}
          >
            <X size={16} style={{ color: theme.textMuted }} />
          </button>
        )}
      </div>

      {urlWarning && (
        <div
          style={{
            padding: "4px 12px",
            fontSize: 11,
            color: "#EF4444",
            background: isDark ? "rgba(239,68,68,0.1)" : "rgba(239,68,68,0.07)",
            borderBottom: `1px solid rgba(239,68,68,0.3)`,
          }}
        >
          {urlWarning}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {isLoading && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: `linear-gradient(90deg, transparent, #EF4444, transparent)`,
              animation: "loading 1s ease-in-out infinite",
            }}
          />
        )}
        <iframe
          key={lastRefresh}
          ref={iframeRef}
          title="Browser preview"
          src={inlineDocument ? undefined : url}
          srcDoc={inlineDocument ?? undefined}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            border: "none",
            background: isDark ? "#1F2937" : "#fff",
          }}
          onPointerDown={focusPreviewFrame}
          onPointerEnter={focusPreviewFrame}
          onWheel={focusPreviewFrame}
          onLoad={() => setIsLoading(false)}
          sandbox="allow-scripts allow-forms allow-popups"
        />
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default BrowserPreview;
