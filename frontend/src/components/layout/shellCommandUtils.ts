import type { ExecutionProfile } from "../../utils/executionProfiles";

export const quoteShellPath = (value: string): string => {
  const escaped = value.replace(/'/g, `'"'"'`);
  return `'${escaped}'`;
};

export const commandWithWorkingDirectory = (
  command: string,
  workingDirectory?: string,
): string => {
  const trimmedCommand = command.trim();
  const trimmedDirectory = workingDirectory?.trim();

  if (!trimmedCommand) {
    return "";
  }

  if (!trimmedDirectory) {
    return trimmedCommand;
  }

  return `cd ${quoteShellPath(trimmedDirectory)} && ${trimmedCommand}`;
};

export const hasMissingTools = (profile: ExecutionProfile): boolean =>
  Array.isArray(profile.missingTools) && profile.missingTools.length > 0;
