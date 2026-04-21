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

export type LayoutSnappedSurface = {
  position: LayoutPanelPosition;
  width: number;
  height: number;
};

export const SNAPPED_PANEL_OUTER_GAP = 0;

export function calculatePanelMargins(
  panels: LayoutPanelVisibility,
  panelConfigs: LayoutPanelConfigs,
  snappedSurfaces: LayoutSnappedSurface[] = [],
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

    if (config.position === "left") {
      marginLeft = Math.max(
        marginLeft,
        config.size.width + SNAPPED_PANEL_OUTER_GAP,
      );
    }
    if (config.position === "right") {
      marginRight = Math.max(
        marginRight,
        config.size.width + SNAPPED_PANEL_OUTER_GAP,
      );
    }
    if (config.position === "bottom") {
      marginBottom = Math.max(
        marginBottom,
        config.size.height + SNAPPED_PANEL_OUTER_GAP,
      );
    }
    if (config.position === "top") {
      marginTop = Math.max(
        marginTop,
        config.size.height + SNAPPED_PANEL_OUTER_GAP,
      );
    }
  });

  snappedSurfaces.forEach((surface) => {
    if (surface.position === "left") {
      marginLeft = Math.max(
        marginLeft,
        surface.width + SNAPPED_PANEL_OUTER_GAP,
      );
    }
    if (surface.position === "right") {
      marginRight = Math.max(
        marginRight,
        surface.width + SNAPPED_PANEL_OUTER_GAP,
      );
    }
    if (surface.position === "bottom") {
      marginBottom = Math.max(
        marginBottom,
        surface.height + SNAPPED_PANEL_OUTER_GAP,
      );
    }
    if (surface.position === "top") {
      marginTop = Math.max(marginTop, surface.height + SNAPPED_PANEL_OUTER_GAP);
    }
  });

  return { marginLeft, marginRight, marginBottom, marginTop };
}
