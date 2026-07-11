export type RunTokenConsumer = (runId: string, token: string) => void;

export type AnimationFrameScheduler = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (frameId: number) => void;
};

export function mostCompleteRunText(
  recordedText: string,
  streamingText: string,
  running: boolean,
): string {
  if (running) return streamingText || recordedText;
  return recordedText;
}

export function runStreamFollowCursor(streamingText: string): string {
  return `${streamingText.length}:${streamingText.slice(-96)}`;
}

export class RunTokenFrameBuffer {
  private readonly pending = new Map<string, string[]>();
  private frameId: number | null = null;

  constructor(
    private readonly consume: RunTokenConsumer,
    private readonly scheduler: AnimationFrameScheduler,
  ) {}

  enqueue(runId: string, token: string): void {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId || !token) return;

    const chunks = this.pending.get(normalizedRunId);
    if (chunks) {
      chunks.push(token);
    } else {
      this.pending.set(normalizedRunId, [token]);
    }
    if (this.frameId !== null) return;

    this.frameId = this.scheduler.request(() => {
      this.frameId = null;
      this.flush();
    });
  }

  flush(runId?: string): void {
    const normalizedRunId = runId?.trim();
    if (normalizedRunId) {
      const chunks = this.pending.get(normalizedRunId);
      this.pending.delete(normalizedRunId);
      if (this.pending.size === 0) this.cancelScheduledFrame();
      if (chunks?.length) this.consume(normalizedRunId, chunks.join(""));
      return;
    }

    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [pendingRunId, chunks] of batch) {
      if (chunks.length) this.consume(pendingRunId, chunks.join(""));
    }
  }

  discard(runId?: string): void {
    const normalizedRunId = runId?.trim();
    if (normalizedRunId) {
      this.pending.delete(normalizedRunId);
      if (this.pending.size === 0) this.cancelScheduledFrame();
      return;
    }

    this.pending.clear();
    this.cancelScheduledFrame();
  }

  private cancelScheduledFrame(): void {
    if (this.frameId === null) return;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
  }
}
