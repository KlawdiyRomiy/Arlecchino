import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { openExternalUrlWithCapability } from "../shell/browser";
import { useBrowserPreviewStore } from "../stores/browserPreviewStore";
import type { MarkdownPreviewSource } from "./layout/MainLayout.types";

interface MarkdownPreviewPanelContentProps {
  source: MarkdownPreviewSource | null;
  onOpenExternalLinkPreview?: (url: string) => void;
}

const isAbsoluteHttpUrl = (href: string | undefined): href is string => {
  if (!href) {
    return false;
  }

  try {
    const parsedUrl = new URL(href);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
};

const markdownComponents = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1
      className="mb-4 border-b border-[var(--shell-border)] pb-3 text-2xl font-semibold leading-tight text-[var(--text-primary)]"
      {...props}
    />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mb-3 mt-6 border-b border-[var(--shell-border)] pb-2 text-xl font-semibold leading-tight text-[var(--text-primary)]"
      {...props}
    />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="mb-2 mt-5 text-base font-semibold text-[var(--text-primary)]"
      {...props}
    />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-3 leading-7 text-[var(--text-secondary)]" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="mb-4 list-disc space-y-1 pl-6 text-[var(--text-secondary)]"
      {...props}
    />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="mb-4 list-decimal space-y-1 pl-6 text-[var(--text-secondary)]"
      {...props}
    />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li className="leading-7" {...props} />
  ),
  blockquote: (props: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="mb-4 border-l-2 border-[var(--accent-primary)]/70 bg-[var(--bg-tertiary)]/45 px-4 py-2 text-[var(--text-secondary)]"
      {...props}
    />
  ),
  code: ({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement>) => (
    <code
      className={`${className ?? ""} rounded border border-[var(--shell-border)] bg-[var(--bg-blackprint)] px-1.5 py-0.5 font-mono text-[0.88em] text-[var(--text-primary)]`}
      {...props}
    >
      {children}
    </code>
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="mb-4 overflow-auto rounded-md border border-[var(--shell-border)] bg-[var(--bg-blackprint)] p-3 text-sm leading-6 text-[var(--text-primary)]"
      {...props}
    />
  ),
  table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="mb-4 overflow-auto">
      <table
        className="w-full border-collapse text-left text-sm text-[var(--text-secondary)]"
        {...props}
      />
    </div>
  ),
  th: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th
      className="border border-[var(--shell-border)] bg-[var(--bg-tertiary)] px-3 py-2 font-semibold text-[var(--text-primary)]"
      {...props}
    />
  ),
  td: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-[var(--shell-border)] px-3 py-2" {...props} />
  ),
  img: ({ alt = "", ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img
      alt={alt}
      className="my-4 max-w-full rounded-md border border-[var(--shell-border)]"
      draggable={false}
      {...props}
    />
  ),
};

export const MarkdownPreviewPanelContent: React.FC<
  MarkdownPreviewPanelContentProps
> = ({ source, onOpenExternalLinkPreview }) => {
  const markdownLinkOpenMode = useBrowserPreviewStore(
    (state) => state.markdownLinkOpenMode,
  );
  const components = React.useMemo(
    () => ({
      ...markdownComponents,
      a: ({
        href,
        onClick,
        ...props
      }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event);
          if (event.defaultPrevented || !isAbsoluteHttpUrl(href)) {
            return;
          }

          event.preventDefault();
          if (markdownLinkOpenMode === "preview" && onOpenExternalLinkPreview) {
            onOpenExternalLinkPreview(href);
            return;
          }

          void openExternalUrlWithCapability(href);
        };

        return (
          <a
            className="text-[var(--accent-primary)] underline decoration-[var(--accent-primary)]/45 underline-offset-4 hover:text-[var(--text-primary)]"
            target="_blank"
            rel="noreferrer"
            href={href}
            onClick={handleClick}
            {...props}
          />
        );
      },
    }),
    [markdownLinkOpenMode, onOpenExternalLinkPreview],
  );

  if (!source) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 bg-[var(--bg-blackprint)] p-6 text-center text-[var(--text-muted)]"
        data-testid="markdown-preview-panel-content"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--shell-border)] bg-[var(--bg-tertiary)]">
          <FileText size={18} />
        </div>
        <div className="text-sm">Open a Markdown tab to preview it.</div>
      </div>
    );
  }

  return (
    <div
      className="h-full min-h-0 w-full overflow-auto bg-[var(--bg-blackprint)]"
      data-testid="markdown-preview-panel-content"
      data-source-path={source.path}
    >
      <div className="mx-auto max-w-[860px] px-6 py-5 text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {source.content}
        </ReactMarkdown>
      </div>
    </div>
  );
};
