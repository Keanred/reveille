import type { Cache } from './cache.js';
import type { SecretStore } from './secrets.js';
import type { Source, SourceState } from './source.js';
import { withTimeout } from './timeout.js';

export interface OrchestratorDeps {
  cache: Cache;
  secrets: SecretStore;
  now?: () => number;
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
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  budgetMs?: number;
}

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

export async function* scheduleSources(
  sources: readonly Source[],
  deps: ScheduleDeps,
): AsyncGenerator<SourceUpdate> {
  const { signal, sleep = defaultSleep, budgetMs } = deps;
  const byId = new Map(sources.map((s) => [s.id, s] as const));
  const inFlight = new Map<string, Promise<SourceUpdate>>();
  const emitted = new Set<string>();

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
      continue;
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
