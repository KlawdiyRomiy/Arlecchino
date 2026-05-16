import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";

export function mergeModelOptions(
  provider: AIProviderDescriptor | null,
  runtime: AIProviderRuntimeDescriptor | null | undefined,
): AIProviderRuntimeModel[] {
  const merged = new Map<string, AIProviderRuntimeModel>();
  for (const model of provider?.models ?? []) {
    if (!model.id) continue;
    merged.set(model.id, {
      id: model.id,
      displayName: model.displayName || model.id,
      source: "active",
      active: model.id === provider?.defaultModel,
      runnable: false,
    });
  }
  for (const model of runtime?.models ?? []) {
    const key = model.path || model.id;
    if (!key) continue;
    const existing = merged.get(model.id);
    merged.set(model.id, {
      ...model,
      source: existing?.source === "active" ? "active" : model.source,
      active: Boolean(existing?.active || model.active),
      runnable: Boolean(existing?.runnable || model.runnable),
    });
  }
  return Array.from(merged.values()).sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    if (left.runnable !== right.runnable) return left.runnable ? -1 : 1;
    return (left.displayName || left.id).localeCompare(
      right.displayName || right.id,
    );
  });
}
