import React from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  side: 'left' | 'right';
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const Sidebar: React.FC<SidebarProps> = ({
  side,
  isCollapsed,
  onToggle,
  children,
}) => {
  const width = isCollapsed ? 48 : side === 'left' ? 260 : 320;

  return (
    <motion.div
      animate={{ width }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="h-full bg-gray-50 dark:bg-laravel-dark-panel border-r dark:border-gray-800 flex flex-col overflow-hidden"
    >
      <div className="h-10 flex items-center justify-between px-3 border-b border-gray-200 dark:border-gray-800">
        {!isCollapsed && (
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {side === 'left' ? 'Project' : 'AI Assistant'}
          </span>
        )}
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-smooth"
        >
          {side === 'left' ? (
            isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />
          ) : (
            isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </motion.div>
  );
};
