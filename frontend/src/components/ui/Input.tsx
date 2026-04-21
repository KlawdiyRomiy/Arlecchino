import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = "",
  ...props
}) => {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-[var(--text-secondary)]">
          {label}
        </label>
      )}
      <input
        className={`
          min-h-9 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2
          text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
          focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]
          transition-smooth
          ${error ? "border-[var(--status-error)]" : "hover:border-[var(--border-default)]"}
          ${className}
        `}
        {...props}
      />
      {error && (
        <span className="text-sm text-[var(--status-error)]">{error}</span>
      )}
    </div>
  );
};
