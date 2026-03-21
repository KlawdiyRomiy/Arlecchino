import { useWorkspaceStore } from "../stores/workspaceStore";

export const PROJECT_SWITCH_BLOCKERS = {
  filePerspective: "file-perspective",
  quickLook: "quick-look",
  snippets: "snippets-manager",
  unifiedSearch: "unified-search",
} as const;

export const blockProjectSwitch = (key: string) => {
  useWorkspaceStore.getState().blockProjectSwitch(key);
};

export const unblockProjectSwitch = (key: string) => {
  useWorkspaceStore.getState().unblockProjectSwitch(key);
};

export const isProjectSwitchBlocked = () => {
  const state = useWorkspaceStore.getState();
  return state.pendingId !== null || state.uiBlockers.length > 0;
};
