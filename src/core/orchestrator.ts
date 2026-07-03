import type { Cache } from './cache.js';
import type { SecretStore } from './secrets.js';
import type { Source, SourceState } from './source.js';
import { withTimeout } from './timeout.js';

export interface OrchestratorDeps {
  cache: Cache;
  secrets: SecretStore;
  /** Clock injection for deterministic tests. Returns epoch milliseconds. */
  now?: () => number;
  /** Aborts an in-flight load early (e.g. on unmount). */
  signal?: AbortSignal;
}

async function staleFromCache<T>(
  source: Source<T>,
  deps: OrchestratorDeps,
  error: Error,
): Promise<SourceState<T> | null> {
  const cached = await deps.cache.get<T>(source.id).catch(() => null);
  if (cached) {
    return { status: 'stale', data: cached.data, fetchedAt: Date.parse(cached.savedAt), error };
  }
  return null;
}
/**
 * Loads one source to completion and resolves to a *terminal* SourceState.
 *
 * It never rejects: a failed or timed-out load falls back to cached data
 * (`stale`) or, with no cache to lean on, surfaces as `error`. The per-fetch
 * deadline comes from the source's own `timeout`. This is the unit the
 * adversarial suite hammers — every failure mode collapses into a state the UI
 * can render rather than an exception that takes down the dashboard.
 */
export async function runSource<T>(
  source: Source<T>,
  deps: OrchestratorDeps,
): Promise<SourceState<T>> {
  const { cache, secrets, now = () => Date.now(), signal } = deps;

  try {
    const data = await withTimeout(
      (loadSignal) => source.fetch({ cache, secrets, signal: loadSignal, now }),
      source.timeout,
      { signal },
    );
    await cache.set(source.id, data);
    return { status: 'ok', data, fetchedAt: now() };
  } catch (err) {
    const error = err as Error;
    const stale = await staleFromCache(source, deps, error);
    if (stale) return stale;
    return { status: 'error', error };
  }
}

export interface SourceUpdate<T = unknown> {
  id: string;
  state: SourceState<T>;
}

export async function* streamAll(
  sources: readonly Source[],
  deps: OrchestratorDeps,
): AsyncGenerator<SourceUpdate> {
  const inFlight = new Map<string, Promise<SourceUpdate>>();
  for (const src of sources) {
    inFlight.set(
      src.id,
      runSource(src, deps).then((state) => ({ id: src.id, state })),
    );
  }

  while (inFlight.size > 0) {
    const update = await Promise.race(inFlight.values());
    inFlight.delete(update.id);
    yield update;
  }
}

export interface ScheduleDeps extends OrchestratorDeps {
  /** Delay before a source re-enters the stream. Injectable so tests skip real waits. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  budgetMs?: number; // optional: max time to spend in the loop before aborting
}

/** A cancellable delay: resolves after `ms`, or early (and harmlessly) if the signal aborts. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * The perpetual sibling of {@link streamAll}: each source's update is yielded as
 * it settles, then that source is *re-armed* to re-enter the stream after its own
 * `ttl`. The set never drains, so this runs until `deps.signal` aborts. One race
 * loop, per-source cadence — the single orchestration point the UI drives.
 */
export async function* scheduleSources(
  sources: readonly Source[],
  deps: ScheduleDeps,
): AsyncGenerator<SourceUpdate> {
  const { signal, sleep = defaultSleep, budgetMs } = deps;
  const byId = new Map(sources.map((s) => [s.id, s] as const));
  const inFlight = new Map<string, Promise<SourceUpdate>>();
  const emitted = new Set<string>();

  // Schedule one source to load after `delayMs`, tagging the result with its id.
  const arm = (src: Source, delayMs: number): void => {
    inFlight.set(
      src.id,
      (async () => {
        if (delayMs > 0) await sleep(delayMs, signal);
        return { id: src.id, state: await runSource(src, deps) };
      })(),
    );
  };

  const hydrations = await Promise.all(
    sources.map(async (src) => ({
      id: src.id,
      state: await staleFromCache(src, deps, new Error('initial load')),
    })),
  );
  for (const { id, state } of hydrations) {
    if (state) {
      emitted.add(id);
      yield { id, state };
    }
  }

  for (const src of sources) arm(src, 0);

  const BUDGET = Symbol('budget');
  let budget: Promise<typeof BUDGET> | null =
    budgetMs != null ? sleep(budgetMs, signal).then(() => BUDGET) : null;


  while (inFlight.size > 0 && !signal?.aborted) {
    const winner = await Promise.race(
      budget ? [...inFlight.values(), budget] : [...inFlight.values()],
    );

    // Budget elapsed: force any panel still stuck on `loading` to a terminal state.
    if (winner === BUDGET) {
      budget = null;
      for (const src of sources) {
        if (emitted.has(src.id)) continue;
        const forced =
          (await staleFromCache(src, deps, new Error('global timeout budget exceeded'))) ??
          ({ status: 'error', error: new Error('global timeout budget exceeded') } as SourceState);
        emitted.add(src.id);
        yield { id: src.id, state: forced };
      }
      continue; // forced fetches keep running; return to the race
    }

    const update = winner;
    inFlight.delete(update.id);
    if (signal?.aborted) break;
    emitted.add(update.id);
    yield update;
    const src = byId.get(update.id);
    if (src) arm(src, src.ttl);
  }
}

export async function runAll(
  sources: readonly Source[],
  deps: OrchestratorDeps,
): Promise<SourceState<unknown>[]> {
  const byId = new Map<string, SourceState<unknown>>();
  for await (const { id, state } of streamAll(sources, deps)) {
    byId.set(id, state);
  }
  return sources.map((s) => byId.get(s.id) as SourceState<unknown>);
}
