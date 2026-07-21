import React, { useCallback, useEffect, useRef, useState } from "react";
import { useViewport, type Edge, type Node } from "@xyflow/react";
import type { DepEdgeData, FileCardData } from "../hooks/useDependencyGraph";

// World-space geometry mirrors the layout constants in useDependencyGraph.
const NODE_W = 240;
const HEADER_H = 36;
const SYM_ROW = 22;
const MAX_SYMBOLS = 15;

const NODE_ALPHA = 0.1;
const ROOT_ALPHA = 0.18;
const EDGE_ALPHA_START = 0.5;
const EDGE_ALPHA_END = 0.3;
const GLOW_PX = 18;
const CORNER_RADIUS = 8;
const MAX_DPR = 2;

const nodeHeight = (symbolCount: number) =>
  HEADER_H + Math.min(symbolCount, MAX_SYMBOLS) * SYM_ROW;

// Clip-space transform matches React Flow: screen = world * zoom + translate.
const EDGE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_world;
layout(location = 1) in vec4 a_color;
uniform vec2 u_translate;
uniform float u_zoom;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 screen = a_world * u_zoom + u_translate;
  vec2 clip = vec2(
    screen.x / u_resolution.x * 2.0 - 1.0,
    1.0 - screen.y / u_resolution.y * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
}
`;

const EDGE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
}
`;

const NODE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec4 a_node;
layout(location = 1) in vec4 a_fill;
uniform vec2 u_translate;
uniform float u_zoom;
uniform vec2 u_resolution;
uniform float u_glow;
out vec4 v_node;
out vec4 v_fill;
out vec2 v_world;
const vec2 CORNERS[6] = vec2[6](
  vec2(0.0, 0.0),
  vec2(1.0, 0.0),
  vec2(1.0, 1.0),
  vec2(0.0, 0.0),
  vec2(1.0, 1.0),
  vec2(0.0, 1.0)
);
void main() {
  // Expand the quad by the glow radius so the SDF falloff has room to fade.
  vec2 corner = CORNERS[gl_VertexID];
  vec2 origin = a_node.xy - u_glow;
  vec2 size = a_node.zw + u_glow * 2.0;
  vec2 world = origin + corner * size;
  vec2 screen = world * u_zoom + u_translate;
  vec2 clip = vec2(
    screen.x / u_resolution.x * 2.0 - 1.0,
    1.0 - screen.y / u_resolution.y * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_node = a_node;
  v_fill = a_fill;
  v_world = world;
}
`;

const NODE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_node;
in vec4 v_fill;
in vec2 v_world;
uniform float u_glow;
uniform float u_radius;
out vec4 outColor;
void main() {
  // Signed distance to the rounded node rect, negative inside.
  vec2 halfSize = v_node.zw * 0.5;
  vec2 p = v_world - (v_node.xy + halfSize);
  float radius = min(u_radius, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - (halfSize - vec2(radius));
  float dist = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
  float alpha = 1.0 - smoothstep(0.0, u_glow, max(dist, 0.0));
  if (alpha <= 0.001) discard;
  outColor = vec4(v_fill.rgb, v_fill.a * alpha);
}
`;

const FALLBACK_RGB: [number, number, number] = [0.5, 0.5, 1];

// Resolve --accent-brand through a probe so color-mix() flattens to rgb().
const readAccentRgb = (): [number, number, number] => {
  const probe = document.createElement("span");
  probe.style.color = "var(--accent-brand)";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const match = resolved.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/,
  );
  if (!match) return FALLBACK_RGB;
  return [
    Number(match[1]) / 255,
    Number(match[2]) / 255,
    Number(match[3]) / 255,
  ];
};

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(
      "[DependencyGraphCanvas] shader compile failed:",
      gl.getShaderInfoLog(shader),
    );
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(
      "[DependencyGraphCanvas] program link failed:",
      gl.getProgramInfoLog(program),
    );
    gl.deleteProgram(program);
    return null;
  }
  return program;
};

interface EdgeUniforms {
  translate: WebGLUniformLocation | null;
  zoom: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
}

interface NodeUniforms extends EdgeUniforms {
  glow: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
}

interface GlState {
  gl: WebGL2RenderingContext;
  edgeProgram: WebGLProgram;
  nodeProgram: WebGLProgram;
  edgeVao: WebGLVertexArrayObject;
  nodeVao: WebGLVertexArrayObject;
  edgeBuffer: WebGLBuffer;
  nodeBuffer: WebGLBuffer;
  edgeUniforms: EdgeUniforms;
  nodeUniforms: NodeUniforms;
  edgeVertexCount: number;
  nodeInstanceCount: number;
}

interface DependencyGraphCanvasProps {
  nodes: Node<FileCardData>[];
  edges: Edge<DepEdgeData>[];
}

export const DependencyGraphCanvas: React.FC<DependencyGraphCanvasProps> = ({
  nodes,
  edges,
}) => {
  const viewport = useViewport();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<GlState | null>(null);
  const viewportRef = useRef(viewport);
  const [glStatus, setGlStatus] = useState<"pending" | "ready" | "unavailable">(
    "pending",
  );
  const [themeTick, setThemeTick] = useState(0);

  // WebGL2 setup; on failure the DOM/SVG graph remains the full experience.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setGlStatus("unavailable");
      return;
    }
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) {
      setGlStatus("unavailable");
      return;
    }

    const edgeProgram = createProgram(
      gl,
      EDGE_VERTEX_SHADER,
      EDGE_FRAGMENT_SHADER,
    );
    const nodeProgram = createProgram(
      gl,
      NODE_VERTEX_SHADER,
      NODE_FRAGMENT_SHADER,
    );
    const edgeVao = gl.createVertexArray();
    const nodeVao = gl.createVertexArray();
    const edgeBuffer = gl.createBuffer();
    const nodeBuffer = gl.createBuffer();
    if (
      !edgeProgram ||
      !nodeProgram ||
      !edgeVao ||
      !nodeVao ||
      !edgeBuffer ||
      !nodeBuffer
    ) {
      if (edgeProgram) gl.deleteProgram(edgeProgram);
      if (nodeProgram) gl.deleteProgram(nodeProgram);
      if (edgeVao) gl.deleteVertexArray(edgeVao);
      if (nodeVao) gl.deleteVertexArray(nodeVao);
      if (edgeBuffer) gl.deleteBuffer(edgeBuffer);
      if (nodeBuffer) gl.deleteBuffer(nodeBuffer);
      setGlStatus("unavailable");
      return;
    }

    // Edge vertices: vec2 world position + vec4 color.
    gl.bindVertexArray(edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

    // Node instances: vec4 world rect + vec4 fill color.
    gl.bindVertexArray(nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    glRef.current = {
      gl,
      edgeProgram,
      nodeProgram,
      edgeVao,
      nodeVao,
      edgeBuffer,
      nodeBuffer,
      edgeUniforms: {
        translate: gl.getUniformLocation(edgeProgram, "u_translate"),
        zoom: gl.getUniformLocation(edgeProgram, "u_zoom"),
        resolution: gl.getUniformLocation(edgeProgram, "u_resolution"),
      },
      nodeUniforms: {
        translate: gl.getUniformLocation(nodeProgram, "u_translate"),
        zoom: gl.getUniformLocation(nodeProgram, "u_zoom"),
        resolution: gl.getUniformLocation(nodeProgram, "u_resolution"),
        glow: gl.getUniformLocation(nodeProgram, "u_glow"),
        radius: gl.getUniformLocation(nodeProgram, "u_radius"),
      },
      edgeVertexCount: 0,
      nodeInstanceCount: 0,
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      glRef.current = null;
      setGlStatus("unavailable");
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    setGlStatus("ready");

    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      const state = glRef.current;
      glRef.current = null;
      if (!state) return;
      state.gl.deleteVertexArray(state.edgeVao);
      state.gl.deleteVertexArray(state.nodeVao);
      state.gl.deleteBuffer(state.edgeBuffer);
      state.gl.deleteBuffer(state.nodeBuffer);
      state.gl.deleteProgram(state.edgeProgram);
      state.gl.deleteProgram(state.nodeProgram);
    };
  }, []);

  const rebuildBuffers = useCallback(
    (nextNodes: Node<FileCardData>[], nextEdges: Edge<DepEdgeData>[]) => {
      const state = glRef.current;
      if (!state) return;
      const { gl } = state;
      const [r, g, b] = readAccentRgb();

      const byId = new Map<string, Node<FileCardData>>();
      for (const node of nextNodes) byId.set(node.id, node);

      const edgeData: number[] = [];
      for (const edge of nextEdges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        const sourceH = nodeHeight(source.data.symbols.length);
        const targetH = nodeHeight(target.data.symbols.length);
        // Source right-center -> target left-center.
        edgeData.push(
          source.position.x + NODE_W,
          source.position.y + sourceH / 2,
          r,
          g,
          b,
          EDGE_ALPHA_START,
          target.position.x,
          target.position.y + targetH / 2,
          r,
          g,
          b,
          EDGE_ALPHA_END,
        );
      }

      const nodeData: number[] = [];
      for (const node of nextNodes) {
        nodeData.push(
          node.position.x,
          node.position.y,
          NODE_W,
          nodeHeight(node.data.symbols.length),
          r,
          g,
          b,
          node.data.isRoot ? ROOT_ALPHA : NODE_ALPHA,
        );
      }

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.edgeBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(edgeData),
        gl.STATIC_DRAW,
      );
      state.edgeVertexCount = edgeData.length / 6;
      gl.bindBuffer(gl.ARRAY_BUFFER, state.nodeBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(nodeData),
        gl.STATIC_DRAW,
      );
      state.nodeInstanceCount = nextNodes.length;
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    [],
  );

  useEffect(() => {
    if (glStatus !== "ready") return;
    rebuildBuffers(nodes, edges);
  }, [nodes, edges, themeTick, glStatus, rebuildBuffers]);

  const drawFrame = useCallback(() => {
    const state = glRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas || document.hidden) return;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0 || canvas.width === 0) return;

    const { gl } = state;
    const { x, y, zoom } = viewportRef.current;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (state.edgeVertexCount > 0) {
      gl.useProgram(state.edgeProgram);
      gl.uniform2f(state.edgeUniforms.translate, x, y);
      gl.uniform1f(state.edgeUniforms.zoom, zoom);
      gl.uniform2f(state.edgeUniforms.resolution, cssWidth, cssHeight);
      gl.bindVertexArray(state.edgeVao);
      gl.drawArrays(gl.LINES, 0, state.edgeVertexCount);
    }

    if (state.nodeInstanceCount > 0) {
      gl.useProgram(state.nodeProgram);
      gl.uniform2f(state.nodeUniforms.translate, x, y);
      gl.uniform1f(state.nodeUniforms.zoom, zoom);
      gl.uniform2f(state.nodeUniforms.resolution, cssWidth, cssHeight);
      // Glow width stays constant on screen: world units = css px / zoom.
      gl.uniform1f(state.nodeUniforms.glow, GLOW_PX / zoom);
      gl.uniform1f(state.nodeUniforms.radius, CORNER_RADIUS);
      gl.bindVertexArray(state.nodeVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, state.nodeInstanceCount);
    }
    gl.bindVertexArray(null);
  }, []);

  // Render-on-demand: redraw after every commit that changes inputs.
  useEffect(() => {
    viewportRef.current = viewport;
    drawFrame();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      drawFrame();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [drawFrame]);

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setThemeTick((tick) => tick + 1),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) drawFrame();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [drawFrame]);

  if (glStatus === "unavailable") return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        // Above Background dots (z-index: -1), below the node/edge renderer
        // (z-index: 4) so DOM nodes stay visible and interactive.
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
};
