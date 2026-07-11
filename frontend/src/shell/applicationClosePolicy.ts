export type ApplicationCloseSource = "quit" | "window";

export const normalizeApplicationCloseSource = (
  source: unknown,
): ApplicationCloseSource => (source === "window" ? "window" : "quit");

export const shouldSkipApplicationCloseConfirmation = (
  welcomeScreenVisible: boolean,
  source: ApplicationCloseSource,
): boolean => welcomeScreenVisible && source === "quit";
