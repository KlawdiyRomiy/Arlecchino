import React from "react";
import { TerminalPanelContent } from "../TerminalPanel";

interface TUITerminalWorkspaceContentProps {
  paneStyle: React.CSSProperties;
  onOpenFileRef: (path: string, line?: number, column?: number) => void;
  onOpenPreviewUrl: (url: string, sessionId: string) => void;
}

export const TUITerminalWorkspaceContent: React.FC<
  TUITerminalWorkspaceContentProps
> = ({ paneStyle, onOpenFileRef, onOpenPreviewUrl }) => (
  <div style={paneStyle}>
    <TerminalPanelContent
      onOpenFileRef={onOpenFileRef}
      onOpenPreviewUrl={onOpenPreviewUrl}
    />
  </div>
);
