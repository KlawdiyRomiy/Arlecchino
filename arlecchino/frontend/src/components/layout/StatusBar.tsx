import React from "react";

export const StatusBar: React.FC = () => {
  return (
    <div className="h-6 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] flex items-center px-4 text-[10px] select-none font-mono z-50">
      {/* Left section */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors">
          <div className="w-1.5 h-1.5 rounded-full bg-[#4a4] animate-[pulse_2s_ease-in-out_infinite]" />
          <span className="text-[var(--text-muted)]">Ready</span>
        </div>

        <div className="w-px h-3 bg-[var(--border-subtle)]" />

        <div className="flex items-center gap-1.5 hover:text-[var(--text-secondary)] px-2 py-0.5 rounded cursor-pointer transition-colors">
          <span className="text-[var(--text-muted)]">main</span>
        </div>

        <div className="w-px h-3 bg-[var(--border-subtle)]" />

        <div className="flex items-center gap-1.5 hover:text-[var(--text-secondary)] cursor-pointer transition-colors">
          <span className="text-[var(--text-muted)]">Go 1.25</span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section */}
      <div className="flex items-center gap-4">
        <div className="text-[var(--text-muted)] max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
          internal/predictive/ast.go
        </div>

        <div className="w-px h-3 bg-[var(--border-subtle)]" />

        <div className="text-[var(--text-muted)]">Ln 9, Col 24</div>

        <div className="w-px h-3 bg-[var(--border-subtle)]" />

        <div className="text-[var(--text-muted)]">UTF-8</div>
      </div>
    </div>
  );
};
