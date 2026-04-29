import { canUseShellCapability } from "./shellCapabilities";

type SelectDirectoryBinding = (title: string) => Promise<string>;

export const selectDirectoryWithCapability = async (
  title: string,
  selectDirectory: SelectDirectoryBinding,
): Promise<string> => {
  if (!canUseShellCapability("dialogs")) {
    throw new Error("Native directory dialogs are unavailable in this shell.");
  }

  return selectDirectory(title);
};
