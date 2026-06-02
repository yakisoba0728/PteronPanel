interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * In-memory cache with per-entry TTL and a simple LRU bound.
 *
 * Map iteration order is insertion order, so the *oldest* live key is always
 * the first key returned by `keys()`. We exploit that for eviction: on `get`
 * of a live entry we delete and re-insert it (moving it to the end → most
 * recently used), and on `set` past capacity we evict the first key (the
 * least recently used).
 */
export class TtlCache<K, V> {
  private store = new Map<K, Entry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency: move this key to the most-recently-used position.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Re-inserting moves an existing key to the end (most recently used).
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
