// @ts-check
// Serial async queue with per-key debounce: bursts of rolls become one write per session page,
// and writes never overlap (overlapping updates to the same page would clobber each other).

export class WriteQueue {
  /** @param {{ debounceMs?: number, onError?: (err: Error, key: string) => void }} [opts] */
  constructor({ debounceMs = 250, onError = (e) => console.error(e) } = {}) {
    this.debounceMs = debounceMs;
    this.onError = onError;
    /** @type {Map<string, { timer: any, work: (key: string) => Promise<void>, resolvers: Array<() => void> }>} */
    this.pending = new Map();
    this.chain = Promise.resolve();
    this.inFlight = 0;
  }

  /**
   * Schedule `work(key)` after the debounce window; repeated calls for the same key coalesce (the
   * last `work` wins). Resolves when that key's write has completed.
   * @param {string} key
   * @param {(key: string) => Promise<void>} work
   */
  schedule(key, work) {
    return new Promise((resolve) => {
      const entry = this.pending.get(key) ?? { timer: null, work, resolvers: [] };
      entry.work = work;
      entry.resolvers.push(resolve);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this._run(key), this.debounceMs);
      this.pending.set(key, entry);
    });
  }

  _run(key) {
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    this.chain = this.chain
      .then(async () => {
        this.inFlight++;
        try { await entry.work(key); } catch (e) { this.onError(/** @type {Error} */ (e), key); } finally { this.inFlight--; }
      })
      .then(() => entry.resolvers.forEach((r) => r()));
  }

  /** Run everything pending now (skipping the rest of the debounce window) and wait for completion. */
  async flush() {
    for (const key of [...this.pending.keys()]) this._run(key);
    await this.chain;
  }

  get idle() {
    return this.inFlight === 0 && this.pending.size === 0;
  }
}
