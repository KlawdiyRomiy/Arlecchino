import React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { motion, AnimatePresence } from "framer-motion";
import {
  File,
  FolderOpen,
  Copy,
  Trash2,
  Edit3,
  ExternalLink,
  FilePlus,
  FolderPlus,
} from "lucide-react";

interface FileContextMenuProps {
  children: React.ReactNode;
  isDirectory: boolean;
  filePath: string;
  onOpen?: () => void;
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
  filePath,
  onOpen,
  onReveal,
  onCopyPath,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}) => {
  const [open, setOpen] = React.useState(false);

  return (
    <ContextMenu.Root onOpenChange={setOpen}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>

      <AnimatePresence>
        {open && (
          <ContextMenu.Portal forceMount>
            <ContextMenu.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -5 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                className="z-50 min-w-[180px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg shadow-xl overflow-hidden py-1"
              >
                {onOpen && (
                  <ContextMenu.Item asChild>
                    <motion.button
                      whileHover={{ backgroundColor: "var(--bg-tertiary)" }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer outline-none"
                      onClick={onOpen}
                    >
                      {isDirectory ? (
                        <FolderOpen size={14} />
                      ) : (
                        <File size={14} />
                      )}
                      Open
                    </motion.button>
                  </ContextMenu.Item>
                )}

                {onReveal && (
                  <ContextMenu.Item asChild>
                    <motion.button
                      whileHover={{ backgroundColor: "var(--bg-tertiary)" }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer outline-none"
                      onClick={onReveal}
                    >
                      <ExternalLink size={14} />
                      Reveal in Finder
                    </motion.button>
                  </ContextMenu.Item>
                )}

                <ContextMenu.Separator className="h-px bg-[var(--border-subtle)] my-1" />

                {isDirectory && onNewFile && (
                  <ContextMenu.Item asChild>
                    <motion.button
                      whileHover={{ backgroundColor: "var(--bg-tertiary)" }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer outline-none"
                      onClick={onNewFile}
                    >
                      <FilePlus size={14} />
                      New File
                    </motion.button>
                  </ContextMenu.Item>
                )}

                {isDirectory && onNewFolder && (
                  <ContextMenu.Item asChild>
                    <motion.button
                      whileHover={{ backgroundColor: "var(--bg-tertiary)" }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer outline-none"
                      onClick={onNewFolder}
                    >
                      <FolderPlus size={14} />
                      New Folder
                    </motion.button>
                  </ContextMenu.Item>
                )}

                {isDirectory && (onNewFile || onNewFolder) && (
                  <ContextMenu.Separator className="h-px bg-[var(--border-subtle)] my-1" />
                )}

                {onCopyPath && (
                  <ContextMenu.Item asChild>
                    <motion.button
                      whileHover={{ backgroundColor: "var(--bg-tertiary)" }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer outline-none"
                      onClick={onCopyPath}
                    >
                      <Copy size={14} />
                      Copy Path
                    </motion.button>
                  </ContextMenu.Item>
                )}

                {onRename && (
                  <ContextMenu.Item asChild>
                    <motion.button
                      whileHover={{ backgroundColor: "var(--bg-tertiary)" }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer outline-none"
                      onClick={onRename}
                    >
                      <Edit3 size={14} />
                      Rename
                    </motion.button>
                  </ContextMenu.Item>
                )}

                {onDelete && (
                  <>
                    <ContextMenu.Separator className="h-px bg-[var(--border-subtle)] my-1" />
                    <ContextMenu.Item asChild>
                      <motion.button
                        whileHover={{
                          backgroundColor: "rgba(239, 68, 68, 0.1)",
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-red-400 hover:text-red-300 cursor-pointer outline-none"
                        onClick={onDelete}
                      >
                        <Trash2 size={14} />
                        Delete
                      </motion.button>
                    </ContextMenu.Item>
                  </>
                )}
              </motion.div>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        )}
      </AnimatePresence>
    </ContextMenu.Root>
  );
};

export default FileContextMenu;
