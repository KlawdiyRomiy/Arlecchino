import React, { useCallback, useEffect } from "react";
import { ArtisanFormModal } from "../components/ArtisanFormModal";
import { useCommandRegistry } from "../contexts/CommandRegistryContext";
import { usePluginModal } from "../contexts/PluginModalContext";
import { useCommands } from "../hooks/useCommands";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface LaravelPluginProps {
  closeDispatcher: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const LaravelPluginRuntime: React.FC<LaravelPluginProps> = ({
  closeDispatcher,
  onSuccess,
  onError,
}) => {
  const { activeModal, closeModal, openModal } = usePluginModal();
  const { registerCommands, unregisterCommands } = useCommandRegistry();

  const handleOpenModal = useCallback(
    (modalType: string) => {
      closeDispatcher();
      openModal(modalType);
    },
    [closeDispatcher, openModal],
  );

  const { allCommands } = useCommands({
    onSuccess,
    onError,
    onOpenModal: handleOpenModal,
  });

  useEffect(() => {
    registerCommands("laravel", allCommands);
    return () => unregisterCommands("laravel");
  }, [allCommands, registerCommands, unregisterCommands]);

  return (
    <ArtisanFormModal
      isOpen={activeModal !== null}
      onClose={closeModal}
      modalType={activeModal || ""}
      onSuccess={onSuccess}
      onError={onError}
    />
  );
};

export const LaravelPlugin: React.FC<LaravelPluginProps> = (props) => {
  const activeFramework = useWorkspaceStore((state) => state.activeFramework);

  if (activeFramework !== "laravel") {
    return null;
  }

  return <LaravelPluginRuntime {...props} />;
};
