let dragSelectionLockCount = 0;

export const beginDragSelectionLock = () => {
  dragSelectionLockCount += 1;
  document.body.classList.add("arle-dragging-no-select");
  document.getSelection()?.removeAllRanges();

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    dragSelectionLockCount = Math.max(0, dragSelectionLockCount - 1);
    if (dragSelectionLockCount === 0) {
      document.body.classList.remove("arle-dragging-no-select");
      document.getSelection()?.removeAllRanges();
    }
  };
};
