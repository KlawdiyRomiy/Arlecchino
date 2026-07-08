import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTransition, animated } from "@react-spring/web";
import { useIndexingPhase } from "../../hooks/useIndexingProgress";
import { beginInteractiveSurfaceMotionWindow } from "../../stores/performanceStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useProjectDiagnosticsPreload } from "../../utils/projectBoundState";

interface Props {
  layoutKey: string;
  direction: number;
  children: React.ReactNode;
}

interface ProjectSwitchFrameMotion {
  active: boolean;
  moving: boolean;
}

const defaultProjectSwitchFrameMotion: ProjectSwitchFrameMotion = {
  active: true,
  moving: false,
};

const ProjectSwitchFrameMotionContext = createContext<ProjectSwitchFrameMotion>(
  defaultProjectSwitchFrameMotion,
);

const PROJECT_SWITCH_MOTION_HOLD_MS = 420;

export const useProjectSwitchFrameMotion = (): ProjectSwitchFrameMotion =>
  useContext(ProjectSwitchFrameMotionContext);

export const ProjectSwitchTransition: React.FC<Props> = ({
  layoutKey,
  direction,
  children,
}) => {
  const childrenMap = useRef<Record<string, React.ReactNode>>({});
  childrenMap.current[layoutKey] = children;
  const indexingPhase = useIndexingPhase();
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const switchPending = useWorkspaceStore((state) => state.pendingId !== null);

  const dirRef = useRef(direction);
  dirRef.current = direction;
  const lastLayoutKeyRef = useRef(layoutKey);
  const layoutKeyChanged = lastLayoutKeyRef.current !== layoutKey;
  const activeMotionItemsRef = useRef<Set<string>>(new Set());
  const [activeMotionItems, setActiveMotionItems] = useState<
    Record<string, true>
  >({});
  const [motionHoldActive, setMotionHoldActive] = useState(false);
  const switchMotionActive =
    layoutKeyChanged ||
    motionHoldActive ||
    switchPending ||
    Object.keys(activeMotionItems).length > 0;
  const reduceMotion =
    !switchMotionActive &&
    (indexingPhase === "indexing" || diagnosticsPreload.active);

  useLayoutEffect(() => {
    lastLayoutKeyRef.current = layoutKey;
    if (direction === 0) {
      return;
    }

    setMotionHoldActive(true);
    beginInteractiveSurfaceMotionWindow(PROJECT_SWITCH_MOTION_HOLD_MS);
    const timer = window.setTimeout(() => {
      setMotionHoldActive(false);
    }, PROJECT_SWITCH_MOTION_HOLD_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [direction, layoutKey]);

  const setItemMotion = useCallback((item: string, moving: boolean) => {
    const next = new Set(activeMotionItemsRef.current);
    if (moving) {
      next.add(item);
    } else {
      next.delete(item);
    }

    activeMotionItemsRef.current = next;
    setActiveMotionItems(
      Array.from(next).reduce<Record<string, true>>((acc, key) => {
        acc[key] = true;
        return acc;
      }, {}),
    );
  }, []);

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
      tension: 340,
      friction: 38,
      clamp: true,
    },
    immediate: reduceMotion,
    onStart: (_result, _ctrl, item) => {
      if (item && !reduceMotion && direction !== 0) {
        setItemMotion(item, true);
      }
    },
    onRest: (_result, _ctrl, item) => {
      if (item) {
        setItemMotion(item, false);
      }
    },
    onDestroyed: (item) => {
      setItemMotion(item, false);
      delete childrenMap.current[item];
    },
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
        backgroundColor: "transparent",
        overscrollBehavior: "none",
      }}
    >
      {transitions((style, item) => {
        const renderedChildren = childrenMap.current[item] ?? null;
        const { x, ...restStyle } = style;
        const frameMoving =
          !reduceMotion &&
          direction !== 0 &&
          (Boolean(activeMotionItems[item]) ||
            (switchPending && item !== layoutKey));
        const frameMotion = {
          active: item === layoutKey,
          moving: frameMoving,
        };

        return (
          <animated.div
            key={item}
            data-project-switch-frame="true"
            data-project-switch-frame-moving={frameMoving ? "true" : "false"}
            data-project-switch-frame-active={
              frameMotion.active ? "true" : "false"
            }
            style={{
              ...restStyle,
              transform: x.to((v) => `translate3d(${v}%, 0, 0)`),
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              contain: "layout paint style",
              willChange: "transform",
              backgroundColor: "transparent",
              zIndex: 1,
              boxShadow: "none",
              overflow: "hidden",
              backfaceVisibility: "hidden",
              WebkitTransformStyle: "preserve-3d",
              overscrollBehavior: "none",
            }}
          >
            <ProjectSwitchFrameMotionContext.Provider value={frameMotion}>
              {renderedChildren}
            </ProjectSwitchFrameMotionContext.Provider>
          </animated.div>
        );
      })}
    </div>
  );
};
