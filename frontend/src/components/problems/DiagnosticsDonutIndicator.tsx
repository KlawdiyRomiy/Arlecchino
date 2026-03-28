import React, { useMemo } from "react";

import {
  useDiagnosticsStore,
  type DiagnosticsSummary,
} from "../../stores/diagnosticsStore";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";

interface DiagnosticsDonutIndicatorProps {
  filePath: string;
  fileName: string;
  rightOffset?: number;
  onClick?: () => void;
}

interface DiagnosticsDonutSegment {
  color: string;
  ratio: number;
}

const SIZE = 28;
const RADIUS = SIZE / 2 - 1;
const EMPTY_SUMMARY: DiagnosticsSummary = {
  errors: 0,
  warnings: 0,
  infos: 0,
  total: 0,
};

const START_ANGLE = -Math.PI / 2;
const GREEN = "#22C55E";
const YELLOW = "#F59E0B";
const RED = "#EF4444";

const polarToCartesian = (radius: number, angle: number) => ({
  x: SIZE / 2 + radius * Math.cos(angle),
  y: SIZE / 2 + radius * Math.sin(angle),
});

const describeSector = (startAngle: number, endAngle: number) => {
  const start = polarToCartesian(RADIUS, startAngle);
  const end = polarToCartesian(RADIUS, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${SIZE / 2} ${SIZE / 2}`,
    `L ${start.x} ${start.y}`,
    `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
};

export const buildDiagnosticsDonutSegments = (
  summary: DiagnosticsSummary,
): DiagnosticsDonutSegment[] => {
  if (summary.total === 0) {
    return [{ color: GREEN, ratio: 1 }];
  }

  const warningUnits = summary.warnings + summary.infos;
  const errorUnits = summary.errors;
  const totalUnits = 1 + warningUnits + errorUnits;

  const segments: DiagnosticsDonutSegment[] = [
    { color: GREEN, ratio: 1 / totalUnits },
  ];

  if (warningUnits > 0) {
    segments.push({ color: YELLOW, ratio: warningUnits / totalUnits });
  }

  if (errorUnits > 0) {
    segments.push({ color: RED, ratio: errorUnits / totalUnits });
  }

  return segments;
};

export const DiagnosticsDonutIndicator: React.FC<
  DiagnosticsDonutIndicatorProps
> = ({ filePath, fileName, rightOffset = 12, onClick }) => {
  const showDiagnosticsDonut = useEditorSettingsStore(
    (state) => state.showDiagnosticsDonut,
  );
  const summary = useDiagnosticsStore(
    (state) => state.byFile.get(filePath)?.summary ?? EMPTY_SUMMARY,
  );

  const segments = useMemo(() => {
    if (!showDiagnosticsDonut) {
      return [];
    }

    const values = buildDiagnosticsDonutSegments(summary);

    let currentAngle = START_ANGLE;
    return values.map((segment) => {
      const nextAngle = currentAngle + segment.ratio * Math.PI * 2;
      const next = {
        ...segment,
        startAngle: currentAngle,
        endAngle: nextAngle,
      };
      currentAngle = nextAngle;
      return next;
    });
  }, [
    showDiagnosticsDonut,
    summary.errors,
    summary.infos,
    summary.total,
    summary.warnings,
  ]);

  const ariaLabel = `${fileName}: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.infos} info`;

  if (!showDiagnosticsDonut) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="diagnostics-donut-indicator"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className="absolute top-3 z-10 border border-transparent bg-transparent p-0 shadow-none transition-transform hover:scale-105"
      style={{ right: rightOffset }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {segments.map((segment) =>
          segment.ratio >= 0.999 ? (
            <circle
              key={`${segment.color}:full`}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill={segment.color}
            />
          ) : (
            <path
              key={`${segment.color}:${segment.startAngle}`}
              d={describeSector(segment.startAngle, segment.endAngle)}
              fill={segment.color}
            />
          ),
        )}
      </svg>
    </button>
  );
};
