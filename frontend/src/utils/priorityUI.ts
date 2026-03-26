import { useWorkspaceStore } from "../stores/workspaceStore";

export const PROJECT_SWITCH_BLOCKERS = {
  filePerspective: "file-perspective",
  pluginModal: "plugin-modal",
  quickLook: "quick-look",
  snippets: "snippets-manager",
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
