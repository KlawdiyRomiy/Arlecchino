import React, { useCallback } from "react";
import {
  Quit,
  WindowMinimise,
  WindowToggleMaximise,
} from "../../../wailsjs/runtime/runtime";

export const WindowControls: React.FC = () => {
  const handleClose = useCallback(() => Quit(), []);
  const handleMinimize = useCallback(() => WindowMinimise(), []);
  const handleMaximize = useCallback(() => WindowToggleMaximise(), []);

  return (
    <div className="flex items-center gap-0 pl-3 ml-1 border-l border-[var(--border-subtle)] h-full">
      <div className="flex items-center gap-[7px] px-2">
        <button
          onClick={handleClose}
          className="w-[13px] h-[13px] rounded-full bg-[#585858] hover:bg-[#ff5f57] transition-colors"
          title="Close"
        />
        <button
          onClick={handleMinimize}
          className="w-[13px] h-[13px] rounded-full bg-[#484848] hover:bg-[#febc2e] transition-colors"
          title="Minimize"
        />
        <button
          onClick={handleMaximize}
          className="w-[13px] h-[13px] rounded-full bg-[#3a3a3a] hover:bg-[#28c840] transition-colors"
          title="Maximize"
        />
      </div>
    </div>
  );
};
