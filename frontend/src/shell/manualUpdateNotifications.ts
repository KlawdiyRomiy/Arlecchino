import { useEffect, useRef } from "react";

import { useAppNotificationStore } from "../stores/appNotificationStore";
import { openExternalUrlWithCapability } from "./browser";
import {
  applyStagedAutoUpdate,
  checkForAutoUpdate,
  downloadAutoUpdate,
  getAutoUpdateStatusSnapshot,
  type AutoUpdateState,
  type AutoUpdateStatus,
  useAutoUpdateStatus,
} from "./autoUpdate";

export const ARLECCHINO_GITHUB_RELEASES_URL =
  "https://github.com/KlawdiyRomiy/Arlecchino/releases";

type UpdateNotificationAction =
  "download" | "retry-download" | "apply" | "manual" | null;

interface ManualUpdateNotificationSummary {
  key: string;
  title: string;
  message: string;
  details?: string;
  detailsLabel?: string;
  tag?: string;
  kind: "info" | "success" | "warning" | "error" | "progress";
  sticky: boolean;
  timeoutMs: number;
  progress?: number;
  action: UpdateNotificationAction;
}

interface ManualUpdateNotificationOptions {
  includePassive?: boolean;
  policy?: "manual" | "background";
}

interface PublishAutoUpdateNotificationOptions extends ManualUpdateNotificationOptions {
  force?: boolean;
}

const actionableStates: readonly AutoUpdateState[] = [
  "available",
  "downloading",
  "staged",
  "applying",
  "manual-required",
  "failed",
];

const backgroundVisibleStates: readonly AutoUpdateState[] = [
  "available",
  "staged",
];

const curatedSummaryLimit = 4;
const rawCommitLinePattern = /^\s*(?:[-*]\s*)?[0-9a-f]{7,40}\s+[A-Z][^\n]*$/i;

const versionLabel = (status: AutoUpdateStatus): string =>
  buildVersionLabel(
    status.targetVersion ??
      status.manifest?.version ??
      status.verification.version,
    status.targetBuild ?? status.manifest?.build,
  );

const buildVersionLabel = (version?: string, build?: string): string => {
  const normalizedVersion = version?.trim() || "unknown";
  const normalizedBuild = build?.trim();
  return normalizedBuild
    ? `${normalizedVersion} build ${normalizedBuild}`
    : normalizedVersion;
};

const channelLabel = (status: AutoUpdateStatus): string =>
  status.channel ??
  status.manifest?.channel ??
  status.current.channel ??
  "beta";

const isVerboseDiagnosticReason = (reason: string): boolean =>
  reason.length > 220 ||
  reason.includes("\n") ||
  /\/(?:Users|var|tmp|private)\//.test(reason) ||
  /codesign|sealed resource|file added:|__CodeSignature|AppleDouble/i.test(
    reason,
  );

const isAutoUpdateTimeoutReason = (reason: string): boolean =>
  /download timed out|context deadline exceeded|client\.timeout|timeout .*reading body/i.test(
    reason,
  );

const userFacingReason = (status: AutoUpdateStatus): string | undefined => {
  if (!status.reason) {
    return undefined;
  }
  if (status.state === "failed" && isAutoUpdateTimeoutReason(status.reason)) {
    return "The update download timed out before the package finished reading. Retry the download when the connection is stable.";
  }
  if (status.state === "failed" && isVerboseDiagnosticReason(status.reason)) {
    return "The update could not be completed. Open Settings diagnostics for technical details.";
  }
  return status.reason;
};

export const isRawCommitDigestReleaseNotes = (notes?: string): boolean => {
  const lines = (notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  const rawCommitLines = lines.filter((line) =>
    rawCommitLinePattern.test(line),
  ).length;
  const hasDigestHeader = lines.some((line) =>
    /^includes changes since\b/i.test(line),
  );

  return (
    hasDigestHeader ||
    rawCommitLines >= 4 ||
    (rawCommitLines >= 2 && rawCommitLines / lines.length >= 0.45)
  );
};

const stripMarkdownListMarker = (line: string): string =>
  line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();

const isReleaseNotesHeading = (line: string): boolean =>
  /^#{1,6}\s+\S/.test(line) ||
  /^(added|changed|fixed|improved|removed|security|updated|highlights):?$/i.test(
    line.trim(),
  );

const releaseNoteSummaryItems = (notes: string): string[] => {
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletItems = lines
    .filter((line) => /^\s*(?:[-*+]|\d+\.)\s+/.test(line))
    .map(stripMarkdownListMarker)
    .filter(Boolean);

  if (bulletItems.length > 0) {
    return bulletItems.slice(0, curatedSummaryLimit);
  }

  return lines
    .filter((line) => !isReleaseNotesHeading(line))
    .slice(0, 2)
    .map(stripMarkdownListMarker)
    .filter(Boolean);
};

export const buildReleaseNotesPresentation = (
  notes?: string,
): { summary: string[]; details?: string; rejectedRaw: boolean } => {
  const trimmed = (notes ?? "").trim();
  if (!trimmed) {
    return { summary: [], rejectedRaw: false };
  }
  if (isRawCommitDigestReleaseNotes(trimmed)) {
    return { summary: [], rejectedRaw: true };
  }

  return {
    summary: releaseNoteSummaryItems(trimmed),
    details: trimmed,
    rejectedRaw: false,
  };
};

const releaseNotesFallback =
  "View release notes on GitHub for the full curated changelog.";

const releaseNotesForStatus = (status: AutoUpdateStatus) =>
  buildReleaseNotesPresentation(
    status.releaseNotes ?? status.manifest?.releaseNotes,
  );

export const buildManualUpdateNotification = (
  status: AutoUpdateStatus,
  options: ManualUpdateNotificationOptions = {},
): ManualUpdateNotificationSummary | null => {
  const includePassive = options.includePassive === true;
  const isBackground = options.policy === "background";

  if (isBackground && !backgroundVisibleStates.includes(status.state)) {
    return null;
  }

  if (includePassive && status.state === "checking") {
    const channel = channelLabel(status);
    return {
      key: `manual:${status.state}:${status.updatedAt}`,
      title: "Checking for Updates",
      message: status.reason ?? "Checking the configured update manifest.",
      tag: channel,
      kind: "progress",
      sticky: true,
      timeoutMs: 0,
      progress: status.progress,
      action: null,
    };
  }

  if (includePassive && status.state === "not-available") {
    const channel = channelLabel(status);
    const version =
      status.current.version && status.current.version !== "0.0.0-dev"
        ? status.current.version
        : versionLabel(status);
    return {
      key: `manual:${status.state}:${channel}:${version}:${status.reason ?? ""}`,
      title: "Arlecchino is up to date",
      message:
        status.reason ??
        `Current version ${version} is up to date for channel ${channel}.`,
      tag: channel,
      kind: "success",
      sticky: false,
      timeoutMs: 4200,
      action: null,
    };
  }

  if (!actionableStates.includes(status.state)) {
    return null;
  }

  const version = versionLabel(status);
  const channel = channelLabel(status);
  const messageParts = [`Version ${version}`];
  const reason = userFacingReason(status);
  if (reason) {
    messageParts.push(reason);
  }
  const notes = releaseNotesForStatus(status);

  switch (status.state) {
    case "available":
      if (notes.summary.length > 0) {
        messageParts.push(...notes.summary.map((item) => `• ${item}`));
      } else {
        messageParts.push(releaseNotesFallback);
      }
      return {
        key: `${status.state}:${channel}:${version}`,
        title: status.mandatory
          ? "Required update available"
          : "Update available",
        message: messageParts.join("\n"),
        details: notes.details,
        detailsLabel: notes.details ? "Details" : undefined,
        tag: channel,
        kind: status.mandatory ? "warning" : "info",
        sticky: status.mandatory,
        timeoutMs: status.mandatory ? 0 : 14000,
        action: "download",
      };
    case "downloading":
      return {
        key: `${status.state}:${channel}:${version}:${status.progress}`,
        title: "Downloading update",
        message: `Version ${version}\nDownloading and verifying the update package.`,
        tag: channel,
        kind: "progress",
        sticky: true,
        timeoutMs: 0,
        progress: status.progress,
        action: null,
      };
    case "staged":
      return {
        key: `${status.state}:${channel}:${version}`,
        title: "Update ready",
        message: `Version ${version}\nUpdate is verified and ready to install after confirmation.`,
        details: notes.details,
        detailsLabel: notes.details ? "Details" : undefined,
        tag: channel,
        kind: "success",
        sticky: true,
        timeoutMs: 0,
        progress: 1,
        action: "apply",
      };
    case "applying":
      return {
        key: `${status.state}:${channel}:${version}`,
        title: "Installing update",
        message: `Version ${version}\nArlecchino will quit, replace the app bundle, and relaunch.`,
        tag: channel,
        kind: "progress",
        sticky: true,
        timeoutMs: 0,
        progress: 1,
        action: null,
      };
    case "manual-required":
      return {
        key: `${status.state}:${channel}:${version}:${status.reason ?? ""}`,
        title: "Manual update required",
        message: messageParts.join("\n"),
        tag: channel,
        kind: "warning",
        sticky: true,
        timeoutMs: 0,
        action: "manual",
      };
    case "failed": {
      const retryDownload = isAutoUpdateTimeoutReason(status.reason ?? "");
      return {
        key: `${status.state}:${channel}:${version}:${status.reason ?? ""}`,
        title: "Update failed",
        message: messageParts.join("\n"),
        tag: channel,
        kind: "error",
        sticky: true,
        timeoutMs: 0,
        action: retryDownload ? "retry-download" : "manual",
      };
    }
    default:
      return null;
  }
};

const actionForSummary = (
  summary: ManualUpdateNotificationSummary,
  status: AutoUpdateStatus,
) => {
  switch (summary.action) {
    case "download":
      return {
        label: "Download update",
        run: () => {
          void runAutoUpdateDownloadWithNotification();
        },
      };
    case "retry-download":
      return {
        label: "Retry download",
        run: () => {
          void runAutoUpdateDownloadWithNotification();
        },
      };
    case "apply":
      return {
        label: "Install and relaunch",
        run: () => {
          void runAutoUpdateApplyWithNotification();
        },
      };
    case "manual":
      return {
        label: "Open GitHub Releases",
        run: () => {
          void openExternalUrlWithCapability(
            status.manualUrl || ARLECCHINO_GITHUB_RELEASES_URL,
          );
        },
      };
    case null:
    default:
      return undefined;
  }
};

let activeAutoUpdateOperation: "download" | "apply" | null = null;
let lastAutoUpdateNotificationKey: string | null = null;

export const publishAutoUpdateNotification = (
  status: AutoUpdateStatus,
  options: PublishAutoUpdateNotificationOptions = {},
): boolean => {
  const summary = buildManualUpdateNotification(status, {
    includePassive: options.includePassive,
    policy: options.policy,
  });
  if (!summary) {
    return false;
  }
  if (!options.force && lastAutoUpdateNotificationKey === summary.key) {
    return false;
  }

  lastAutoUpdateNotificationKey = summary.key;
  useAppNotificationStore.getState().addNotification({
    id: "auto-update",
    kind: summary.kind,
    title: summary.title,
    message: summary.message,
    source: "Updates",
    tag: summary.tag,
    sticky: summary.sticky,
    timeoutMs: summary.timeoutMs,
    progress: summary.progress,
    details: summary.details,
    detailsLabel: summary.detailsLabel,
    action: actionForSummary(summary, status),
  });
  return true;
};

export const publishBackgroundAutoUpdateNotification = (
  status: AutoUpdateStatus,
): boolean =>
  publishAutoUpdateNotification(status, {
    policy: "background",
  });

export async function runAutoUpdateDownloadWithNotification(
  download: () => Promise<AutoUpdateStatus> = downloadAutoUpdate,
): Promise<AutoUpdateStatus> {
  if (activeAutoUpdateOperation !== null) {
    return getAutoUpdateStatusSnapshot();
  }

  activeAutoUpdateOperation = "download";
  const current = getAutoUpdateStatusSnapshot();
  publishAutoUpdateNotification(
    {
      ...current,
      state: "downloading",
      reason: "Downloading update artifact.",
      progress: current.progress > 0 ? current.progress : 0.05,
      updatedAt: Date.now(),
    },
    { force: true, policy: "manual" },
  );

  try {
    const status = await download();
    publishAutoUpdateNotification(status, {
      force: true,
      policy: "manual",
    });
    return status;
  } catch (error) {
    const failedStatus: AutoUpdateStatus = {
      ...getAutoUpdateStatusSnapshot(),
      state: "failed",
      reason:
        error instanceof Error ? error.message : "Update download failed.",
      updatedAt: Date.now(),
    };
    publishAutoUpdateNotification(failedStatus, {
      force: true,
      policy: "manual",
    });
    return failedStatus;
  } finally {
    activeAutoUpdateOperation = null;
  }
}

export async function runAutoUpdateApplyWithNotification(
  apply: () => Promise<AutoUpdateStatus> = applyStagedAutoUpdate,
): Promise<AutoUpdateStatus> {
  if (activeAutoUpdateOperation !== null) {
    return getAutoUpdateStatusSnapshot();
  }

  activeAutoUpdateOperation = "apply";
  const current = getAutoUpdateStatusSnapshot();
  publishAutoUpdateNotification(
    {
      ...current,
      state: "applying",
      reason: "Installing update and preparing relaunch.",
      progress: 1,
      updatedAt: Date.now(),
    },
    { force: true, policy: "manual" },
  );

  try {
    const status = await apply();
    publishAutoUpdateNotification(status, {
      force: true,
      policy: "manual",
    });
    return status;
  } catch (error) {
    const failedStatus: AutoUpdateStatus = {
      ...getAutoUpdateStatusSnapshot(),
      state: "failed",
      reason: error instanceof Error ? error.message : "Update install failed.",
      updatedAt: Date.now(),
    };
    publishAutoUpdateNotification(failedStatus, {
      force: true,
      policy: "manual",
    });
    return failedStatus;
  } finally {
    activeAutoUpdateOperation = null;
  }
}

export async function runAutoUpdateCheckWithNotification(
  check: () => Promise<AutoUpdateStatus> = checkForAutoUpdate,
): Promise<AutoUpdateStatus> {
  const current = getAutoUpdateStatusSnapshot();
  publishAutoUpdateNotification(
    {
      ...current,
      state: "checking",
      reason: "Checking the configured update manifest.",
      progress: 0,
      updatedAt: Date.now(),
    },
    { includePassive: true, force: true, policy: "manual" },
  );

  try {
    const status = await check();
    const published = publishAutoUpdateNotification(status, {
      includePassive: true,
      force: true,
      policy: "manual",
    });
    if (!published) {
      publishAutoUpdateNotification(
        {
          ...status,
          state: "not-available",
          reason: status.reason ?? "No update is available.",
          updatedAt: Date.now(),
        },
        { includePassive: true, force: true, policy: "manual" },
      );
    }
    return status;
  } catch (error) {
    const failedStatus: AutoUpdateStatus = {
      ...getAutoUpdateStatusSnapshot(),
      state: "failed",
      reason: error instanceof Error ? error.message : "Update check failed.",
      updatedAt: Date.now(),
    };
    publishAutoUpdateNotification(failedStatus, {
      includePassive: true,
      force: true,
      policy: "manual",
    });
    return failedStatus;
  }
}

export function resetManualUpdateNotificationStateForTests(): void {
  lastAutoUpdateNotificationKey = null;
  activeAutoUpdateOperation = null;
}

export function useManualUpdateNotifications(): void {
  const status = useAutoUpdateStatus();
  const lastNotificationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const summary = buildManualUpdateNotification(status, {
      policy: "background",
    });
    if (!summary || lastNotificationKeyRef.current === summary.key) {
      return;
    }

    lastNotificationKeyRef.current = summary.key;
    publishBackgroundAutoUpdateNotification(status);
  }, [status]);
}
