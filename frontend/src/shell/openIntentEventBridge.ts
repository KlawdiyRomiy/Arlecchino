import { useEffect } from "react";
import { EventsEmit, EventsOn } from "../wails/runtime";
import { OPEN_INTENT_EVENT, routeOpenIntent } from "./openIntentRouter";

const OPEN_INTENT_FRONTEND_READY_EVENT = "ide:frontend:ready";

export const useOpenIntentEventBridge = () => {
  useEffect(() => {
    const handleOpenIntent = (payload: unknown) => {
      void routeOpenIntent(payload);
    };

    const unsubscribe = EventsOn(OPEN_INTENT_EVENT, handleOpenIntent);
    EventsEmit(OPEN_INTENT_FRONTEND_READY_EVENT, {
      contract: "open-intent",
      version: 1,
      bridge: "app",
    });

    return unsubscribe;
  }, []);
};
