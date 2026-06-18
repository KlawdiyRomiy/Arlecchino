import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  Square,
} from "lucide-react";
import { AICancelChatRun, AIWriteAgentTerminalInput } from "../../wails/app";
import { EventsOn } from "../../wails/runtime";
import type { AIChatRunEnvelope } from "../../../bindings/arlecchino/internal/ai/models";

interface AgentConsoleProps {
  activeEnvelope: AIChatRunEnvelope | null;
  visible: boolean;
}

interface AgentTerminalDataEvent {
  runId?: string;
  data?: string;
  createdAt?: string;
}

interface AgentStatusEvent {
  runId?: string;
  status?: string;
  text?: string;
  createdAt?: string;
}

interface AgentRunViewState {
  buffer: string;
  statuses: AgentStatusEvent[];
  acknowledged: Record<string, boolean>;
  busyAction: string;
}

interface AgentRuntimeAnalysis {
  trustPrompt: boolean;
  projectPath: string;
  updatePrompt: boolean;
  authPrompt: boolean;
  authUrl: string;
  authCode: string;
  approvalPrompt: boolean;
  notices: string[];
}

const interactiveFallbackRuntimeFamily = "interactive_fallback_runtime";
const ptyFallbackTransport = "pty_fallback";
const terminalBufferLimit = 32 * 1024;
const statusLimit = 24;

const ansiPattern = new RegExp(
  String.raw`\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))`,
  "g",
);
const terminalControlPattern = new RegExp(
  String.raw`[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
  "g",
);
const nonPrintablePattern = new RegExp(
  String.raw`[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd]`,
  "g",
);

function isInteractiveFallbackEnvelope(
  envelope: AIChatRunEnvelope | null,
): boolean {
  if (!envelope) return false;
  return (
    envelope.runtimeFamily === interactiveFallbackRuntimeFamily ||
    envelope.providerEnvelope?.runtimeFamily ===
      interactiveFallbackRuntimeFamily ||
    envelope.agentRuntime?.runtimeFamily === interactiveFallbackRuntimeFamily ||
    envelope.agentRuntime?.transport === ptyFallbackTransport ||
    Boolean(envelope.agentRuntime?.authFlow)
  );
}

function isRunning(envelope: AIChatRunEnvelope | null): boolean {
  return envelope?.status === "running" || envelope?.status === "queued";
}

function appendLimitedBuffer(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  if (next.length <= terminalBufferLimit) return next;
  return next.slice(next.length - terminalBufferLimit);
}

function normalizeTerminalText(value: string): string {
  return value
    .replace(ansiPattern, "")
    .replace(terminalControlPattern, "")
    .replace(nonPrintablePattern, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }
  return result;
}

function extractLineMatch(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? "";
}

function extractAuthUrl(text: string): string {
  const match =
    /(https:\/\/(?:chatgpt\.com|auth\.openai\.com|platform\.openai\.com)[^\s"'<>]+)/i.exec(
      text,
    );
  return match?.[1]?.replace(/[),.;]+$/, "") ?? "";
}

function extractAuthCode(text: string): string {
  return extractLineMatch(
    text,
    /(?:code|verification code|device code)\s*[:：]\s*([A-Z0-9-]{4,})/i,
  );
}

function compactServiceList(value: string): string {
  const services = value
    .split(/[,;\s]+/)
    .map((item) => item.trim().replace(/[^\w-]/g, ""))
    .filter(Boolean);
  const unique = [...new Set(services)];
  if (unique.length === 0) return "";
  if (unique.length <= 6) return unique.join(", ");
  return `${unique.slice(0, 6).join(", ")} and ${unique.length - 6} more`;
}

function mcpNoticeSummaryFromText(text: string): string[] {
  const notices: string[] = [];
  const loginServices = [
    ...text.matchAll(/The\s+([\w-]+)\s+MCP server is not logged in/gi),
  ]
    .map((match) => match[1])
    .filter(Boolean);
  const loginSummary = compactServiceList(loginServices.join(","));
  if (loginSummary) {
    notices.push(`MCP accounts need login: ${loginSummary}.`);
  }
  const failed = extractLineMatch(
    text,
    /MCP startup incomplete\s+\(failed:\s*([^)]+)\)/i,
  );
  const failedSummary = compactServiceList(failed);
  if (failedSummary) {
    notices.push(`MCP startup incomplete: ${failedSummary}.`);
  }
  return notices;
}

function mcpNoticesFromText(text: string): string[] {
  return uniqueLines(mcpNoticeSummaryFromText(text)).slice(-3);
}

function analyzeAgentRuntime(
  state: AgentRunViewState | undefined,
  envelope: AIChatRunEnvelope,
): AgentRuntimeAnalysis {
  const text = normalizeTerminalText(state?.buffer ?? "");
  const statuses = state?.statuses ?? [];
  const statusKeys = new Set(statuses.map((status) => status.status ?? ""));
  const statusNotices = statuses
    .filter((status) => status.status === "mcp_notice")
    .map((status) => status.text ?? "");
  const trustPrompt =
    statusKeys.has("trust_project_prompt") ||
    /Do you trust the contents of this directory\?/i.test(text);
  const projectPath = extractLineMatch(text, /^\s*>?\s*You are in\s+(.+)$/m);
  const updatePrompt =
    statusKeys.has("update_prompt") ||
    /Codex just got an upgrade|Update now \(runs/i.test(text);
  const authPrompt =
    Boolean(envelope.agentRuntime?.authFlow) ||
    statusKeys.has("auth_required") ||
    /Please reauthenticate|Your session has expired/i.test(text);
  const approvalPrompt =
    statusKeys.has("approval_prompt") ||
    /needs your approval|Approval requested|requires approval by policy/i.test(
      text,
    );
  return {
    trustPrompt,
    projectPath,
    updatePrompt,
    authPrompt,
    authUrl: extractAuthUrl(text),
    authCode: extractAuthCode(text),
    approvalPrompt,
    notices: uniqueLines([...mcpNoticesFromText(text), ...statusNotices]).slice(
      -4,
    ),
  };
}

export function AgentConsole({ activeEnvelope, visible }: AgentConsoleProps) {
  const [runs, setRuns] = useState<Record<string, AgentRunViewState>>({});
  const activeRunId = activeEnvelope?.id ?? "";
  const activeRunState = activeRunId ? runs[activeRunId] : undefined;
  const fallbackRuntime = isInteractiveFallbackEnvelope(activeEnvelope);
  const running = isRunning(activeEnvelope);

  useEffect(() => {
    const offTerminal = EventsOn(
      "ai:agent:terminal-data",
      (payload: AgentTerminalDataEvent) => {
        const runId = payload?.runId?.trim();
        const data = payload?.data ?? "";
        if (!runId || !data) return;
        setRuns((current) => {
          const previous = current[runId] ?? {
            buffer: "",
            statuses: [],
            acknowledged: {},
            busyAction: "",
          };
          return {
            ...current,
            [runId]: {
              ...previous,
              buffer: appendLimitedBuffer(previous.buffer, data),
            },
          };
        });
      },
    );
    const offStatus = EventsOn(
      "ai:agent:status",
      (payload: AgentStatusEvent) => {
        const runId = payload?.runId?.trim();
        if (!runId) return;
        setRuns((current) => {
          const previous = current[runId] ?? {
            buffer: "",
            statuses: [],
            acknowledged: {},
            busyAction: "",
          };
          return {
            ...current,
            [runId]: {
              ...previous,
              statuses: [...previous.statuses, payload].slice(-statusLimit),
            },
          };
        });
      },
    );
    return () => {
      offTerminal?.();
      offStatus?.();
    };
  }, []);

  const analysis = useMemo(() => {
    if (!activeEnvelope || !fallbackRuntime) return null;
    return analyzeAgentRuntime(activeRunState, activeEnvelope);
  }, [activeEnvelope, activeRunState, fallbackRuntime]);

  const markAcknowledged = useCallback((runId: string, key: string) => {
    setRuns((current) => {
      const previous = current[runId];
      if (!previous) return current;
      return {
        ...current,
        [runId]: {
          ...previous,
          acknowledged: { ...previous.acknowledged, [key]: true },
        },
      };
    });
  }, []);

  const setBusyAction = useCallback((runId: string, key: string) => {
    setRuns((current) => {
      const previous = current[runId];
      if (!previous) return current;
      return {
        ...current,
        [runId]: { ...previous, busyAction: key },
      };
    });
  }, []);

  const clearBusyAction = useCallback((runId: string, key: string) => {
    setRuns((current) => {
      const previous = current[runId];
      if (!previous || previous.busyAction !== key) return current;
      return {
        ...current,
        [runId]: { ...previous, busyAction: "" },
      };
    });
  }, []);

  const sendInput = useCallback(
    async (input: string, key: string) => {
      if (!activeRunId) return;
      setBusyAction(activeRunId, key);
      try {
        await AIWriteAgentTerminalInput(activeRunId, input);
        markAcknowledged(activeRunId, key);
      } finally {
        clearBusyAction(activeRunId, key);
      }
    },
    [activeRunId, clearBusyAction, markAcknowledged, setBusyAction],
  );

  const stopRun = useCallback(async () => {
    if (!activeRunId) return;
    setBusyAction(activeRunId, "stop");
    try {
      await AICancelChatRun(activeRunId);
    } finally {
      clearBusyAction(activeRunId, "stop");
    }
  }, [activeRunId, clearBusyAction, setBusyAction]);

  if (
    !visible ||
    !activeEnvelope ||
    !fallbackRuntime ||
    !analysis ||
    (!running && activeEnvelope.status !== "error")
  ) {
    return null;
  }

  const acknowledged = activeRunState?.acknowledged ?? {};
  const busyAction = activeRunState?.busyAction ?? "";
  const showTrust = analysis.trustPrompt && !acknowledged.trust;
  const showUpdate = analysis.updatePrompt && !acknowledged.update;
  const showAuth = analysis.authPrompt && running && !showTrust && !showUpdate;
  const showApproval =
    analysis.approvalPrompt && running && !showTrust && !showUpdate;
  const showNotices =
    analysis.notices.length > 0 &&
    !showTrust &&
    !showUpdate &&
    !showAuth &&
    !showApproval;

  if (!showTrust && !showUpdate && !showAuth && !showApproval && !showNotices) {
    return null;
  }

  return (
    <section className="ai-chat-agent-surface" aria-label="Agent CLI runtime">
      {showTrust ? (
        <div className="ai-chat-agent-card" data-tone="warning">
          <div className="ai-chat-agent-card__icon">
            <ShieldCheck size={18} />
          </div>
          <div className="ai-chat-agent-card__body">
            <div className="ai-chat-agent-card__title">
              Trust project directory
            </div>
            <p>
              Codex is asking before it loads project-local config, hooks, and
              exec policies
              {analysis.projectPath ? ` for ${analysis.projectPath}` : ""}.
            </p>
            <div className="ai-chat-agent-card__actions">
              <button
                type="button"
                className="ai-chat-agent-card__button"
                onClick={() => void sendInput("\r", "trust")}
                disabled={busyAction !== ""}
              >
                {busyAction === "trust" ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                Trust and continue
              </button>
              <button
                type="button"
                className="ai-chat-agent-card__button ai-chat-agent-card__button--ghost"
                onClick={() => void stopRun()}
                disabled={busyAction !== ""}
              >
                <Square size={14} />
                Stop
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showUpdate ? (
        <div className="ai-chat-agent-card" data-tone="notice">
          <div className="ai-chat-agent-card__icon">
            <AlertTriangle size={18} />
          </div>
          <div className="ai-chat-agent-card__body">
            <div className="ai-chat-agent-card__title">Codex update prompt</div>
            <p>
              The provider CLI surfaced an update prompt. Arlecchino will not
              run an updater automatically during an agent request.
            </p>
            <div className="ai-chat-agent-card__actions">
              <button
                type="button"
                className="ai-chat-agent-card__button"
                onClick={() => void sendInput("\x1b", "update")}
                disabled={busyAction !== ""}
              >
                {busyAction === "update" ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                Continue current run
              </button>
              <button
                type="button"
                className="ai-chat-agent-card__button ai-chat-agent-card__button--ghost"
                onClick={() => void stopRun()}
                disabled={busyAction !== ""}
              >
                <Square size={14} />
                Stop
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showAuth ? (
        <div className="ai-chat-agent-card" data-tone="default">
          <div className="ai-chat-agent-card__icon">
            <KeyRound size={18} />
          </div>
          <div className="ai-chat-agent-card__body">
            <div className="ai-chat-agent-card__title">
              Codex account sign-in
            </div>
            <p>
              Use the official Codex CLI account flow. Arlecchino only relays
              the local process and does not store provider credentials.
            </p>
            {analysis.authUrl || analysis.authCode ? (
              <div className="ai-chat-agent-card__auth">
                {analysis.authUrl ? (
                  <a href={analysis.authUrl} target="_blank" rel="noreferrer">
                    Open official login
                    <ExternalLink size={13} />
                  </a>
                ) : null}
                {analysis.authCode ? <code>{analysis.authCode}</code> : null}
              </div>
            ) : null}
            <div className="ai-chat-agent-card__actions">
              <button
                type="button"
                className="ai-chat-agent-card__button ai-chat-agent-card__button--ghost"
                onClick={() => void stopRun()}
                disabled={busyAction !== ""}
              >
                <Square size={14} />
                Stop
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showApproval ? (
        <div className="ai-chat-agent-card" data-tone="warning">
          <div className="ai-chat-agent-card__icon">
            <AlertTriangle size={18} />
          </div>
          <div className="ai-chat-agent-card__body">
            <div className="ai-chat-agent-card__title">
              CLI approval requested
            </div>
            <p>
              Codex asked for a provider-side approval that is not structured
              enough for Arlecchino to safely approve from the GUI yet.
            </p>
            <div className="ai-chat-agent-card__actions">
              <button
                type="button"
                className="ai-chat-agent-card__button ai-chat-agent-card__button--ghost"
                onClick={() => void stopRun()}
                disabled={busyAction !== ""}
              >
                <Square size={14} />
                Stop
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showNotices ? (
        <div className="ai-chat-agent-card" data-tone="muted">
          <div className="ai-chat-agent-card__icon">
            <AlertTriangle size={18} />
          </div>
          <div className="ai-chat-agent-card__body">
            <div className="ai-chat-agent-card__title">Runtime notices</div>
            <ul className="ai-chat-agent-card__notices">
              {analysis.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
