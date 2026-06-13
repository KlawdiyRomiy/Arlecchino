import { useEffect, useRef } from "react";

import {
  type AppNotificationKind,
  useAppNotificationStore,
} from "../stores/appNotificationStore";
import {
  type DiagnosticsRuntimeStatus,
  useDiagnosticsStore,
} from "../stores/diagnosticsStore";
import { RestartLSPServer } from "../wails/app";
import {
  type BackgroundShellNotificationCandidate,
  type BackgroundShellSeverity,
  getBackgroundShellStatusSnapshot,
  runBackgroundShellAction,
  subscribeBackgroundShellStatus,
} from "./backgroundShellStatus";
import {
  buildLSPRestartFailurePresentation,
  buildNotificationErrorPresentation,
} from "./systemNotificationMessages";

const backgroundSeverityToNotificationKind: Record<
  BackgroundShellSeverity,
  AppNotificationKind
> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

const lspNotificationId = (status: DiagnosticsRuntimeStatus): string => {
  const projectKey = status.projectPath?.trim() || "active-project";
  const languageKey = status.language.trim() || "unknown";
  return `lsp-runtime-error:${projectKey}:${languageKey}`;
};

const lspNotificationSignature = (status: DiagnosticsRuntimeStatus): string =>
  [
    lspNotificationId(status),
    status.generation,
    status.filePath,
    status.message,
  ].join("\u0000");

const buildLSPDetails = (
  status: DiagnosticsRuntimeStatus,
): string | undefined => {
  const details = [
    status.projectPath ? `Project: ${status.projectPath}` : "",
    status.filePath ? `File: ${status.filePath}` : "",
    status.language ? `Language: ${status.language}` : "",
    status.message ? `Message: ${status.message}` : "",
  ].filter(Boolean);

  return details.length > 0 ? details.join("\n") : undefined;
};

const restartLSPServerFromNotification = (
  notificationId: string,
  language: string,
) => {
  const { updateNotification } = useAppNotificationStore.getState();
  updateNotification(notificationId, {
    kind: "progress",
    title: `${language} LSP restart`,
    message: "Restarting language server.",
    progress: 0.35,
    sticky: true,
    timeoutMs: 0,
    minimized: false,
  });

  void RestartLSPServer(language)
    .then((restarted) => {
      updateNotification(notificationId, {
        kind: restarted ? "success" : "warning",
        title: restarted
          ? `${language} LSP restarted`
          : "LSP restart unavailable",
        message: restarted
          ? "Restart request was sent to the language server."
          : "The active LSP manager did not accept the restart request.",
        progress: undefined,
        sticky: false,
        timeoutMs: restarted ? 3600 : 6200,
        minimized: false,
      });
    })
    .catch((error) => {
      const failure = buildLSPRestartFailurePresentation(error);
      updateNotification(notificationId, {
        kind: "error",
        title: `${language} LSP restart failed`,
        message: failure.message,
        details: failure.details,
        progress: undefined,
        sticky: true,
        timeoutMs: 0,
        minimized: false,
      });
    });
};

const publishLSPRuntimeNotification = (status: DiagnosticsRuntimeStatus) => {
  if (status.state !== "error" || !status.language.trim()) {
    return;
  }

  const notificationId = lspNotificationId(status);
  const language = status.language.trim();
  const message =
    status.message.trim() || `${language} language server reported an error.`;

  useAppNotificationStore.getState().addNotification({
    id: notificationId,
    kind: "error",
    title: `${language} LSP error`,
    message,
    details: buildLSPDetails(status),
    detailsLabel: "Runtime details",
    source: "LSP",
    tag: language,
    sticky: true,
    timeoutMs: 0,
    action: {
      label: "Restart",
      run: () => restartLSPServerFromNotification(notificationId, language),
    },
  });
};

const backgroundNotificationId = (
  candidate: BackgroundShellNotificationCandidate,
): string => `background-shell:${candidate.id}`;

const runBackgroundActionFromNotification = (
  notificationId: string,
  candidate: BackgroundShellNotificationCandidate,
) => {
  const action = candidate.action;
  if (!action?.enabled) {
    return;
  }

  const { updateNotification } = useAppNotificationStore.getState();
  updateNotification(notificationId, {
    kind: "progress",
    title: candidate.title,
    message: `${action.label} is running.`,
    progress: 0.3,
    sticky: true,
    timeoutMs: 0,
    minimized: false,
  });

  void runBackgroundShellAction(action.id)
    .then((result) => {
      updateNotification(notificationId, {
        kind: result.handled ? "success" : "warning",
        title: candidate.title,
        message:
          result.message ??
          (result.handled
            ? `${action.label} completed.`
            : `${action.label} could not be handled.`),
        progress: undefined,
        sticky: false,
        timeoutMs: result.handled ? 3600 : 6200,
        minimized: false,
      });
    })
    .catch((error) => {
      const failure = buildNotificationErrorPresentation(
        error,
        `${action.label} failed.`,
      );
      updateNotification(notificationId, {
        kind: "error",
        title: candidate.title,
        message: failure.message,
        details: failure.details,
        progress: undefined,
        sticky: true,
        timeoutMs: 0,
        minimized: false,
      });
    });
};

const publishBackgroundNotificationCandidate = (
  candidate: BackgroundShellNotificationCandidate,
) => {
  const notificationId = backgroundNotificationId(candidate);
  const kind = backgroundSeverityToNotificationKind[candidate.severity];

  useAppNotificationStore.getState().addNotification({
    id: notificationId,
    kind,
    title: candidate.title,
    message: candidate.body,
    source: "System",
    tag: candidate.jobId,
    sticky: kind === "error" || kind === "warning",
    timeoutMs: kind === "success" ? 3600 : kind === "info" ? 4200 : 0,
    action: candidate.action?.enabled
      ? {
          label: candidate.action.label,
          run: () =>
            runBackgroundActionFromNotification(notificationId, candidate),
        }
      : undefined,
  });
};

export const useSystemNotifications = (): void => {
  const lastLSPRuntimeSignatureRef = useRef("");
  const publishedBackgroundNotificationIdsRef = useRef(new Set<string>());

  useEffect(
    () =>
      useDiagnosticsStore.subscribe(
        (state) => state.runtimeStatus,
        (runtimeStatus) => {
          if (runtimeStatus.state !== "error") {
            return;
          }

          const signature = lspNotificationSignature(runtimeStatus);
          if (Object.is(signature, lastLSPRuntimeSignatureRef.current)) {
            return;
          }

          lastLSPRuntimeSignatureRef.current = signature;
          publishLSPRuntimeNotification(runtimeStatus);
        },
      ),
    [],
  );

  useEffect(() => {
    const publishBackgroundCandidates = () => {
      const snapshot = getBackgroundShellStatusSnapshot();
      snapshot.notificationCandidates.forEach((candidate) => {
        if (publishedBackgroundNotificationIdsRef.current.has(candidate.id)) {
          return;
        }

        publishedBackgroundNotificationIdsRef.current.add(candidate.id);
        publishBackgroundNotificationCandidate(candidate);
      });
    };

    publishBackgroundCandidates();
    return subscribeBackgroundShellStatus(publishBackgroundCandidates);
  }, []);
};
