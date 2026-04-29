import React, { useCallback } from "react";
import { Quit, WindowMinimise } from "../../wails/runtime";
import { toggleWindowFullscreen } from "../../utils/windowFullscreen";

export const WindowControls: React.FC = () => {
  const handleClose = useCallback(() => Quit(), []);
  const handleMinimize = useCallback(() => WindowMinimise(), []);
  const handleFullscreen = useCallback(() => {
    void toggleWindowFullscreen();
  }, []);

  return (
    <div
      className="ml-1 flex h-full -translate-y-[2px] items-center"
      style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
    >
      <div className="shell-cluster px-2.5 py-1.5">
        <button
          onClick={handleClose}
          className="h-[13px] w-[13px] rounded-full bg-[#595959] transition-colors hover:bg-[#ff5f57]"
          title="Close"
        />
        <button
          onClick={handleMinimize}
          className="h-[13px] w-[13px] rounded-full bg-[#4f4f4f] transition-colors hover:bg-[#febc2e]"
          title="Minimize"
        />
        <button
          onClick={handleFullscreen}
          className="h-[13px] w-[13px] rounded-full bg-[#474747] transition-colors hover:bg-[#28c840]"
          title="Full Screen"
        />
      </div>
    </div>
  );
};
