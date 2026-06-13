const BOOT_FALLBACK_ID = "arlecchino-boot-fallback";

const bootFallbackStyle =
  "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#f4f4f4;font:13px -apple-system,BlinkMacSystemFont,'SF Pro',sans-serif;letter-spacing:0;";

const renderBootFallback = (message = "Loading Arlecchino...") => {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  root.innerHTML = "";
  const fallback = document.createElement("div");
  fallback.id = BOOT_FALLBACK_ID;
  fallback.setAttribute("style", bootFallbackStyle);
  fallback.textContent = message;
  root.appendChild(fallback);
};

const renderBootError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  renderBootFallback(`Arlecchino failed to start: ${message}`);
  console.error("Arlecchino boot failed:", error);
};

renderBootFallback();

const handleBootError = (event: ErrorEvent) => {
  renderBootError(event.error ?? event.message);
};

const handleBootRejection = (event: PromiseRejectionEvent) => {
  renderBootError(event.reason);
};

window.addEventListener("error", handleBootError);
window.addEventListener("unhandledrejection", handleBootRejection);

const clearBootErrorListeners = () => {
  window.removeEventListener("error", handleBootError);
  window.removeEventListener("unhandledrejection", handleBootRejection);
};

import("./main").then(clearBootErrorListeners).catch(renderBootError);
