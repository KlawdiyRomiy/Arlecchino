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
  constructor(private readonly markerType: GitLineMarkerType) {
    super();
  }

  toDOM(): HTMLElement {
    const dot = document.createElement("span");
    dot.className = `cm-git-marker cm-git-marker-${this.markerType}`;
    return dot;
  }
}

class GitSpacerMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const spacer = document.createElement("span");
    spacer.className = "cm-git-marker cm-git-marker-spacer";
    return spacer;
  }
}

const markerInstanceByType: Record<GitLineMarkerType, GitMarker> = {
  added: new GitMarker("added"),
  modified: new GitMarker("modified"),
  deleted: new GitMarker("deleted"),
};

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
        return markerInstanceByType[marker.type];
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
      ".cm-git-gutter": {
        width: "8px",
      },
      ".cm-git-marker": {
        display: "inline-block",
        width: "3px",
        height: "100%",
        marginLeft: "2px",
        borderRadius: "2px",
      },
      ".cm-git-marker-spacer": {
        opacity: "0",
      },
      ".cm-git-marker-added": {
        backgroundColor: "#22c55e",
      },
      ".cm-git-marker-modified": {
        backgroundColor: "#f59e0b",
      },
      ".cm-git-marker-deleted": {
        backgroundColor: "#ef4444",
      },
    }),
  ];
};
