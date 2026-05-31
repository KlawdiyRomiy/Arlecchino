import React from "react";
import { motion, HTMLMotionProps } from "framer-motion";

interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit" | "reset";
  style?: React.CSSProperties;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  children,
  className = "",
  disabled = false,
  onClick,
  type = "button",
  style,
}) => {
  const baseClasses =
    "rounded-[10px] border font-medium transition-smooth focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]";

  const variantClasses = {
    primary:
      "border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] hover:border-[var(--button-primary-border-hover)] hover:bg-[var(--button-primary-bg-hover)] active:translate-y-px",
    secondary:
      "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
    ghost:
      "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
  };

  const sizeClasses = {
    sm: "min-h-8 px-3 text-sm",
    md: "min-h-9 px-4 text-sm",
    lg: "min-h-10 px-5 text-base",
  };

  const disabledClasses = disabled
    ? "cursor-not-allowed opacity-45"
    : "cursor-pointer";

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
