import {
  buildActivityStatusItems,
  type ActivityStatusData,
} from "./activityStatus";
import { ActivityIcon } from "./ActivityIcon";

interface ActivityTimelineProps extends ActivityStatusData {
  visible: boolean;
}

export function ActivityTimeline({ visible, ...data }: ActivityTimelineProps) {
  if (!visible) return null;

  const items = buildActivityStatusItems(data);
  if (items.length === 0) return null;

  return (
    <section className="ai-chat-activity" aria-label="AI runtime activity">
      <div className="ai-chat-activity__items">
        {items.map((item) => (
          <div
            key={item.key}
            className="ai-chat-activity__item"
            data-state={item.state}
          >
            <ActivityIcon state={item.state} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
