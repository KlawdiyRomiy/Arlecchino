import {
  canUseShellCapability,
  getShellCapabilitiesSnapshot,
} from "./shellCapabilities";

type SelectDirectoryBinding = (title: string) => Promise<string>;
type SelectOpenTargetBinding<T> = (title: string) => Promise<T>;

const fallbackDialogReason =
  "Native dialogs are unavailable in this shell. Run the packaged Wails app to browse the filesystem.";

export const getShellDialogUnavailableMessage = (
  kind: "directory" | "open" = "open",
): string => {
  const descriptor = getShellCapabilitiesSnapshot().capabilities.dialogs;
  const reason = descriptor.reason?.trim() || fallbackDialogReason;
  const label = kind === "directory" ? "directory" : "open";
  return `Native ${label} dialogs are unavailable in this shell. ${reason}`;
};

export const selectDirectoryWithCapability = async (
  title: string,
  selectDirectory: SelectDirectoryBinding,
): Promise<string> => {
  if (!canUseShellCapability("dialogs")) {
    throw new Error(getShellDialogUnavailableMessage("directory"));
  }

  return selectDirectory(title);
};

export const selectOpenTargetWithCapability = async <T>(
  title: string,
  selectOpenTarget: SelectOpenTargetBinding<T>,
): Promise<T> => {
  if (!canUseShellCapability("dialogs")) {
    throw new Error(getShellDialogUnavailableMessage("open"));
  }

  return selectOpenTarget(title);
};
