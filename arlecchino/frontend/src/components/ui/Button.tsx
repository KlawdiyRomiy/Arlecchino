import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  style?: React.CSSProperties;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  disabled = false,
  onClick,
  type = 'button',
  style,
}) => {
  const baseClasses = 'rounded-lg font-medium transition-smooth focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 dark:focus:ring-offset-black';
  
  const variantClasses = {
    primary: 'bg-[#111111] dark:bg-[#111111] text-white dark:text-white border border-[#2a2a2a] hover:bg-[#1a1a1a] hover:border-[#333333] active:scale-98',
    secondary: 'bg-[#111111] dark:bg-[#111111] text-white dark:text-white border border-[#2a2a2a] hover:bg-[#1a1a1a] hover:border-[#333333]',
    ghost: 'bg-transparent hover:bg-[#1a1a1a] dark:hover:bg-[#1a1a1a] text-[#888888] dark:text-[#888888] hover:text-white dark:hover:text-white',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${disabledClasses} ${className}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
      style={style}
    >
      {children}
    </motion.button>
  );
};
