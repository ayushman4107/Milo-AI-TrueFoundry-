export class HarnessFailure extends Error {
  constructor(readonly kind: 'auth' | 'unreachable' | 'transient' | 'disconnect' | 'harness' | 'invalid', message: string) { super(message); }
}
export interface HarnessDriver<T> {
  attempt(model: string, request: string, signal: AbortSignal): Promise<T>;
  // Must cancel the old session and revoke its staged state before another model starts.
  abandon(): Promise<void>;
}

/** Recovery policy only. The injected driver must use TrueForge, never a provider API. */
export class ModelFailover {
  #blockedUntil = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async run<T>(options: { models: readonly string[]; request: string; signal: AbortSignal; driver: HarnessDriver<T>; hasSideEffects: () => boolean; onSwitch: (model: string) => void }): Promise<T> {
    const models = [...new Set(options.models)]; if (!models.length || models.length > 8) throw new Error('Configure 1–8 TrueForge models');
    if (models.some(m => !m.trim() || m.length > 256)) throw new Error('Invalid model name');
    for (const [name,until] of this.#blockedUntil) if(until <= this.now()) this.#blockedUntil.delete(name);
    if(this.#blockedUntil.size > 128) this.#blockedUntil.clear();
    let last: unknown = new Error('All model circuits are cooling down');
    for (const model of models) {
      options.signal.throwIfAborted(); if ((this.#blockedUntil.get(model) ?? 0) > this.now()) continue;
      options.onSwitch(model);
      try { const result = await options.driver.attempt(model, options.request, options.signal); options.signal.throwIfAborted(); return result; }
      catch (error) {
        options.signal.throwIfAborted(); last = error;
        if (!(error instanceof HarnessFailure) || !['auth','unreachable','transient'].includes(error.kind) || options.hasSideEffects()) throw error;
        await options.driver.abandon(); options.signal.throwIfAborted();
        this.#blockedUntil.set(model, this.now() + 120000);
      }
    }
    throw last;
  }
}
