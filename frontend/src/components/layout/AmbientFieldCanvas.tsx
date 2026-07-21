import React, { useEffect, useRef, useState } from "react";

import { useDiagnosticsStore } from "../../stores/diagnosticsStore";
import { usePerformanceStore } from "../../stores/performanceStore";

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_accent;
uniform vec3 u_alert;
uniform float u_alertLevel;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = uv * vec2(aspect, 1.0);
  float t = u_time * 0.03;

  float n = noise(p * 1.6 + vec2(t, -t * 0.7)) * 0.6
    + noise(p * 3.2 + vec2(-t * 1.3, t)) * 0.4;
  float field = smoothstep(0.25, 0.9, n);

  float alertNoise = noise(p * 5.0 + vec2(t * 4.0, -t * 3.0));
  vec3 color = u_accent * field + u_alert * alertNoise * u_alertLevel;
  float alpha = field * 0.5 + alertNoise * u_alertLevel * 0.3;

  float edge = smoothstep(1.15, 0.3, length(uv - vec2(0.5, 0.45)));
  outColor = vec4(color, alpha * edge);
}
`;

const readCssColor = (variableName: string): [number, number, number] => {
  if (typeof document === "undefined") {
    return [0, 0, 0];
  }
  const probe = document.createElement("span");
  probe.style.color = `var(${variableName})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const match = computed.match(/[\d.]+/g);
  if (!match || match.length < 3) {
    return [0, 0, 0];
  }
  return [
    Number(match[0]) / 255,
    Number(match[1]) / 255,
    Number(match[2]) / 255,
  ];
};

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

/**
 * Single full-window ambient field: one half-resolution WebGL2 canvas behind
 * the workspace. The field drifts slowly in the accent hue of the active
 * theme; diagnostics errors feed a subtle red turbulence so project health is
 * readable peripherally. Rendering pauses under pressure, when hidden, and
 * for reduced-motion. Falls back to a static CSS gradient without WebGL2.
 */
export const AmbientFieldCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const performanceMode = usePerformanceStore((state) => state.mode);
  const errors = useDiagnosticsStore((state) => state.projectSummary.errors);
  const warnings = useDiagnosticsStore(
    (state) => state.projectSummary.warnings,
  );
  const alertLevelRef = useRef(0);
  const modeRef = useRef(performanceMode);

  alertLevelRef.current = Math.min(1, errors / 12 + warnings / 40);
  modeRef.current = performanceMode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      setWebglUnavailable(true);
      return;
    }

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      setWebglUnavailable(true);
      return;
    }

    const vertexShader = compileShader(
      gl,
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
    );
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE,
    );
    const program = gl.createProgram();
    if (!vertexShader || !fragmentShader || !program) {
      setWebglUnavailable(true);
      return;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setWebglUnavailable(true);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      time: gl.getUniformLocation(program, "u_time"),
      accent: gl.getUniformLocation(program, "u_accent"),
      alert: gl.getUniformLocation(program, "u_alert"),
      alertLevel: gl.getUniformLocation(program, "u_alertLevel"),
    };

    let accentColor = readCssColor("--accent-brand");
    let alertColor = readCssColor("--status-error");

    const themeObserver = new MutationObserver(() => {
      accentColor = readCssColor("--accent-brand");
      alertColor = readCssColor("--status-error");
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      canvas.width = Math.max(1, Math.floor(window.innerWidth * scale));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * scale));
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(document.body);

    let rafId = 0;
    let frame = 0;
    const start = performance.now();

    const renderLoop = () => {
      rafId = window.requestAnimationFrame(renderLoop);
      frame += 1;
      // 30fps cap: skip every other frame.
      if (frame % 2 !== 0) {
        return;
      }
      if (document.hidden || modeRef.current === "critical") {
        return;
      }
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, (performance.now() - start) / 1000);
      gl.uniform3f(uniforms.accent, ...accentColor);
      gl.uniform3f(uniforms.alert, ...alertColor);
      gl.uniform1f(uniforms.alertLevel, alertLevelRef.current * 0.6);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    rafId = window.requestAnimationFrame(renderLoop);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setWebglUnavailable(true);
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);

    return () => {
      window.cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, []);

  if (webglUnavailable) {
    return <div className="ambient-field-fallback" aria-hidden="true" />;
  }

  return (
    <canvas
      ref={canvasRef}
      className="ambient-field-canvas"
      aria-hidden="true"
    />
  );
};
