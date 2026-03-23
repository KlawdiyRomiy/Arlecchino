import { PERF_EVENT_NAME, measurePerf } from "./perf";

type TerminalPerfDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

export { PERF_EVENT_NAME };

export const recordTerminalPerf = <T>(
  name: string,
  operation: () => T,
  details?: TerminalPerfDetails,
): T => measurePerf("terminal", name, operation, details);
