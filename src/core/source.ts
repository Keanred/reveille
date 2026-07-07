import type { Cache } from './cache.js';
import type { SecretStore } from './secrets.js';

export interface SourceContext {
  cache: Cache;
  secrets: SecretStore;
  signal: AbortSignal;
  now: () => number;
}

export interface Source<T = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly ttl: number;
  readonly timeout: number;
  fetch(ctx: SourceContext): Promise<T>;
  readonly size?: 'sm' | 'md' | 'lg';
}

export type SourceState<T = unknown> =
  | { status: 'loading' }
  | { status: 'ok'; data: T; fetchedAt: number }
  | { status: 'stale'; data: T; fetchedAt: number; error: Error }
  | { status: 'error'; error: Error };

export type SourceStatus = SourceState['status'];

export function initialState<T = unknown>(): SourceState<T> {
  return { status: 'loading' };
}
