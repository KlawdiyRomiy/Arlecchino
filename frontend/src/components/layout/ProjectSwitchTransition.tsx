import React, { useRef } from "react";
import { useTransition, animated } from "@react-spring/web";

interface Props {
  layoutKey: string;
  direction: number;
  children: React.ReactNode;
}

export const ProjectSwitchTransition: React.FC<Props> = ({
  layoutKey,
  direction,
  children,
}) => {
  const childrenMap = useRef<Record<string, React.ReactNode>>({});
  childrenMap.current[layoutKey] = children;

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
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        contain: "strict",
        clipPath: "inset(0)",
        backgroundColor: "var(--bg-blackprint, #0a0a0a)",
        overscrollBehavior: "none",
      }}
    >
      {transitions((style, item) => {
        const renderedChildren = childrenMap.current[item];
        const isCurrent = item === layoutKey;
        const { x, ...restStyle } = style;

        return (
          <animated.div
            key={item}
            style={{
              ...restStyle,
              transform: x.to((v) => `translate3d(${v}vw, 0, 0)`),
              position: "fixed",
              inset: 0,
              width: "100vw",
              height: "100vh",
              contain: "strict",
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
