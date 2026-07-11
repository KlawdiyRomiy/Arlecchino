import { useEffect, useRef, useState } from "react";

// ReactMarkdown reparses the visible prefix. Keep that work well below the
// transport's 25 Hz batching cadence while retaining a responsive reveal.
const TYPEWRITER_FRAME_INTERVAL_MS = 48;
const INITIAL_VISIBLE_GRAPHEMES = 2;
const MAX_TERMINAL_GRAPHEMES_PER_FRAME = 64;
const MAX_TERMINAL_CODE_POINTS_PER_FRAME = 64;

type TypewriterFrameListener = () => void;

const frameListeners = new Set<TypewriterFrameListener>();
let scheduledFrame: number | null = null;
let scheduledTimer: number | null = null;

function requestSharedFrame(): void {
  if (
    scheduledFrame !== null ||
    scheduledTimer !== null ||
    frameListeners.size === 0
  ) {
    return;
  }
  scheduledTimer = window.setTimeout(() => {
    scheduledTimer = null;
    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = null;
      [...frameListeners].forEach((listener) => listener());
      requestSharedFrame();
    });
  }, TYPEWRITER_FRAME_INTERVAL_MS);
}

function subscribeTypewriterFrame(
  listener: TypewriterFrameListener,
): () => void {
  frameListeners.add(listener);
  requestSharedFrame();
  return () => {
    frameListeners.delete(listener);
    if (frameListeners.size === 0 && scheduledFrame !== null) {
      window.cancelAnimationFrame(scheduledFrame);
      scheduledFrame = null;
    }
    if (frameListeners.size === 0 && scheduledTimer !== null) {
      window.clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
  };
}

type GraphemeSegment = { segment: string };
type GraphemeSegmenter = {
  segment: (value: string) => Iterable<GraphemeSegment>;
};

const graphemeSegmenter: GraphemeSegmenter | null = (() => {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => GraphemeSegmenter;
    }
  ).Segmenter;
  return Segmenter
    ? new Segmenter(undefined, { granularity: "grapheme" })
    : null;
})();

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function nextCodePointEnd(value: string, start: number): number {
  const codePoint = value.codePointAt(start);
  return start + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

function fallbackGraphemeEnd(value: string, start: number): number {
  let end = nextCodePointEnd(value, start);
  const firstCodePoint = value.codePointAt(start) ?? 0;
  if (
    firstCodePoint >= 0x1f1e6 &&
    firstCodePoint <= 0x1f1ff &&
    end < value.length
  ) {
    const nextCodePoint = value.codePointAt(end) ?? 0;
    if (nextCodePoint >= 0x1f1e6 && nextCodePoint <= 0x1f1ff) {
      end = nextCodePointEnd(value, end);
    }
  }
  while (end < value.length) {
    const codePoint = value.codePointAt(end) ?? 0;
    const character = String.fromCodePoint(codePoint);
    if (
      /\p{M}/u.test(character) ||
      codePoint === 0xfe0e ||
      codePoint === 0xfe0f ||
      (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
    ) {
      end = nextCodePointEnd(value, end);
      continue;
    }
    if (codePoint === 0x200d) {
      end = nextCodePointEnd(value, end);
      if (end < value.length) end = nextCodePointEnd(value, end);
      continue;
    }
    break;
  }
  return end;
}

function advanceGraphemes(
  value: string,
  start: number,
  count: number,
  maxCodePoints = Number.POSITIVE_INFINITY,
): number {
  let end = Math.max(0, Math.min(start, value.length));
  let consumedCodePoints = 0;
  if (graphemeSegmenter) {
    for (const item of graphemeSegmenter.segment(value.slice(end))) {
      if (count <= 0) break;
      const segmentCodePoints = codePointLength(item.segment);
      if (
        consumedCodePoints > 0 &&
        consumedCodePoints + segmentCodePoints > maxCodePoints
      ) {
        break;
      }
      end += item.segment.length;
      consumedCodePoints += segmentCodePoints;
      count -= 1;
    }
    return end;
  }
  for (let index = 0; index < count && end < value.length; index += 1) {
    const nextEnd = fallbackGraphemeEnd(value, end);
    const segmentCodePoints = codePointLength(value.slice(end, nextEnd));
    if (
      consumedCodePoints > 0 &&
      consumedCodePoints + segmentCodePoints > maxCodePoints
    ) {
      break;
    }
    end = nextEnd;
    consumedCodePoints += segmentCodePoints;
  }
  return end;
}

function initialMarkdownPrefixEnd(targetText: string): number {
  const structuralPrefix =
    /^(?:\s{0,3})(?:#{1,6}\s+|[-*+]\s+|>\s+|\d+[.)]\s+|`{3}[^\n]*\n|~{3}[^\n]*\n)/.exec(
      targetText,
    )?.[0];
  if (structuralPrefix) {
    return advanceGraphemes(
      targetText,
      structuralPrefix.length,
      INITIAL_VISIBLE_GRAPHEMES,
    );
  }

  const inlinePrefix = /^(?:\s{0,3})(?:\*\*|__|\*(?!\s)|_(?!\s)|\[)/.exec(
    targetText,
  )?.[0];
  if (inlinePrefix && inlinePrefix.length >= targetText.length) return 0;
  const start = inlinePrefix?.length ?? 0;
  return advanceGraphemes(targetText, start, INITIAL_VISIBLE_GRAPHEMES);
}

export function initialAssistantTypewriterText(targetText: string): string {
  if (!targetText) return "";
  return targetText.slice(0, initialMarkdownPrefixEnd(targetText));
}

function streamingStepSize(remaining: number): number {
  if (remaining > 4_000) return 64;
  if (remaining > 1_600) return 40;
  if (remaining > 640) return 24;
  if (remaining > 240) return 12;
  if (remaining > 80) return 6;
  return 2;
}

export function advanceAssistantTypewriterText(
  displayedText: string,
  targetText: string,
  terminal: boolean,
): string {
  if (!targetText) return "";
  if (!displayedText) {
    const initial = initialAssistantTypewriterText(targetText);
    if (!initial) return terminal ? targetText : "";
    return initial;
  }
  if (!targetText.startsWith(displayedText)) {
    return initialAssistantTypewriterText(targetText);
  }
  if (displayedText.length >= targetText.length) return targetText;
  const remaining = targetText.length - displayedText.length;
  const step = terminal
    ? Math.min(
        MAX_TERMINAL_GRAPHEMES_PER_FRAME,
        Math.max(8, Math.ceil(remaining / 8)),
      )
    : streamingStepSize(remaining);
  const nextEnd = advanceGraphemes(
    targetText,
    displayedText.length,
    step,
    terminal ? MAX_TERMINAL_CODE_POINTS_PER_FRAME : undefined,
  );
  return targetText.slice(0, nextEnd);
}

export interface AssistantTypewriterPresentation {
  text: string;
  active: boolean;
}

export function useAssistantTypewriterText({
  reduceMotion,
  runId,
  running,
  targetText,
}: {
  reduceMotion: boolean;
  runId: string;
  running: boolean;
  targetText: string;
}): AssistantTypewriterPresentation {
  const runIdRef = useRef(runId);
  const liveSeenRef = useRef(running);
  if (runIdRef.current !== runId) {
    runIdRef.current = runId;
    liveSeenRef.current = running;
  } else if (running) {
    liveSeenRef.current = true;
  }

  const [displayed, setDisplayed] = useState(() => ({
    runId,
    text:
      running && !reduceMotion
        ? initialAssistantTypewriterText(targetText)
        : targetText,
  }));
  const targetTextRef = useRef(targetText);
  const runningRef = useRef(running);
  targetTextRef.current = targetText;
  runningRef.current = running;
  const animationEligible = liveSeenRef.current && !reduceMotion;
  const storedText = displayed.runId === runId ? displayed.text : "";
  const reconciledText = animationEligible
    ? targetText.startsWith(storedText) && storedText
      ? storedText
      : initialAssistantTypewriterText(targetText)
    : targetText;

  useEffect(() => {
    if (animationEligible) return;
    setDisplayed((current) =>
      current.runId === runId && current.text === targetText
        ? current
        : { runId, text: targetText },
    );
  }, [animationEligible, runId, targetText]);

  useEffect(() => {
    if (
      !animationEligible ||
      reconciledText !== targetText ||
      (displayed.runId === runId && displayed.text === reconciledText)
    ) {
      return;
    }
    setDisplayed({ runId, text: reconciledText });
  }, [
    animationEligible,
    displayed.runId,
    displayed.text,
    reconciledText,
    runId,
    targetText,
  ]);

  const revealable =
    !running ||
    Boolean(reconciledText || initialAssistantTypewriterText(targetText));
  const frameNeeded =
    animationEligible && reconciledText !== targetText && revealable;

  useEffect(() => {
    if (!frameNeeded) return undefined;
    return subscribeTypewriterFrame(() => {
      setDisplayed((current) => {
        const latestTarget = targetTextRef.current;
        const base =
          current.runId === runId && latestTarget.startsWith(current.text)
            ? current.text
            : initialAssistantTypewriterText(latestTarget);
        const next = advanceAssistantTypewriterText(
          base,
          latestTarget,
          !runningRef.current,
        );
        return current.runId === runId && current.text === next
          ? current
          : { runId, text: next };
      });
    });
  }, [frameNeeded, runId]);

  return {
    text: reconciledText,
    active: animationEligible && (running || reconciledText !== targetText),
  };
}
