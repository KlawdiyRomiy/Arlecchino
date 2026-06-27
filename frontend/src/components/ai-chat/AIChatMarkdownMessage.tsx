import React from "react";
import { CheckCircle2, Copy } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "../ui/ContextActionMenu";

interface AIChatMarkdownMessageProps {
  className?: string;
  content: string;
  searchQuery?: string;
  streaming?: boolean;
  typewriterActive?: boolean;
}

interface AIChatCodeBlockProps {
  code: string;
  language: string;
  meta: string;
}

type CodeNodeMetadata = {
  data?: {
    meta?: unknown;
  };
  position?: {
    start?: {
      line?: unknown;
    };
    end?: {
      line?: unknown;
    };
  };
  properties?: {
    file?: unknown;
    filename?: unknown;
    meta?: unknown;
    path?: unknown;
    title?: unknown;
  };
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchTerms(query: string): string[] {
  const seen = new Set<string>();
  return query
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => {
      const key = term.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const isSafeMarkdownImageSrc = (src: string | undefined): src is string => {
  const value = src?.trim();
  if (!value || value.startsWith("//")) {
    return false;
  }
  if (/^data:image\/(avif|gif|jpeg|jpg|png|webp);/i.test(value)) {
    return true;
  }
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "blob:";
  } catch {
    return !/^[a-z][a-z0-9+.-]*:/i.test(value);
  }
};

function highlightedText(value: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return value;
  const pattern = new RegExp(
    `(${terms
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|")})`,
    "gi",
  );
  return value.split(pattern).map((part, index) =>
    terms.some(
      (term) => term.toLocaleLowerCase() === part.toLocaleLowerCase(),
    ) ? (
      <mark className="ai-chat-search-hit" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    ),
  );
}

function highlightedChildren(
  children: React.ReactNode,
  terms: string[],
): React.ReactNode {
  if (terms.length === 0) return children;
  return React.Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return highlightedText(String(child), terms);
    }
    if (!React.isValidElement(child)) {
      return child;
    }
    const element = child as React.ReactElement<{
      children?: React.ReactNode;
      className?: string;
    }>;
    const className =
      typeof element.props.className === "string"
        ? element.props.className
        : "";
    if (
      className.includes("ai-chat-markdown__inline-code") ||
      className.includes("ai-chat-code-block") ||
      className.includes("ai-chat-search-hit")
    ) {
      return child;
    }
    if (element.props.children === undefined) {
      return child;
    }
    return React.cloneElement(element, {
      children: highlightedChildren(element.props.children, terms),
    });
  });
}

function closeUnfinishedFence(content: string, streaming: boolean): string {
  if (!streaming) return content;
  const partialFence = /(^|\n)( {0,3})(`{1,2}|~{1,2})$/.exec(content);
  if (partialFence) {
    const marker = partialFence[3];
    const fenceChar = marker.startsWith("~") ? "~" : "`";
    const completedFence = fenceChar.repeat(3);
    return `${content}${fenceChar.repeat(3 - marker.length)}\n${completedFence}`;
  }

  let openFence: { char: string; length: number } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1];
    const fence = { char: marker[0], length: marker.length };
    if (!openFence) {
      openFence = fence;
      continue;
    }
    if (openFence.char === fence.char && fence.length >= openFence.length) {
      openFence = null;
    }
  }
  if (!openFence) return content;
  return `${content}\n${openFence.char.repeat(openFence.length)}`;
}

function textFromChildren(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
        return textFromChildren(child.props.children);
      }
      return "";
    })
    .join("");
}

function languageFromClassName(className?: string): string {
  const match = /(?:^|\s)language-([^\s]+)/.exec(className ?? "");
  return match?.[1] ?? "";
}

function metadataString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function codeMetaFromNode(node: unknown): string {
  const metadata = node as CodeNodeMetadata | undefined;
  return (
    metadataString(metadata?.data?.meta) ||
    metadataString(metadata?.properties?.meta) ||
    metadataString(metadata?.properties?.title) ||
    metadataString(metadata?.properties?.filename) ||
    metadataString(metadata?.properties?.file) ||
    metadataString(metadata?.properties?.path)
  );
}

function numericLine(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function codeNodeSpansMultipleSourceLines(node: unknown): boolean {
  const metadata = node as CodeNodeMetadata | undefined;
  const startLine = numericLine(metadata?.position?.start?.line);
  const endLine = numericLine(metadata?.position?.end?.line);
  return startLine > 0 && endLine > startLine;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function fileNameFromMeta(meta: string): string {
  const keyed = /\b(?:title|file|filename|path)=("[^"]+"|'[^']+'|[^\s]+)/.exec(
    meta,
  );
  if (keyed?.[1]) {
    return unquote(keyed[1]);
  }
  const barePath = /(?:^|\s)([./~\w-][^\s:]*\.[A-Za-z0-9]{1,12})(?:\s|$)/.exec(
    meta,
  );
  return barePath?.[1] ? unquote(barePath[1]) : "";
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) return;
  await navigator.clipboard.writeText(value);
}

function inlineCodeKind(value: string): "reference" | "code" {
  const trimmed = value.trim();
  if (
    /(?:^|[/\\])[\w.-]+\.[A-Za-z0-9]{1,12}$/.test(trimmed) ||
    /^[\w.-]+:[\w.-]+$/.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    return "reference";
  }
  return "code";
}

function AIChatCodeBlock({ code, language, meta }: AIChatCodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const fileName = fileNameFromMeta(meta);
  const title = fileName || language || "Code";
  const languageLabel = language && language !== title ? language : "";

  const copyCode = React.useCallback(async () => {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1200);
  }, [code]);

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    await copyCode();
  };

  const contextItems = React.useMemo<ContextActionMenuItem[]>(
    () => [
      {
        key: "copy-code",
        label: "Copy Code",
        icon: <Copy size={13} />,
        onSelect: () => {
          void copyCode();
        },
      },
      {
        key: "copy-file-path",
        label: "Copy File Path",
        icon: <Copy size={13} />,
        hidden: !fileName,
        onSelect: () => {
          if (fileName) void copyText(fileName);
        },
      },
      {
        key: "copy-language",
        label: "Copy Language",
        icon: <Copy size={13} />,
        hidden: !language,
        onSelect: () => {
          if (language) void copyText(language);
        },
      },
    ],
    [copyCode, fileName, language],
  );

  return (
    <ContextActionMenu
      ignoredTargetSelector="button"
      items={contextItems}
      nativeScope="ai-chat-code-block"
      nativeTargetId={fileName || language || "code"}
    >
      <figure className="ai-chat-code-block" data-testid="ai-chat-code-block">
        <figcaption className="ai-chat-code-block__header">
          <span
            className="ai-chat-code-block__title"
            data-testid="ai-chat-code-block-title"
            title={title}
          >
            {title}
          </span>
          <span className="ai-chat-code-block__meta">
            {languageLabel ? (
              <span className="ai-chat-code-block__language">
                {languageLabel}
              </span>
            ) : null}
            <button
              className="ai-chat-code-block__copy"
              type="button"
              title={copied ? "Copied code" : "Copy code"}
              aria-label={copied ? "Copied code" : "Copy code"}
              data-testid="ai-chat-code-copy"
              onClick={handleCopy}
            >
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            </button>
          </span>
        </figcaption>
        <pre className="ai-chat-code-block__pre">
          <code className="ai-chat-code-block__code">{code}</code>
        </pre>
      </figure>
    </ContextActionMenu>
  );
}

export function AIChatMarkdownMessage({
  className = "",
  content,
  searchQuery = "",
  streaming = false,
  typewriterActive = false,
}: AIChatMarkdownMessageProps) {
  const terms = React.useMemo(() => searchTerms(searchQuery), [searchQuery]);
  const preparedContent = React.useMemo(
    () => closeUnfinishedFence(content, streaming),
    [content, streaming],
  );
  const renderChildren = React.useCallback(
    (children: React.ReactNode) => highlightedChildren(children, terms),
    [terms],
  );
  const components = React.useMemo<Components>(
    () => ({
      a: ({ children, href, onClick, ...props }) => {
        const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
          event.stopPropagation();
          onClick?.(event);
        };
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={handleClick}
            {...props}
          >
            {renderChildren(children)}
          </a>
        );
      },
      blockquote: ({ children, ...props }) => (
        <blockquote {...props}>{renderChildren(children)}</blockquote>
      ),
      code: ({ children, className, node, ...props }) => {
        const language = languageFromClassName(className);
        const meta = codeMetaFromNode(node);
        const text = textFromChildren(children).replace(/\n$/, "");
        const block = Boolean(
          language ||
          meta ||
          text.includes("\n") ||
          codeNodeSpansMultipleSourceLines(node),
        );
        if (block) {
          return (
            <AIChatCodeBlock code={text} language={language} meta={meta} />
          );
        }
        const inlineKind = inlineCodeKind(text);
        const inlineContextItems: ContextActionMenuItem[] = [
          {
            key: "copy-inline-code",
            label:
              inlineKind === "reference"
                ? "Copy Reference"
                : "Copy Inline Code",
            icon: <Copy size={13} />,
            onSelect: () => {
              void copyText(text);
            },
          },
        ];
        return (
          <ContextActionMenu
            items={inlineContextItems}
            nativeScope="ai-chat-inline-code"
            nativeTargetId={text.slice(0, 80)}
          >
            <code
              className="ai-chat-markdown__inline-code"
              data-kind={inlineKind}
              {...props}
            >
              {children}
            </code>
          </ContextActionMenu>
        );
      },
      em: ({ children, ...props }) => (
        <em {...props}>{renderChildren(children)}</em>
      ),
      h1: ({ children, ...props }) => (
        <h3 {...props}>{renderChildren(children)}</h3>
      ),
      h2: ({ children, ...props }) => (
        <h3 {...props}>{renderChildren(children)}</h3>
      ),
      h3: ({ children, ...props }) => (
        <h3 {...props}>{renderChildren(children)}</h3>
      ),
      li: ({ children, ...props }) => (
        <li {...props}>{renderChildren(children)}</li>
      ),
      img: ({ alt = "", src, ...props }) =>
        isSafeMarkdownImageSrc(src) ? (
          <img alt={alt} src={src} {...props} />
        ) : null,
      ol: ({ children, ...props }) => (
        <ol {...props}>{renderChildren(children)}</ol>
      ),
      p: ({ children, ...props }) => (
        <p {...props}>{renderChildren(children)}</p>
      ),
      pre: ({ children }) => <>{children}</>,
      strong: ({ children, ...props }) => (
        <strong {...props}>{renderChildren(children)}</strong>
      ),
      table: ({ children, ...props }) => (
        <div className="ai-chat-markdown__table-wrap">
          <table {...props}>{children}</table>
        </div>
      ),
      td: ({ children, ...props }) => (
        <td {...props}>{renderChildren(children)}</td>
      ),
      th: ({ children, ...props }) => (
        <th {...props}>{renderChildren(children)}</th>
      ),
      ul: ({ children, ...props }) => (
        <ul {...props}>{renderChildren(children)}</ul>
      ),
    }),
    [renderChildren],
  );
  const rootClassName = ["ai-chat-markdown", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClassName}
      data-streaming={streaming ? "true" : "false"}
      data-testid="ai-chat-markdown"
      data-typewriter-active={typewriterActive ? "true" : "false"}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {preparedContent}
      </ReactMarkdown>
    </div>
  );
}
