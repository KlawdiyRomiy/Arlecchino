import React, { createContext, useCallback, useContext, useState } from "react";
import {
  blockProjectSwitch,
  PROJECT_SWITCH_BLOCKERS,
  unblockProjectSwitch,
} from "../utils/priorityUI";

interface PluginModalContextValue {
  activeModal: string | null;
  openModal: (modalType: string) => void;
  closeModal: () => void;
}

const PluginModalContext = createContext<PluginModalContextValue | null>(null);

export const PluginModalProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const openModal = useCallback((modalType: string) => {
    if (!modalType) {
      return;
    }

    blockProjectSwitch(PROJECT_SWITCH_BLOCKERS.pluginModal);
    setActiveModal(modalType);
  }, []);

  const closeModal = useCallback(() => {
    unblockProjectSwitch(PROJECT_SWITCH_BLOCKERS.pluginModal);
    setActiveModal(null);
  }, []);

  return (
    <PluginModalContext.Provider value={{ activeModal, openModal, closeModal }}>
      {children}
    </PluginModalContext.Provider>
  );
};

export const usePluginModal = () => {
  const context = useContext(PluginModalContext);
  if (!context) {
    throw new Error("usePluginModal must be used within PluginModalProvider");
  }

  return context;
};
