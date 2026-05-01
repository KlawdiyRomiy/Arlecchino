import React, { useRef } from "react";
import { useTransition, animated } from "@react-spring/web";
import { useIndexingPhase } from "../../hooks/useIndexingProgress";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useProjectDiagnosticsPreload } from "../../utils/projectBoundState";

interface Props {
  layoutKey: string;
  direction: number;
  lightweight?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const ProjectSwitchTransition: React.FC<Props> = ({
  layoutKey,
  direction,
  lightweight = false,
  fallback = null,
  children,
}) => {
  const childrenMap = useRef<Record<string, React.ReactNode>>({});
  if (lightweight) {
    childrenMap.current = {};
    childrenMap.current[layoutKey] = fallback;
  } else {
    childrenMap.current = { [layoutKey]: children };
  }
  const indexingPhase = useIndexingPhase();
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const switchPending = useWorkspaceStore((state) => state.pendingId !== null);
  const reduceMotion =
    !switchPending &&
    (indexingPhase === "indexing" || diagnosticsPreload.active);

  const dirRef = useRef(direction);
  dirRef.current = direction;

  const transitions = useTransition(layoutKey, {
    keys: (item) => item,
    initial: null,
    from: () => ({
      x: dirRef.current === 0 ? 0 : dirRef.current > 0 ? 100 : -100,
    }),
    enter: () => ({
      x: 0,
    }),
    leave: () => ({
      x: dirRef.current === 0 ? 0 : dirRef.current > 0 ? -100 : 100,
    }),
    config: {
      tension: 250,
      friction: 35,
      clamp: true,
    },
    immediate: reduceMotion,
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        contain: "layout paint style",
        clipPath: "inset(0)",
        backgroundColor: "var(--bg-blackprint, #0a0a0a)",
        overscrollBehavior: "none",
      }}
    >
      {transitions((style, item) => {
        const renderedChildren = lightweight
          ? fallback
          : (childrenMap.current[item] ?? fallback);
        const { x, ...restStyle } = style;

        return (
          <animated.div
            key={item}
            style={{
              ...restStyle,
              transform: x.to((v) => `translate3d(${v}%, 0, 0)`),
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              contain: "layout paint style",
              willChange: "transform",
              backgroundColor: "var(--bg-blackprint, #0a0a0a)",
              zIndex: 1,
              boxShadow: "none",
              overflow: "hidden",
              backfaceVisibility: "hidden",
              WebkitTransformStyle: "preserve-3d",
              overscrollBehavior: "none",
            }}
          >
            {renderedChildren}
          </animated.div>
        );
      })}
    </div>
  );
};
