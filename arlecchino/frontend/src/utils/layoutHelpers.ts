export type LayoutPanelPosition = "left" | "right" | "bottom" | "top";

export type LayoutPanelConfig = {
  position: LayoutPanelPosition;
  mode: "snapped" | "floating";
  size: {
    width: number;
    height: number;
  };
};

export type LayoutPanelVisibility = Record<string, boolean>;
export type LayoutPanelConfigs = Record<string, LayoutPanelConfig>;

export type LayoutMargins = {
  marginLeft: number;
  marginRight: number;
  marginBottom: number;
  marginTop: number;
};

export function calculatePanelMargins(
  panels: LayoutPanelVisibility,
  panelConfigs: LayoutPanelConfigs,
): LayoutMargins {
  let marginLeft = 0;
  let marginRight = 0;
  let marginBottom = 0;
  let marginTop = 0;

  Object.keys(panelConfigs).forEach((id) => {
    if (!panels[id]) {
      return;
    }

    const config = panelConfigs[id];
    if (!config || config.mode !== "snapped") {
      return;
    }

    if (config.position === "left") marginLeft = config.size.width;
    if (config.position === "right") marginRight = config.size.width;
    if (config.position === "bottom") marginBottom = config.size.height;
    if (config.position === "top") marginTop = config.size.height;
  });

  return { marginLeft, marginRight, marginBottom, marginTop };
}
