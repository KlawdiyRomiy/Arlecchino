export const isDetachedAppletHostRoute = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("arleDetachedHost");
