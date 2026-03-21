import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { colors, getThemeColors, radius, shadows, transitions, zIndex } from '../../styles/colors';
import { useTheme } from '../../hooks/useTheme';

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ResizablePanelProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  position: 'left' | 'right' | 'bottom';
  defaultSize: number;
  minSize?: number;
  maxSize?: number;
  onClose?: () => void;
  onResize?: (size: number) => void;
  headerExtra?: React.ReactNode;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  id,
  title,
  icon,
  children,
  position,
  defaultSize,
  minSize = 200,
  maxSize = 800,
  onClose,
  onResize,
  headerExtra,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const [size, setSize] = useState(defaultSize);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef({ x: 0, y: 0, size: 0 });

  const handleResizeStart = useCallback((e: React.MouseEvent, direction: ResizeDirection) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      size: size,
    };
  }, [size]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeDirection) return;

    let delta = 0;
    
    if (position === 'left') {
      if (resizeDirection.includes('e')) {
        delta = e.clientX - startPosRef.current.x;
      }
    } else if (position === 'right') {
      if (resizeDirection.includes('w')) {
        delta = startPosRef.current.x - e.clientX;
      }
    } else if (position === 'bottom') {
      if (resizeDirection.includes('n')) {
        delta = startPosRef.current.y - e.clientY;
      }
    }

    const newSize = Math.max(minSize, Math.min(maxSize, startPosRef.current.size + delta));
    setSize(newSize);
    onResize?.(newSize);
  }, [isResizing, resizeDirection, position, minSize, maxSize, onResize]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = position === 'bottom' ? 'ns-resize' : 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleResizeMove, handleResizeEnd, position]);

  const getContainerStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: isDark ? colors.dark.bgPanel : colors.light.bg,
      border: `1px solid ${theme.border}`,
      borderRadius: radius.lg,
      boxShadow: isDark 
        ? '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)'
        : '0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08)',
      zIndex: zIndex.floatingPanel,
      overflow: 'hidden',
    };

    switch (position) {
      case 'left':
        return {
          ...base,
          left: 8,
          top: 8,
          bottom: 8,
          width: size,
        };
      case 'right':
        return {
          ...base,
          right: 8,
          top: 8,
          bottom: 8,
          width: size,
        };
      case 'bottom':
        return {
          ...base,
          left: 8,
          right: 8,
          bottom: 8,
          height: size,
        };
    }
  };

  const getResizeHandles = () => {
    const handleBase: React.CSSProperties = {
      position: 'absolute',
      zIndex: 10,
    };

    const edgeHandle: React.CSSProperties = {
      ...handleBase,
      backgroundColor: 'transparent',
    };

    const cornerHandle: React.CSSProperties = {
      ...handleBase,
      width: '12px',
      height: '12px',
      backgroundColor: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)",
      borderRadius: '2px',
      opacity: 0,
      transition: `opacity ${transitions.fast}`,
    };

    const handles: React.ReactNode[] = [];

    if (position === 'left') {
      handles.push(
        <div
          key="e"
          style={{ ...edgeHandle, right: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize' }}
          onMouseDown={(e) => handleResizeStart(e, 'e')}
        />,
        <div
          key="ne"
          style={{ ...cornerHandle, right: '-4px', top: '-4px', cursor: 'nesw-resize' }}
          className="resize-corner"
          onMouseDown={(e) => handleResizeStart(e, 'ne')}
        />,
        <div
          key="se"
          style={{ ...cornerHandle, right: '-4px', bottom: '-4px', cursor: 'nwse-resize' }}
          className="resize-corner"
          onMouseDown={(e) => handleResizeStart(e, 'se')}
        />
      );
    } else if (position === 'right') {
      handles.push(
        <div
          key="w"
          style={{ ...edgeHandle, left: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize' }}
          onMouseDown={(e) => handleResizeStart(e, 'w')}
        />,
        <div
          key="nw"
          style={{ ...cornerHandle, left: '-4px', top: '-4px', cursor: 'nwse-resize' }}
          className="resize-corner"
          onMouseDown={(e) => handleResizeStart(e, 'nw')}
        />,
        <div
          key="sw"
          style={{ ...cornerHandle, left: '-4px', bottom: '-4px', cursor: 'nesw-resize' }}
          className="resize-corner"
          onMouseDown={(e) => handleResizeStart(e, 'sw')}
        />
      );
    } else if (position === 'bottom') {
      handles.push(
        <div
          key="n"
          style={{ ...edgeHandle, left: 0, right: 0, top: 0, height: '6px', cursor: 'ns-resize' }}
          onMouseDown={(e) => handleResizeStart(e, 'n')}
        />,
        <div
          key="nw"
          style={{ ...cornerHandle, left: '-4px', top: '-4px', cursor: 'nwse-resize' }}
          className="resize-corner"
          onMouseDown={(e) => handleResizeStart(e, 'nw')}
        />,
        <div
          key="ne"
          style={{ ...cornerHandle, right: '-4px', top: '-4px', cursor: 'nesw-resize' }}
          className="resize-corner"
          onMouseDown={(e) => handleResizeStart(e, 'ne')}
        />
      );
    }

    return handles;
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    borderBottom: `1px solid ${theme.border}`,
    userSelect: 'none',
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: 600,
    color: theme.text,
  };

  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };

  const closeButtonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.textMuted,
    cursor: 'pointer',
    transition: `all ${transitions.fast}`,
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
  };

  return (
    <div
      ref={panelRef}
      style={getContainerStyle()}
      className="resizable-panel"
    >
      {getResizeHandles()}
      
      <div style={headerStyle}>
        <div style={titleStyle}>
          {icon}
          <span>{title}</span>
        </div>
        
        <div style={controlsStyle}>
          {headerExtra}
          
          {onClose && (
            <button
              style={closeButtonStyle}
              onClick={onClose}
              title="Close panel"
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';
                e.currentTarget.style.color = theme.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = theme.textMuted;
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      
      <div style={contentStyle}>
        {children}
      </div>

      <style>{`
        .resizable-panel:hover .resize-corner {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
};

export default ResizablePanel;
