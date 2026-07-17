import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  getBezierPath,
  BaseEdge,
  BackgroundVariant,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X } from "lucide-react";
import {
  useDependencyGraph,
  type FileCardData,
  type DepEdgeData,
} from "../hooks/useDependencyGraph";
import { getThemeColors, radius } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { SetNativeWindowControlsOccluded } from "../wails/app";

const SelectCtx = createContext<(path: string, line?: number) => void>(
  () => {},
);

interface DependencyTreeProps {
  filePath: string;
  onClose: () => void;
  onFileSelect: (path: string, line?: number) => void;
}

const KIND_ABBR: Record<string, string> = {
  function: "fn",
  method: "fn",
  class: "cls",
  interface: "ifc",
  struct: "str",
  type: "typ",
  constant: "const",
  variable: "var",
  property: "prop",
  enum: "enum",
  component: "cmp",
  package: "pkg",
};

const ANIM_NODE_DURATION = 350;
const ANIM_NODE_STAGGER = 40;
const ANIM_EDGE_DELAY_BASE = 150;
let nativeWindowControlsOcclusionGeneration = 0;

function FileCardNode({ data: rawData }: NodeProps) {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const onSelect = useContext(SelectCtx);
  const data = rawData as FileCardData;

  const animDelay = data.animIndex * ANIM_NODE_STAGGER;

  return (
    <div
      style={{
        width: 240,
        background: theme.bgPanel,
        border: `1px solid ${data.isRoot ? theme.textPrimary : theme.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
        fontSize: 12,
        animation: `perspNodeAppear ${ANIM_NODE_DURATION}ms cubic-bezier(0.22,1,0.36,1) ${animDelay}ms both`,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div
        onClick={() => onSelect(data.fullPath)}
        style={{
          padding: "8px 10px",
          borderBottom: `1px solid ${theme.border}`,
          fontWeight: 600,
          color: data.isRoot ? theme.textPrimary : theme.text,
          cursor: "pointer",
          background: data.isRoot
            ? "color-mix(in srgb, var(--accent-primary) 8%, transparent)"
            : "transparent",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {data.label}
      </div>

      {data.symbols.length > 0 && (
        <div
          className="nowheel nodrag"
          style={{ maxHeight: 330, overflowY: "auto" }}
          onWheel={(e) => e.stopPropagation()}
        >
          {data.symbols.slice(0, 15).map((s) => (
            <div
              key={`${s.name}-${s.line}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(data.fullPath, s.line);
              }}
              style={{
                padding: "3px 10px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: theme.text,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = theme.bgHover)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <span
                style={{
                  color: theme.textMuted,
                  fontSize: 10,
                  fontFamily: "monospace",
                  minWidth: 32,
                }}
              >
                {KIND_ABBR[s.kind] || s.kind}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.name}
              </span>
            </div>
          ))}
          {data.symbols.length > 15 && (
            <div
              style={{
                padding: "3px 10px",
                color: theme.textMuted,
                fontSize: 11,
                fontStyle: "italic",
              }}
            >
              +{data.symbols.length - 15} more
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

function DependencyEdge(props: EdgeProps) {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });

  const edgeData = props.data as DepEdgeData | undefined;
  const kind = edgeData?.kind;
  const nodeCount = edgeData?.nodeCount ?? 0;
  const edgeDelay = nodeCount * ANIM_NODE_STAGGER + ANIM_EDGE_DELAY_BASE;

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: theme.border,
          strokeWidth: 1.5,
          strokeDasharray: 9999,
          strokeDashoffset: 9999,
          animation: `perspEdgeDraw 400ms ease-out ${edgeDelay}ms forwards`,
        }}
      />
      {kind && (
        <text
          x={labelX}
          y={labelY - 8}
          textAnchor="middle"
          style={{
            fontSize: 9,
            fill: theme.textMuted,
            pointerEvents: "none",
            opacity: 0,
            animation: `perspFadeIn 200ms ease ${edgeDelay + 200}ms forwards`,
          }}
        >
          {kind}
        </text>
      )}
    </>
  );
}

const NODE_TYPES = { fileCard: FileCardNode };
const EDGE_TYPES = { dependency: DependencyEdge };

const ANIM_STYLES = `
.dependency-tree-flow {
  --xy-background-color: var(--surface-canvas);
  --xy-background-pattern-color: var(--grid-dot);
  --xy-edge-stroke: var(--border-default);
  --xy-edge-stroke-selected: var(--text-secondary);
  --xy-selection-background-color: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  --xy-selection-border: 1px dotted color-mix(in srgb, var(--accent-primary) 68%, transparent);
  --xy-minimap-background-color: var(--surface-elevated);
  --xy-minimap-mask-background-color: color-mix(in srgb, var(--surface-canvas) 68%, transparent);
  --xy-minimap-mask-stroke-color: transparent;
  --xy-minimap-node-background-color: color-mix(in srgb, var(--text-muted) 46%, var(--surface-2));
  --xy-minimap-node-stroke-color: color-mix(in srgb, var(--border-default) 78%, transparent);
  --xy-controls-button-background-color: var(--surface-elevated);
  --xy-controls-button-background-color-hover: var(--surface-hover);
  --xy-controls-button-color: var(--text-secondary);
  --xy-controls-button-color-hover: var(--text-primary);
  --xy-controls-button-border-color: var(--border-subtle);
  --xy-controls-box-shadow: var(--shadow-soft);
}
.dependency-tree-flow .react-flow__controls {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--surface-elevated);
}
.dependency-tree-flow .react-flow__controls-button {
  transition:
    background-color 150ms ease,
    color 150ms ease,
    border-color 150ms ease;
}
@keyframes perspOverlayIn {
  from { opacity: 0 }
  to   { opacity: 1 }
}
@keyframes perspNodeAppear {
  from { opacity: 0; transform: scale(0.92) }
  to   { opacity: 1; transform: scale(1) }
}
@keyframes perspEdgeDraw {
  to { stroke-dashoffset: 0 }
}
@keyframes perspFadeIn {
  to { opacity: 1 }
}
@keyframes perspShimmer {
  0%   { transform: translateX(-100%) }
  100% { transform: translateX(200%) }
}
`;

export const DependencyTree: React.FC<DependencyTreeProps> = ({
  filePath,
  onClose,
  onFileSelect,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const {
    nodes: layoutNodes,
    edges: layoutEdges,
    loading,
  } = useDependencyGraph(filePath, 2);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  const [prevLayout, setPrevLayout] = useState(layoutNodes);
  if (layoutNodes !== prevLayout) {
    setPrevLayout(layoutNodes);
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }

  useLayoutEffect(() => {
    const generation = ++nativeWindowControlsOcclusionGeneration;
    void SetNativeWindowControlsOccluded(true).catch(() => undefined);
    return () => {
      window.setTimeout(() => {
        if (nativeWindowControlsOcclusionGeneration === generation) {
          void SetNativeWindowControlsOccluded(false).catch(() => undefined);
        }
      }, 0);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.metaKey && e.key.toLowerCase() === "w")) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const fitViewOpts = useMemo(() => ({ padding: 0.3 }), []);

  return createPortal(
    <SelectCtx.Provider value={onFileSelect}>
      <style>{ANIM_STYLES}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: theme.bg,
          animation: "perspOverlayIn 150ms ease-out both",
        }}
      >
        <ReactFlow
          className="dependency-tree-flow"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={fitViewOpts}
          colorMode={isDark ? "dark" : "light"}
          minZoom={0.1}
          maxZoom={3}
          defaultEdgeOptions={{ animated: false }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            style={{
              background: theme.bgPanel,
              border: `1px solid ${theme.border}`,
              zIndex: 10,
            }}
          />
        </ReactFlow>

        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 50,
            padding: 8,
            background: theme.bgPanel,
            border: `1px solid ${theme.border}`,
            borderRadius: radius.md,
            color: theme.text,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            opacity: 0,
            animation: "perspFadeIn 200ms ease 100ms forwards",
          }}
        >
          <X size={18} />
        </button>

        {nodes.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              pointerEvents: "none",
              opacity: 0,
              animation: "perspFadeIn 300ms ease 200ms forwards",
            }}
          >
            {loading ? (
              <>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 13,
                    color: theme.textMuted,
                  }}
                >
                  Scanning dependencies...
                </span>
                <div
                  style={{
                    width: 200,
                    height: 3,
                    background:
                      "color-mix(in srgb, var(--text-primary) 8%, transparent)",
                    borderRadius: 9999,
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "40%",
                      background: "var(--accent-primary)",
                      borderRadius: 9999,
                      boxShadow:
                        "0 0 8px color-mix(in srgb, var(--accent-primary) 32%, transparent)",
                      animation: "perspShimmer 1s ease-in-out infinite",
                    }}
                  />
                </div>
              </>
            ) : (
              <span style={{ color: theme.textMuted, fontSize: 14 }}>
                No dependencies found
              </span>
            )}
          </div>
        )}
      </div>
    </SelectCtx.Provider>,
    document.body,
  );
};
