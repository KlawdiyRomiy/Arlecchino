import type {
  AIProviderCapability,
  AIProviderStatusValue,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";

const supportedLocalProviderKinds = new Set([
  "ollama",
  "lm-studio",
  "llama.cpp",
  "huggingface-tgi",
]);

const rawReasonPatterns = [
  /dial tcp/i,
  /connection refused/i,
  /econnrefused/i,
  /^get\s+"/i,
  /^post\s+"/i,
  /fetch failed/i,
  /no such host/i,
  /i\/o timeout/i,
  /context deadline exceeded/i,
];

export type ProviderTone =
  | "ready"
  | "warning"
  | "disabled"
  | "error"
  | "neutral";

export interface ProviderPresentation {
  title: string;
  subtitle: string;
  rawReason: string;
  tone: ProviderTone;
  selectable: boolean;
  ready: boolean;
  local: boolean;
  modelLabel: string;
}

export function providerSupportsChat(
  provider: AIProviderDescriptor | null,
): boolean {
  return Boolean(
    provider?.capabilities?.includes("chat" as AIProviderCapability),
  );
}

export function isSupportedLocalChatProvider(
  provider: AIProviderDescriptor | null,
): boolean {
  return Boolean(
    provider &&
    provider.local &&
    !provider.frontier &&
    supportedLocalProviderKinds.has(provider.kind) &&
    providerSupportsChat(provider),
  );
}

export function isReadyChatProvider(
  provider: AIProviderDescriptor | null,
): boolean {
  return Boolean(
    provider &&
    isSupportedLocalChatProvider(provider) &&
    provider.status === ("ready" as AIProviderStatusValue),
  );
}

export function sanitizeProviderReason(
  provider: AIProviderDescriptor | null,
): string {
  if (!provider) return "No provider selected";
  const rawReason = provider.reason?.trim() ?? "";

  if (provider.frontier) {
    return "Cloud provider unavailable";
  }
  if (provider.status === ("ready" as AIProviderStatusValue)) {
    const modelCount = provider.models?.length ?? 0;
    return modelCount > 0
      ? `${modelCount} model${modelCount === 1 ? "" : "s"} ready`
      : "Ready";
  }
  if (provider.status === ("needs_auth" as AIProviderStatusValue)) {
    return "API key required";
  }
  if (provider.status === ("degraded" as AIProviderStatusValue)) {
    return "Provider degraded";
  }
  if (provider.status === ("disabled" as AIProviderStatusValue)) {
    return "Provider disabled";
  }
  if (rawReasonPatterns.some((pattern) => pattern.test(rawReason))) {
    return "Local server unavailable";
  }
  if (provider.endpoint) {
    return "Start local server and refresh";
  }
  return rawReason || "Unavailable";
}

export function getProviderPresentation(
  provider: AIProviderDescriptor | null,
): ProviderPresentation {
  const ready = isReadyChatProvider(provider);
  const local = Boolean(provider && !provider.frontier);
  const status = provider?.status ?? ("unavailable" as AIProviderStatusValue);
  const tone: ProviderTone = ready
    ? "ready"
    : provider?.frontier || status === ("disabled" as AIProviderStatusValue)
      ? "disabled"
      : status === ("needs_auth" as AIProviderStatusValue)
        ? "warning"
        : status === ("error" as AIProviderStatusValue) ||
            status === ("unavailable" as AIProviderStatusValue)
          ? "error"
          : "neutral";

  return {
    title: provider?.name || provider?.id || "No local provider",
    subtitle: sanitizeProviderReason(provider),
    rawReason: provider?.reason?.trim() ?? "",
    tone,
    selectable: isSupportedLocalChatProvider(provider),
    ready,
    local,
    modelLabel:
      provider?.models?.[0]?.displayName || provider?.models?.[0]?.id || "",
  };
}

export function sortProviders(
  providers: readonly AIProviderDescriptor[],
): AIProviderDescriptor[] {
  const score = (provider: AIProviderDescriptor): number => {
    if (isReadyChatProvider(provider)) return 0;
    if (!isSupportedLocalChatProvider(provider)) return 4;
    if (provider.status === ("needs_auth" as AIProviderStatusValue)) return 1;
    return 2;
  };

  return [...providers].filter(isSupportedLocalChatProvider).sort((a, b) => {
    const byScore = score(a) - score(b);
    if (byScore !== 0) return byScore;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

export function selectDefaultProvider(
  providers: readonly AIProviderDescriptor[],
  preferredProviderId?: string,
): AIProviderDescriptor | null {
  const sorted = sortProviders(providers);
  const preferred = sorted.find(
    (provider) =>
      provider.id === preferredProviderId &&
      isSupportedLocalChatProvider(provider),
  );
  if (preferred && isReadyChatProvider(preferred)) return preferred;
  const ready = sorted.find(isReadyChatProvider);
  if (ready) return ready;
  return sorted[0] ?? null;
}

export function getProviderDisabledReason(
  provider: AIProviderDescriptor | null,
): string {
  if (!provider) return "Ready local provider required";
  if (!isSupportedLocalChatProvider(provider))
    return "Supported local provider required";
  if (!providerSupportsChat(provider)) return "Provider does not expose chat";
  if (!isReadyChatProvider(provider)) return sanitizeProviderReason(provider);
  return "";
}
