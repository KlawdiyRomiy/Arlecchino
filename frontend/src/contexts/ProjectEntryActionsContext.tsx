import React, { createContext, useContext } from "react";

export interface ProjectEntryActionTarget {
  path: string;
  isDirectory: boolean;
}

export interface ProjectEntryTrashRequest extends ProjectEntryActionTarget {
  displayName?: string;
}

export interface ProjectEntryMoveRequest extends ProjectEntryActionTarget {
  targetDirectory: string;
}

export interface ProjectEntryActionsContextValue {
  projectPath: string;
  getRelativePath: (path: string) => string;
  copyText: (text: string, successMessage?: string) => Promise<boolean>;
  copyAbsolutePath: (path: string) => Promise<boolean>;
  copyRelativePath: (path: string) => Promise<boolean>;
  copyProjectPath: () => Promise<boolean>;
  revealEntry: (path: string) => Promise<boolean>;
  requestCreateEntry: (type: "file" | "folder", directoryPath?: string) => void;
  requestMoveEntry: (entry: ProjectEntryMoveRequest) => Promise<boolean>;
  requestRenameEntry: (entry: ProjectEntryActionTarget) => void;
  requestTrashEntry: (entry: ProjectEntryTrashRequest) => void;
}

const ProjectEntryActionsContext =
  createContext<ProjectEntryActionsContextValue | null>(null);

export const ProjectEntryActionsProvider: React.FC<{
  value: ProjectEntryActionsContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <ProjectEntryActionsContext.Provider value={value}>
    {children}
  </ProjectEntryActionsContext.Provider>
);

export const useProjectEntryActions = () => {
  const context = useContext(ProjectEntryActionsContext);
  if (!context) {
    throw new Error(
      "useProjectEntryActions must be used within ProjectEntryActionsProvider",
    );
  }
  return context;
};
