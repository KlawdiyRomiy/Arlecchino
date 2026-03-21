interface FloatingViewportInput {
  viewportWidth: number;
  viewportHeight: number;
}

interface TUIPanelVisibility {
  explorer: boolean;
  terminal: boolean;
  aiChat: boolean;
  git: boolean;
  browser: boolean;
}

interface FloatingTerminalConfig {
  position: "bottom";
  mode: "floating" | "snapped";
  x: number;
  y: number;
  size: {
    width: number;
    height: number;
  };
}

export const getTUIFloatingTerminalConfig = ({
  viewportWidth,
  viewportHeight,
}: FloatingViewportInput): FloatingTerminalConfig => {
  const fullscreenWidth = Math.max(0, Math.floor(viewportWidth));
  const fullscreenHeight = Math.max(0, Math.floor(viewportHeight));

  return {
    position: "bottom",
    mode: "floating",
    x: 0,
    y: 0,
    size: {
      width: fullscreenWidth,
      height: fullscreenHeight,
    },
  };
};

export const getTUIPanelVisibility = (
  currentPanels: TUIPanelVisibility,
): TUIPanelVisibility => {
  return {
    ...currentPanels,
    terminal: true,
  };
};
