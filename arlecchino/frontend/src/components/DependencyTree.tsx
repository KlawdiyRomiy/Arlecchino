import React, { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  motion,
  useMotionValue,
  useTransform,
  MotionValue,
} from "framer-motion";
import {
  FileCode,
  X,
  ZoomIn,
  ZoomOut,
  Maximize,
  GripHorizontal,
  Layers,
  ChevronRight,
} from "lucide-react";
import {
  colors,
  getThemeColors,
  radius,
  shadows,
  zIndex,
} from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { RelationGroup, RelatedFile } from "../hooks/useFileRelations";

interface DependencyTreeProps {
  isOpen: boolean;
  relations: RelationGroup[];
  currentFileName: string;
  explorerPosition: "left" | "right";
  onClose: () => void;
  onFileSelect: (path: string, line?: number) => void;
}

const typeColors: Record<string, string> = {
  Routes: "#0088FF", // Brighter Blue
  Models: "#D946EF", // Brighter Purple/Magenta
  Views: "#00E676", // Brighter Green
  Controllers: "#FF6D00", // Brighter Orange
  Reference: "#607D8B", // Blue Grey
};

interface GraphNodeData {
  id: string;
  type: "root" | "group";
  label: string;
  x: MotionValue<number>;
  y: MotionValue<number>;
  items?: RelatedFile[]; // For group nodes
}

interface GraphLinkData {
  sourceId: string;
  targetId: string;
  type?: string;
}

// --- Components for the Graph ---

// A single draggable node (Card or Block)
const GraphNode = ({
  node,
  theme,
  isDark,
  onSelect,
}: {
  node: GraphNodeData;
  theme: any;
  isDark: boolean;
  onSelect?: (path: string) => void;
}) => {
  const isRoot = node.type === "root";

  let borderColor = theme.border;
  let headerColor = theme.bgPanel;
  let textColor = theme.text;

  if (isRoot) {
    borderColor = theme.textPrimary;
    headerColor = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)";
    textColor = theme.text;
  } else {
    // Group Block
    borderColor = typeColors[node.label] || theme.border;
    textColor = typeColors[node.label] || theme.text;
  }

  return (
    <motion.div
      drag
      dragMomentum={false}
      style={{
        x: node.x,
        y: node.y,
        position: "absolute",
        zIndex: isRoot ? 20 : 10,
        cursor: "grab",
      }}
      whileDrag={{ scale: 1.02, zIndex: 100, cursor: "grabbing" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: isRoot ? 180 : 250,
          maxWidth: isRoot ? 300 : 400,
          backgroundColor: theme.bgPanel,
          borderRadius: radius.md,
          boxShadow: shadows.lg,
          border: `1px solid ${borderColor}`,
          overflow: "hidden",
        }}
      >
        {/* Header / Grip Area */}
        <div
          style={{
            padding: "8px 12px",
            backgroundColor: isRoot
              ? isDark
                ? "rgba(255,255,255,0.15)"
                : "rgba(0,0,0,0.1)"
              : typeColors[node.label] + "15",
            borderBottom: `1px solid ${borderColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: isRoot ? "#fff" : typeColors[node.label] || theme.text,
            fontSize: "13px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          <span>{isRoot ? "Current File" : node.label}</span>
          <GripHorizontal size={18} style={{ opacity: 0.5 }} />
        </div>

        {/* Content */}
        {isRoot ? (
          <div
            style={{
              padding: "12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <FileCode size={20} color={theme.text} />
            <span style={{ fontWeight: 500, color: theme.text }}>
              {node.label}
            </span>
          </div>
        ) : (
          <div
            style={{
              maxHeight: 300,
              overflowY: "auto",
              padding: "4px 0",
              backgroundColor: theme.bgPanel,
            }}
          >
            {node.items?.map((item, idx) => (
              <div
                key={item.path + idx}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelect) onSelect(item.path);
                }}
                style={{
                  padding: "6px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: "13px",
                  color: theme.text,
                  borderLeft: `2px solid transparent`,
                  transition: "all 0.1s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme.bgHover;
                  e.currentTarget.style.borderLeftColor =
                    typeColors[node.label] || theme.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.borderLeftColor = "transparent";
                }}
              >
                <ChevronRight size={12} color={theme.textMuted} />
                <span
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.name}
                </span>
                {item.details && (
                  <span
                    style={{
                      fontSize: "10px",
                      color: theme.textMuted,
                      marginLeft: "auto",
                    }}
                  >
                    {item.details}
                  </span>
                )}
              </div>
            ))}
            {(!node.items || node.items.length === 0) && (
              <div
                style={{
                  padding: "12px",
                  color: theme.textMuted,
                  fontSize: "12px",
                  fontStyle: "italic",
                }}
              >
                No files
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

// A connection line (Bezier Curve)
const GraphLink = ({
  source,
  target,
  theme,
  type,
}: {
  source: GraphNodeData;
  target: GraphNodeData;
  theme: any;
  type?: string;
}) => {
  // Create a reactive path string from the motion values
  const pathD = useTransform(
    [source.x, source.y, target.x, target.y],
    ([sx, sy, tx, ty]: any[]) => {
      // Adjust start/end points to be roughly center of the nodes
      // Root is smaller, Groups are wider.
      const sourceWidth = source.type === "root" ? 180 : 250;
      const targetWidth = target.type === "root" ? 180 : 250;

      const startX = sx + sourceWidth / 2;
      const startY = sy + 20; // Top area
      const endX = tx + targetWidth / 2;
      const endY = ty + 20;

      const dist = Math.abs(endX - startX);
      const controlOffset = Math.max(dist * 0.4, 50);

      // Horizontal Bezier
      return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
    },
  );

  const color = type ? typeColors[type] || theme.textMuted : theme.textMuted;

  return (
    <motion.path
      d={pathD}
      stroke={color}
      strokeWidth="1.5"
      fill="none"
      strokeOpacity="0.3"
      style={{ pointerEvents: "none" }}
    />
  );
};

export const DependencyTree: React.FC<DependencyTreeProps> = ({
  isOpen,
  relations,
  currentFileName,
  onClose,
  onFileSelect,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // Graph State
  const [nodes, setNodes] = useState<GraphNodeData[]>([]);
  const [links, setLinks] = useState<GraphLinkData[]>([]);

  // Initialize Graph Data
  useEffect(() => {
    if (!isOpen) return;

    const newNodes: GraphNodeData[] = [];
    const newLinks: GraphLinkData[] = [];

    // 1. Root Node (Center)
    const rootId = "root";
    const rootX = new MotionValue(0);
    const rootY = new MotionValue(0);

    newNodes.push({
      id: rootId,
      type: "root",
      label: currentFileName,
      x: rootX,
      y: rootY,
    });

    // 2. Process Groups (Blocks)
    const RADIUS = 350;

    const zones: Record<string, number> = {
      Models: -90, // Top
      Views: 0, // Right
      Controllers: 180, // Left
      Routes: 180, // Left
      Reference: 90, // Bottom
    };

    relations.forEach((group) => {
      const groupId = `group-${group.type}`;

      // Determine Angle
      let angleDeg = zones[group.type] ?? 45;
      const angleRad = (angleDeg * Math.PI) / 180;

      // Group Position
      const gx = Math.cos(angleRad) * RADIUS;
      const gy = Math.sin(angleRad) * RADIUS;

      // Center offset adjustments to center the blocks visually
      const groupX = new MotionValue(gx - 125); // Half of width (250)
      const groupY = new MotionValue(gy - 100);

      newNodes.push({
        id: groupId,
        type: "group",
        label: group.type,
        x: groupX,
        y: groupY,
        items: group.items,
      });

      newLinks.push({ sourceId: rootId, targetId: groupId, type: group.type });
    });

    setNodes(newNodes);
    setLinks(newLinks);

    // Reset View
    setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setScale(0.9);
  }, [isOpen, relations, currentFileName]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.metaKey && e.key.toLowerCase() === "w")) {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: theme.bg,
        zIndex: 9999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          cursor: isPanning ? "grabbing" : "grab",
          backgroundImage: `radial-gradient(${theme.border} 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
          opacity: 0.5,
        }}
        onMouseDown={(e) => {
          setIsPanning(true);
        }}
        onMouseMove={(e) => {
          if (isPanning) {
            setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
          }
        }}
        onMouseUp={() => setIsPanning(false)}
        onMouseLeave={() => setIsPanning(false)}
      >
        {/* Transform Container */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: "0 0",
            width: 0,
            height: 0,
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          {/* Links Layer (SVG) */}
          <svg
            style={{
              position: "absolute",
              top: -10000,
              left: -10000,
              width: 20000,
              height: 20000,
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            <g transform="translate(10000, 10000)">
              {links.map((link, i) => {
                const source = nodes.find((n) => n.id === link.sourceId);
                const target = nodes.find((n) => n.id === link.targetId);
                if (!source || !target) return null;
                return (
                  <GraphLink
                    key={`${link.sourceId}-${link.targetId}`}
                    source={source}
                    target={target}
                    theme={theme}
                    type={link.type}
                  />
                );
              })}
            </g>
          </svg>

          {/* Nodes Layer */}
          {nodes.map((node) => (
            <GraphNode
              key={node.id}
              node={node}
              theme={theme}
              isDark={isDark}
              onSelect={(path) => {
                onFileSelect(path);
                onClose();
              }}
            />
          ))}
        </div>
      </div>

      {/* HUD / Controls */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          right: 32,
          display: "flex",
          gap: 8,
          zIndex: 50,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setScale((s) => Math.max(0.2, s - 0.1))}
          style={controlButtonStyle(theme)}
        >
          <ZoomOut size={20} />
        </button>
        <button
          onClick={() => {
            setScale(0.9);
            setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          }}
          style={controlButtonStyle(theme)}
        >
          <Maximize size={20} />
        </button>
        <button
          onClick={() => setScale((s) => Math.min(3, s + 0.1))}
          style={controlButtonStyle(theme)}
        >
          <ZoomIn size={20} />
        </button>
        <button
          onClick={onClose}
          style={{
            ...controlButtonStyle(theme),
            marginLeft: 16,
            borderColor: theme.border,
            color: theme.text,
          }}
        >
          <X size={20} />
        </button>
      </div>
    </motion.div>,
    document.body,
  );
};

const controlButtonStyle = (theme: any): React.CSSProperties => ({
  padding: "10px",
  backgroundColor: theme.bgPanel,
  border: `1px solid ${theme.border}`,
  borderRadius: radius.md,
  color: theme.text,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: shadows.md,
  transition: "transform 0.1s",
});
