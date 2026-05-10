export const APP_NOTIFICATION_STACK_ATTRIBUTE = "data-app-notification-stack";
export const APP_NOTIFICATION_STACK_SELECTOR = `[${APP_NOTIFICATION_STACK_ATTRIBUTE}="true"]`;

const isInsideAppNotificationStack = (
  target: EventTarget | null | undefined,
) => {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  return Boolean(element?.closest(APP_NOTIFICATION_STACK_SELECTOR));
};

type EventWithOriginalEvent = Event & {
  detail?: {
    originalEvent?: Event;
  };
};

export const isAppNotificationInteractionEvent = (event: Event) => {
  const originalEvent = (event as EventWithOriginalEvent).detail?.originalEvent;
  const directTargets = [event.target, originalEvent?.target];
  if (directTargets.some(isInsideAppNotificationStack)) {
    return true;
  }

  const composedPath = [
    ...(event.composedPath?.() ?? []),
    ...(originalEvent?.composedPath?.() ?? []),
  ];
  return composedPath.some(isInsideAppNotificationStack);
};
