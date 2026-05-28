import { AlertCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";

import type { ActivityStatusState } from "./activityStatus";

export function ActivityIcon({ state }: { state: ActivityStatusState }) {
  if (state === "error") return <AlertCircle size={15} />;
  if (state === "done") return <CheckCircle2 size={15} />;
  if (state === "active") return <Loader2 size={15} className="spin" />;
  return <Circle size={15} />;
}
