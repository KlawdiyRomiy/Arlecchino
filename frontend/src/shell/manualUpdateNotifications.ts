import { useEffect, useRef } from "react";

import { useAppNotificationStore } from "../stores/appNotificationStore";
import { openExternalUrlWithCapability } from "./browser";
import {
  type PackagedOSIntegrationSnapshot,
  usePackagedOSIntegration,
} from "./packagedOSIntegration";

export const ARLECCHINO_GITHUB_RELEASES_URL =
  "https://github.com/KlawdiyRomiy/Arlecchino/releases";

interface ManualUpdateNotificationSummary {
  key: string;
  title: string;
  message: string;
  kind: "info" | "warning";
  sticky: boolean;
  timeoutMs: number;
}

export const buildManualUpdateNotification = (
  snapshot: PackagedOSIntegrationSnapshot,
): ManualUpdateNotificationSummary | null => {
  const manifest = snapshot.autoUpdateManifest;
  if (!manifest?.version) {
    return null;
  }

  const autoUpdateAdapter = snapshot.adapters.autoUpdate;
  if (
    autoUpdateAdapter.status === "unavailable" ||
    autoUpdateAdapter.status === "requires-build"
  ) {
    return null;
  }

  const channel = manifest.channel ?? "alpha";
  const notes = manifest.releaseNotes ?? manifest.notes;
  const messageParts = [`Version ${manifest.version}`, `Channel: ${channel}`];
  if (notes) {
    messageParts.push(notes);
  }

  return {
    key: `${channel}:${manifest.version}`,
    title: manifest.mandatory
      ? "Required update available"
      : "Update available",
    message: messageParts.join("\n"),
    kind: manifest.mandatory ? "warning" : "info",
    sticky: manifest.mandatory ?? false,
    timeoutMs: manifest.mandatory ? 0 : 14000,
  };
};

export function useManualUpdateNotifications(): void {
  const snapshot = usePackagedOSIntegration();
  const lastNotificationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const summary = buildManualUpdateNotification(snapshot);
    if (!summary || lastNotificationKeyRef.current === summary.key) {
      return;
    }

    lastNotificationKeyRef.current = summary.key;
    useAppNotificationStore.getState().addNotification({
      id: `manual-update:${summary.key}`,
      kind: summary.kind,
      title: summary.title,
      message: summary.message,
      source: "Updates",
      sticky: summary.sticky,
      timeoutMs: summary.timeoutMs,
      action: {
        label: "Open GitHub Releases",
        run: () => {
          void openExternalUrlWithCapability(ARLECCHINO_GITHUB_RELEASES_URL);
        },
      },
    });
  }, [snapshot]);
}
