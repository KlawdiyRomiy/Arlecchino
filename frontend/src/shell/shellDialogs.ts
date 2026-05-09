import { canUseShellCapability } from "./shellCapabilities";

type SelectDirectoryBinding = (title: string) => Promise<string>;
type SelectOpenTargetBinding<T> = (title: string) => Promise<T>;

export const selectDirectoryWithCapability = async (
  title: string,
  selectDirectory: SelectDirectoryBinding,
): Promise<string> => {
  if (!canUseShellCapability("dialogs")) {
    throw new Error("Native directory dialogs are unavailable in this shell.");
  }

  return selectDirectory(title);
};

export const selectOpenTargetWithCapability = async <T>(
  title: string,
  selectOpenTarget: SelectOpenTargetBinding<T>,
): Promise<T> => {
  if (!canUseShellCapability("dialogs")) {
    throw new Error("Native open dialogs are unavailable in this shell.");
  }

  return selectOpenTarget(title);
};
