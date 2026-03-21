import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export const ThemeToggle: React.FC = () => {
  const { isDark, setTheme, theme } = useTheme();
  const [isAnimating, setIsAnimating] = React.useState(false);

  const toggleTheme = () => {
    const newTheme = isDark ? 'light' : 'dark';
    setIsAnimating(true);
    setTheme(newTheme);
    
    setTimeout(() => setIsAnimating(false), 600);
  };

  return (
    <>
      <motion.button
        onClick={toggleTheme}
        className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-smooth"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <AnimatePresence mode="wait">
          {isDark ? (
            <motion.div
              key="moon"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Moon size={20} className="text-gray-400" />
            </motion.div>
          ) : (
            <motion.div
              key="sun"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Sun size={20} className="text-gray-600" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {isAnimating && (
          <motion.div
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 100, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={`fixed inset-0 pointer-events-none ${
              isDark ? 'bg-laravel-dark-bg' : 'bg-white'
            }`}
            style={{
              transformOrigin: 'top right',
              zIndex: 9999,
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
};
