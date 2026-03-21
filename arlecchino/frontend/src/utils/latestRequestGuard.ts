export type LatestRequestGuard = {
  next: () => number;
  isLatest: (requestId: number) => boolean;
  mark: (requestId: number) => boolean;
};

export function createLatestRequestGuard(): LatestRequestGuard {
  let activeRequestId = 0;

  return {
    next: () => {
      activeRequestId += 1;
      return activeRequestId;
    },
    isLatest: (requestId: number) => requestId === activeRequestId,
    mark: (requestId: number) => requestId === activeRequestId,
  };
}
