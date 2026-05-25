import type { ReactNode } from "react";
import type { ProjectEntryActionTarget } from "../../contexts/ProjectEntryActionsContext";
import type { ShortcutActionId } from "../../utils/keyboard";
import type { TUIAssistAnchor } from "../../utils/terminalLayout";
import type {
  EditorFileAccessPolicy,
  EditorFileLoadState,
  EditorFileOpenPayload,
} from "../../utils/editorFileLoader";
import type { PanelPosition, PanelSize } from "../ui/FloatingPanel";

export type MainEditorFileOpenHandler = (
  payload: EditorFileOpenPayload,
) => void;

export type MainEditorFileOpenRegistrar = (
  handler: MainEditorFileOpenHandler | null,
) => void;

export type MainEditorDirtyFlushHandler = () => Promise<void>;

export type MainEditorDirtyFlushRegistrar = (
  handler: MainEditorDirtyFlushHandler | null,
) => void;

export interface MarkdownPreviewSource {
  path: string;
  name: string;
  content: string;
}

export interface MainLayoutProps {
  children: ReactNode;
  onFileOpen?: MainEditorFileOpenHandler;
  onBackToWelcome?: () => void;
  onProjectOpen?: (path: string) => void | Promise<void>;
  onSwitchProject?: (id: string, direction?: number) => void;
  onCloseProject?: (id: string) => void;
  onDetachProject?: (id: string) => void;
  onReorderProjects?: (ids: string[]) => void;
  onPerspectiveOpen?: () => void;
  onPerspectiveClose?: () => void;
}

export interface PanelConfig {
  position: PanelPosition;
  size: PanelSize;
  mode: "snapped" | "floating";
  x: number;
  y: number;
}

export type PanelId =
  | "explorer"
  | "terminal"
  | "aiChat"
  | "git"
  | "problems"
  | "code"
  | "markdownPreview";
export type AssistPanelId = Exclude<
  PanelId,
  "terminal" | "problems" | "code" | "markdownPreview"
>;
export type PanelVisibility = Record<PanelId, boolean>;
export type ZenPinnedPanels = Record<PanelId, boolean>;
export type PanelFullscreenSnapshot = Pick<
  PanelConfig,
  "mode" | "x" | "y" | "size"
>;

export type HeldPanelShortcutTarget =
  | { kind: "panel"; panelId: PanelId }
  | { kind: "preview"; windowId?: string };

export interface HeldPanelShortcut {
  actionId?: ShortcutActionId;
  target: HeldPanelShortcutTarget;
  triggerCode: string;
  modifiers: {
    meta: boolean;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
  };
  runTapAction: () => void;
  tapActionRun: boolean;
  tapGraceTimer: ReturnType<typeof setTimeout> | null;
  moveLocked: boolean;
  moved: boolean;
}

export type PanelConfigs = Record<PanelId, PanelConfig>;
export type RememberedSnappedPositions = Record<PanelId, PanelPosition>;

export interface HydratedPanelLayoutState {
  panels: PanelVisibility;
  panelConfigs: PanelConfigs;
  rememberedSnappedPositions: RememberedSnappedPositions;
  zenPinnedPanels: ZenPinnedPanels;
}

export interface PanelOpenRequest {
  panel: string;
  position?: PanelPosition;
  mode?: "snapped" | "floating";
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  ratio?: number;
  anchor?: TUIAssistAnchor;
  path?: string;
  title?: string;
  name?: string;
  language?: string;
  content?: string;
  openIntentPolicy?: EditorFileAccessPolicy;
  line?: number;
  command?: string;
  terminalName?: string;
  focus?: boolean;
  reflowOnSnap?: boolean;
}

export interface PanelSideMoveRequest {
  from: PanelPosition;
  to: PanelPosition;
}

export interface CodePanelTab {
  path: string;
  name: string;
  content: string;
  language: string;
  line?: number;
  loadState?: EditorFileLoadState;
}

export interface ProjectEntryCreateDialogState {
  type: "file" | "folder";
  directoryPath: string;
}

export interface ProjectEntryRenameDialogState extends ProjectEntryActionTarget {
  name: string;
}

export interface ProjectEntryDeletedEvent {
  path?: string;
  isDirectory?: boolean;
}

export interface ProjectEntryRenamedEvent {
  oldPath?: string;
  newPath?: string;
  isDirectory?: boolean;
}

export type AppSurfaceAction =
  | { kind: "panel"; panelId: PanelId }
  | { kind: "dispatcher" }
  | { kind: "settings" }
  | { kind: "run"; mode: "run" | "debug" };
