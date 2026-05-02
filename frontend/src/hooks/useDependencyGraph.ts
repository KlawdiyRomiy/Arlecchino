import { useState, useMemo, useRef } from "react";
import * as App from "../wails/app";
import type {
  DependencyGraph,
  NodeSymbol,
} from "../../bindings/arlecchino/internal/indexer/models";
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

export interface FileCardData extends Record<string, unknown> {
  label: string;
  fullPath: string;
  symbols: NodeSymbol[];
  isRoot: boolean;
  animIndex: number;
}

export interface DepEdgeData extends Record<string, unknown> {
  kind: string;
  line: number;
  nodeCount: number;
}

const NODE_W = 240;
const SYM_ROW = 22;
const HEADER_H = 36;
const MAX_SYM = 15;

const nodeH = (n: number) =>
  Math.max(48, HEADER_H + Math.min(n, MAX_SYM) * SYM_ROW);

const layoutDagre = (
  nodes: Node<FileCardData>[],
  edges: Edge<DepEdgeData>[],
): Node<FileCardData>[] => {
  if (!nodes.length) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 40,
    ranksep: 200,
    marginx: 50,
    marginy: 50,
  });

  for (const n of nodes)
    g.setNode(n.id, {
      width: NODE_W,
      height: nodeH(n.data.symbols?.length ?? 0),
    });
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    return {
      ...n,
      position: {
        x: p.x - (p.width ?? NODE_W) / 2,
        y: p.y - (p.height ?? 48) / 2,
      },
    };
  });
};

export const useDependencyGraph = (filePath: string, depth = 2) => {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [prevPath, setPrevPath] = useState("");
  const [resolvedPath, setResolvedPath] = useState("");
  const seqRef = useRef(0);

  if (filePath && filePath !== prevPath) {
    setPrevPath(filePath);
    const seq = ++seqRef.current;
    App.GetDependencyGraph(filePath, depth)
      .then((r) => {
        if (seqRef.current === seq) {
          setGraph(r?.nodes?.length ? r : null);
          setResolvedPath(filePath);
        }
      })
      .catch(() => {
        if (seqRef.current === seq) {
          setGraph(null);
          setResolvedPath(filePath);
        }
      });
  }

  return useMemo(() => {
    const loading = filePath !== resolvedPath;
    if (!graph?.nodes?.length)
      return {
        nodes: [] as Node<FileCardData>[],
        edges: [] as Edge<DepEdgeData>[],
        loading,
      };

    const nodeSet = new Set(graph.nodes.map((n) => n.path));
    const rootIdx = graph.nodes.findIndex((n) => n.path === filePath);

    const rfNodes: Node<FileCardData>[] = graph.nodes.map((n, i) => ({
      id: n.path,
      type: "fileCard",
      position: { x: 0, y: 0 },
      data: {
        label: n.path.split("/").pop() || n.path,
        fullPath: n.path,
        symbols: n.symbols || [],
        isRoot: n.path === filePath,
        animIndex: rootIdx >= 0 && i === rootIdx ? 0 : i < rootIdx ? i + 1 : i,
      },
    }));

    const seen = new Set<string>();
    const rfEdges: Edge<DepEdgeData>[] = [];
    for (const e of graph.edges) {
      if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
      const key = `${e.source}\u2192${e.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rfEdges.push({
        id: key,
        source: e.source,
        target: e.target,
        type: "dependency",
        data: { kind: e.kind, line: e.line, nodeCount: graph.nodes.length },
      });
    }

    return { nodes: layoutDagre(rfNodes, rfEdges), edges: rfEdges, loading };
  }, [graph, filePath, resolvedPath]);
};
