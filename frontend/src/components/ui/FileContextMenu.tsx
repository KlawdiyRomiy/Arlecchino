import React from "react";
import {
  Copy,
  Edit3,
  ExternalLink,
  File,
  FilePlus,
  FolderOpen,
  FolderPlus,
  PanelRightOpen,
  Trash2,
} from "lucide-react";

import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ContextActionMenu";

interface FileContextMenuProps {
  children: React.ReactNode;
  isDirectory: boolean;
  filePath: string;
  onOpen?: () => void;
  onOpenInPanel?: () => void;
  onReveal?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  children,
  isDirectory,
  onOpen,
  onOpenInPanel,
  onReveal,
  onCopyPath,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}) => {
  const items: ContextActionMenuItem[] = [
    onOpen
      ? {
          label: "Open",
          icon: isDirectory ? <FolderOpen size={14} /> : <File size={14} />,
          onSelect: onOpen,
        }
      : { hidden: true },
    !isDirectory && onOpenInPanel
      ? {
          label: "Open in Panel",
          icon: <PanelRightOpen size={14} />,
          onSelect: onOpenInPanel,
        }
      : { hidden: true },
    onReveal
      ? {
          label: "Reveal in File Manager",
          icon: <ExternalLink size={14} />,
          onSelect: onReveal,
        }
      : { hidden: true },
    { separator: true },
    isDirectory && onNewFile
      ? {
          label: "New File",
          icon: <FilePlus size={14} />,
          onSelect: onNewFile,
        }
      : { hidden: true },
    isDirectory && onNewFolder
      ? {
          label: "New Folder",
          icon: <FolderPlus size={14} />,
          onSelect: onNewFolder,
        }
      : { hidden: true },
    onCopyPath
      ? {
          label: "Copy Path",
          icon: <Copy size={14} />,
          onSelect: onCopyPath,
        }
      : { hidden: true },
    onRename
      ? {
          label: "Rename",
          icon: <Edit3 size={14} />,
          onSelect: onRename,
        }
      : { hidden: true },
    onDelete ? { separator: true } : { hidden: true },
    onDelete
      ? {
          label: "Move to Trash",
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: onDelete,
        }
      : { hidden: true },
  ];

  return <ContextActionMenu items={items}>{children}</ContextActionMenu>;
};

export default FileContextMenu;
