interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
export const PLUGIN_RATE_LIMIT_PER_MINUTE = 60;

export function consumePluginRateLimit(
  pluginId: string,
  now = Date.now(),
  limit = PLUGIN_RATE_LIMIT_PER_MINUTE,
): boolean {
  const current = buckets.get(pluginId);
  if (!current || now - current.windowStart >= WINDOW_MS) {
    buckets.set(pluginId, { count: 1, windowStart: now });
    return true;
  }

  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function resetPluginRateLimits(): void {
  buckets.clear();
}
