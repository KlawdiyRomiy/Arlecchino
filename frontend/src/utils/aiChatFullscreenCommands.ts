export const AI_CHAT_FULLSCREEN_COMMAND_EVENT =
  "arlecchino:ai-chat-fullscreen-command";

export type AIChatFullscreenCommand =
  | "history.toggle"
  | "sessionSearch.open"
  | "review.toggle"
  | "review.expandToggle";

export interface AIChatFullscreenCommandDetail {
  command: AIChatFullscreenCommand;
  source: "keyboard" | "menu";
}

export const dispatchAIChatFullscreenCommand = (
  command: AIChatFullscreenCommand,
  source: AIChatFullscreenCommandDetail["source"],
): void => {
  window.dispatchEvent(
    new CustomEvent<AIChatFullscreenCommandDetail>(
      AI_CHAT_FULLSCREEN_COMMAND_EVENT,
      {
        detail: { command, source },
      },
    ),
  );
};
