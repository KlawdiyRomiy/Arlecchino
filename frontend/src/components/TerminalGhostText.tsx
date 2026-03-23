import React from 'react';
import ReactDOM from 'react-dom';

interface TerminalGhostTextProps {
  ghostText: string;
  cursorX: number;
  cursorY: number;
  cellWidth: number;
  cellHeight: number;
  fontSize: number;
  fontFamily: string;
  isDark: boolean;
  targetElement: HTMLElement | null;
}

export const TerminalGhostText: React.FC<TerminalGhostTextProps> = ({
  ghostText,
  cursorX,
  cursorY,
  cellWidth,
  cellHeight,
  fontSize,
  fontFamily,
  isDark,
  targetElement,
}) => {
  if (!ghostText || !targetElement) {
    return null;
  }

  const left = cursorX * cellWidth;
  const top = cursorY * cellHeight;

  const ghostStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    height: `${cellHeight}px`,
    lineHeight: `${cellHeight}px`,
    color: isDark ? '#9ca3af' : '#6b7280',
    backgroundColor: 'transparent',
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight: 'normal',
    letterSpacing: '0px',
    padding: '0',
    margin: '0',
    pointerEvents: 'none',
    zIndex: 10,
    whiteSpace: 'pre',
    opacity: 0.65,
    userSelect: 'none',
  };

  return ReactDOM.createPortal(
    <div style={ghostStyle} id="terminal-ghost-text">
      {ghostText}
      <span style={{ 
        marginLeft: '4px', 
        fontSize: '9px', 
        opacity: 0.5,
        color: '#888',
      }}>
        ⇥
      </span>
    </div>,
    targetElement
  );
};
