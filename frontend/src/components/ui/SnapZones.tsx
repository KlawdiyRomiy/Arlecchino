import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, radius, transitions } from '../../styles/colors';
import { useTheme } from '../../hooks/useTheme';

export type SnapZoneId = 
  | 'left' | 'right' | 'top' | 'bottom'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface SnapZoneConfig {
  id: SnapZoneId;
  style: React.CSSProperties;
  label: string;
}

interface SnapZonesOverlayProps {
  isActive: boolean;
  activeZone: SnapZoneId | null;
  onZoneHover: (zone: SnapZoneId | null) => void;
}

const snapZoneConfigs: SnapZoneConfig[] = [
  {
    id: 'left',
    style: {
      left: 0,
      top: '20%',
      width: '80px',
      height: '60%',
    },
    label: 'Left Panel',
  },
  {
    id: 'right',
    style: {
      right: 0,
      top: '20%',
      width: '80px',
      height: '60%',
    },
    label: 'Right Panel',
  },
  {
    id: 'top',
    style: {
      left: '20%',
      top: 0,
      width: '60%',
      height: '60px',
    },
    label: 'Top Panel',
  },
  {
    id: 'bottom',
    style: {
      left: '20%',
      bottom: 0,
      width: '60%',
      height: '80px',
    },
    label: 'Bottom Panel',
  },
  {
    id: 'top-left',
    style: {
      left: 0,
      top: 0,
      width: '120px',
      height: '120px',
    },
    label: 'Top Left',
  },
  {
    id: 'top-right',
    style: {
      right: 0,
      top: 0,
      width: '120px',
      height: '120px',
    },
    label: 'Top Right',
  },
  {
    id: 'bottom-left',
    style: {
      left: 0,
      bottom: 0,
      width: '120px',
      height: '120px',
    },
    label: 'Bottom Left',
  },
  {
    id: 'bottom-right',
    style: {
      right: 0,
      bottom: 0,
      width: '120px',
      height: '120px',
    },
    label: 'Bottom Right',
  },
];

export const SnapZonesOverlay: React.FC<SnapZonesOverlayProps> = ({
  isActive,
  activeZone,
  onZoneHover,
}) => {
  const { isDark } = useTheme();

  const getZoneStyle = (config: SnapZoneConfig, isHovered: boolean): React.CSSProperties => ({
    position: 'absolute',
    ...config.style,
    backgroundColor: isHovered 
      ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
      : isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    border: `2px dashed ${isHovered ? (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)') : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')}`,
    borderRadius: radius.lg,
    transition: `all ${transitions.fast}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
  });

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 500,
    color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 999,
          }}
        >
          {snapZoneConfigs.map((config) => (
            <motion.div
              key={config.id}
              style={getZoneStyle(config, activeZone === config.id)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ 
                opacity: 1, 
                scale: activeZone === config.id ? 1.02 : 1,
                boxShadow: activeZone === config.id ? `0 0 30px ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}` : 'none',
              }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              onMouseEnter={() => onZoneHover(config.id)}
              onMouseLeave={() => onZoneHover(null)}
            >
              <span style={labelStyle}>{config.label}</span>
            </motion.div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface PanelLayoutManagerProps {
  children: React.ReactNode;
}

interface PanelState {
  id: string;
  snapZone: SnapZoneId | 'floating';
  position: { x: number; y: number };
  size: { width: number; height: number };
  isVisible: boolean;
  order: number;
}

export const PanelLayoutManager: React.FC<PanelLayoutManagerProps> = ({ children }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [activeSnapZone, setActiveSnapZone] = useState<SnapZoneId | null>(null);
  const [panels, setPanels] = useState<Map<string, PanelState>>(new Map());

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setActiveSnapZone(null);
  }, []);

  const handleZoneHover = useCallback((zone: SnapZoneId | null) => {
    setActiveSnapZone(zone);
  }, []);

  useEffect(() => {
    // Only react to custom panel drag events to avoid activating on random drags (text/images)
    const handlePanelDragStart = () => handleDragStart();
    const handlePanelDragEnd = () => handleDragEnd();

    window.addEventListener('panel-drag-start', handlePanelDragStart);
    window.addEventListener('panel-drag-end', handlePanelDragEnd);

    return () => {
      window.removeEventListener('panel-drag-start', handlePanelDragStart);
      window.removeEventListener('panel-drag-end', handlePanelDragEnd);
    };
  }, [handleDragStart, handleDragEnd]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {children}
      <SnapZonesOverlay
        isActive={isDragging}
        activeZone={activeSnapZone}
        onZoneHover={handleZoneHover}
      />
    </div>
  );
};

export default SnapZonesOverlay;
