import { Extension } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";

import { GitLineMarker, GitLineMarkerType } from "../utils/git";

interface GitGutterOptions {
  markers: GitLineMarker[];
  onMarkerClick?: (marker: GitLineMarker) => void;
}

const priorityByType: Record<GitLineMarkerType, number> = {
  deleted: 3,
  modified: 2,
  added: 1,
};

class GitMarker extends GutterMarker {
  constructor(private readonly marker: GitLineMarker) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return (
      other instanceof GitMarker &&
      other.marker.line === this.marker.line &&
      other.marker.type === this.marker.type &&
      other.marker.count === this.marker.count &&
      other.marker.source === this.marker.source
    );
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    const count = Math.max(1, this.marker.count || 1);
    const label =
      this.marker.type === "deleted"
        ? `${count} deleted ${count === 1 ? "line" : "lines"} (${this.marker.source})`
        : `${this.marker.type} line (${this.marker.source})`;

    marker.className = `cm-git-marker cm-git-marker-${this.marker.type}`;
    marker.dataset.diffType = this.marker.type;
    marker.dataset.diffCount = String(count);
    marker.dataset.diffSource = this.marker.source;
    marker.title = label;
    marker.setAttribute("aria-label", label);

    if (this.marker.type === "deleted") {
      const notch = document.createElement("span");
      notch.className = "cm-git-marker-delete-notch";
      marker.appendChild(notch);

      if (count > 1) {
        const countBadge = document.createElement("span");
        countBadge.className = "cm-git-marker-delete-count";
        countBadge.textContent = String(count);
        marker.appendChild(countBadge);
      }
      return marker;
    }

    const bar = document.createElement("span");
    bar.className = "cm-git-marker-bar";
    marker.appendChild(bar);
    return marker;
  }
}

class GitSpacerMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const spacer = document.createElement("span");
    spacer.className = "cm-git-marker cm-git-marker-spacer";
    return spacer;
  }
}

const spacerMarker = new GitSpacerMarker();

const buildMarkerMap = (
  markers: GitLineMarker[],
): Map<number, GitLineMarker> => {
  const markerMap = new Map<number, GitLineMarker>();

  markers.forEach((marker) => {
    const existing = markerMap.get(marker.line);
    if (!existing) {
      markerMap.set(marker.line, marker);
      return;
    }

    if (priorityByType[marker.type] >= priorityByType[existing.type]) {
      markerMap.set(marker.line, marker);
    }
  });

  return markerMap;
};

export const createGitGutterExtension = ({
  markers,
  onMarkerClick,
}: GitGutterOptions): Extension => {
  const markerMap = buildMarkerMap(markers);

  return [
    gutter({
      class: "cm-git-gutter",
      initialSpacer: () => spacerMarker,
      lineMarker: (view, line) => {
        const lineNumber = view.state.doc.lineAt(line.from).number;
        const marker = markerMap.get(lineNumber);
        if (!marker) return null;
        return new GitMarker(marker);
      },
      domEventHandlers: {
        mousedown: (view, line) => {
          if (!onMarkerClick) return false;
          const lineNumber = view.state.doc.lineAt(line.from).number;
          const marker = markerMap.get(lineNumber);
          if (!marker) return false;
          onMarkerClick(marker);
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      ".cm-gutter.cm-git-gutter": {
        width: "16px",
        minWidth: "16px",
        overflow: "visible",
      },
      ".cm-git-gutter .cm-gutterElement": {
        overflow: "visible",
      },
      ".cm-git-marker": {
        position: "relative",
        display: "flex",
        width: "14px",
        height: "100%",
        minHeight: "100%",
        alignItems: "stretch",
        justifyContent: "center",
        boxSizing: "border-box",
        marginLeft: "1px",
      },
      ".cm-git-marker-spacer": {
        opacity: "0",
      },
      ".cm-git-marker-bar": {
        display: "block",
        width: "3px",
        minHeight: "100%",
        borderRadius: "2px",
      },
      ".cm-git-marker-added": {
        color: "#22c55e",
      },
      ".cm-git-marker-added .cm-git-marker-bar": {
        backgroundColor: "currentColor",
        boxShadow: "0 0 8px rgba(34, 197, 94, 0.3)",
      },
      ".cm-git-marker-modified": {
        color: "#f59e0b",
      },
      ".cm-git-marker-modified .cm-git-marker-bar": {
        backgroundColor: "currentColor",
        boxShadow: "0 0 8px rgba(245, 158, 11, 0.28)",
      },
      ".cm-git-marker-deleted": {
        color: "#ef4444",
      },
      ".cm-git-marker-delete-notch": {
        position: "absolute",
        top: "-2px",
        left: "3px",
        width: "8px",
        height: "2px",
        borderRadius: "2px",
        backgroundColor: "#ef4444",
        boxShadow: "0 0 8px rgba(239, 68, 68, 0.35)",
      },
      ".cm-git-marker-delete-count": {
        position: "absolute",
        top: "-7px",
        right: "0",
        minWidth: "10px",
        height: "10px",
        boxSizing: "border-box",
        border: "1px solid rgba(239, 68, 68, 0.55)",
        borderRadius: "999px",
        backgroundColor: "rgba(127, 29, 29, 0.92)",
        color: "#fecaca",
        fontSize: "8px",
        fontWeight: "700",
        lineHeight: "9px",
        textAlign: "center",
        pointerEvents: "none",
      },
    }),
  ];
};
