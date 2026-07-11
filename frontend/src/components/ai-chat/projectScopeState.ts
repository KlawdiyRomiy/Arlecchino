import { AIChatAction } from "../../../bindings/arlecchino/internal/ai/models";

import { askReadonlyProfileId, type AIChatUIState } from "./types";

const defaultChatSessionId = "default";

export function resetAIChatUIStateForProject(
  state: AIChatUIState,
): AIChatUIState {
  return {
    ...state,
    input: "",
    activeSessionId: defaultChatSessionId,
    selectedAction: AIChatAction.AIChatActionAsk,
    selectedProfileId: askReadonlyProfileId,
    selectedWorkflowId: "",
    selectedMentionsBySession: {},
    providerPopoverOpen: false,
    settingsPopoverOpen: false,
    activeRunId: "",
    hydratedRuns: {},
  };
}
