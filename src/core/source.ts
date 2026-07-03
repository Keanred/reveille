import type { Cache } from './cache.js';
import type { SecretStore } from './secrets.js';

// ---- The contract every data source implements -------------------------------

export interface SourceContext {
  cache: Cache;
  secrets: SecretStore;
  signal: AbortSignal; // wired to the per-source timeout
  now: () => number; // injectable clock (epoch ms) — makes time/timeout tests deterministic
}

export interface Source<T = unknown> {
  readonly id: string; // stable key, used for cache + layout
  readonly kind: string; // content discriminant — picks the panel body to render
  readonly label: string; // panel title
  readonly ttl: number; // ms a cached value stays "fresh" (also the refresh cadence)
  readonly timeout: number; // ms before a single fetch is abandoned
  fetch(ctx: SourceContext): Promise<T>;
  // Optional: render hint so the orchestrator/layout can size the panel
  readonly size?: 'sm' | 'md' | 'lg';
}

// ---- The state a panel can be in (drives rendering) --------------------------

export type SourceState<T = unknown> =
  | { status: 'loading' }
  | { status: 'ok'; data: T; fetchedAt: number }
  | { status: 'stale'; data: T; fetchedAt: number; error: Error } // live fetch failed, showing cache
  | { status: 'error'; error: Error }; // failed AND no cache to fall back on

export type SourceStatus = SourceState['status'];

/** The state a panel starts in, before its first load resolves. */
export function initialState<T = unknown>(): SourceState<T> {
  return { status: 'loading' };
}
