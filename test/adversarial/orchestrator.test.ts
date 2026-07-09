import { describe, expect, it } from 'vitest';
import { type Cache, MemoryCache } from '../../src/core/cache.js';
import { runAll, runSource, scheduleSources, streamAll } from '../../src/core/orchestrator.js';
import type { SecretStore } from '../../src/core/secrets.js';
import type { Source, SourceState } from '../../src/core/source.js';

const noSecrets: SecretStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => false,
};

const FIXED = Date.parse('2026-06-29T00:00:00.000Z');

function source<T>(
  over: Partial<Source<T>> & { id: string; fetch: Source<T>['fetch'] },
): Source<T> {
  return { kind: 'test', label: over.id, ttl: 1_000, timeout: 10_000, ...over } as Source<T>;
}

function deps(cache: Cache) {
  return { cache, secrets: noSecrets, now: () => FIXED };
}

describe('runSource', () => {
  it('returns ok and writes through to cache on success', async () => {
    const cache = new MemoryCache();
    const s = source({ id: 'a', fetch: async () => ({ v: 1 }) });

    const state = await runSource(s, deps(cache));

    expect(state).toMatchObject({ status: 'ok', data: { v: 1 }, fetchedAt: FIXED });
    expect((await cache.get<{ v: number }>('a'))?.data).toEqual({ v: 1 });
  });

  it('falls back to cached data as stale when a fetch fails', async () => {
    const cache = new MemoryCache();
    await cache.set('a', { v: 'old' });
    const s = source({
      id: 'a',
      fetch: async () => {
        throw new Error('boom');
      },
    });

    const state = await runSource(s, deps(cache));

    expect(state.status).toBe('stale');
    if (state.status === 'stale') {
      expect(state.data).toEqual({ v: 'old' });
      expect(state.error.message).toBe('boom');
    }
  });

  it('surfaces an error when a fetch fails with no cache to fall back on', async () => {
    const cache = new MemoryCache();
    const s = source({
      id: 'a',
      fetch: async () => {
        throw new Error('cold');
      },
    });

    const state = await runSource(s, deps(cache));

    expect(state.status).toBe('error');
    if (state.status === 'error') {
      expect(state.error.message).toBe('cold');
    }
  });

  it('enforces the source timeout on a hung fetch and falls back to cache', async () => {
    const cache = new MemoryCache();
    await cache.set('slow', 'cached');
    const s = source<string>({
      id: 'slow',
      timeout: 5,
      fetch: (ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason));
        }),
    });

    const state = await runSource(s, deps(cache));

    expect(state.status).toBe('stale');
    if (state.status === 'stale') {
      expect(state.data).toBe('cached');
      expect(state.error.name).toBe('TimeoutError');
    }
  });
});

describe('streamAll', () => {
  it('emits each source as it settles — completion order, not input order', async () => {
    const cache = new MemoryCache();
    const after = (id: string, ms: number) =>
      source({ id, fetch: () => new Promise((resolve) => setTimeout(() => resolve(id), ms)) });

    // Deliberately list them slowest-first to prove the order comes from *timing*.
    const sources = [after('slow', 50), after('fast', 10), after('mid', 30)];

    const order: string[] = [];
    for await (const { id, state } of streamAll(sources, deps(cache))) {
      expect(state.status).toBe('ok');
      order.push(id);
    }

    expect(order).toEqual(['fast', 'mid', 'slow']);
  });

  it('emits a stale/error update without stalling the healthy ones behind it', async () => {
    const cache = new MemoryCache();
    const good = source({
      id: 'good',
      fetch: () => new Promise((r) => setTimeout(() => r(1), 40)),
    });
    const bad = source({
      id: 'bad',
      fetch: async () => {
        throw new Error('down');
      },
    });

    const updates = new Map<string, string>();
    const order: string[] = [];
    for await (const { id, state } of streamAll([good, bad], deps(cache))) {
      updates.set(id, state.status);
      order.push(id);
    }

    // 'bad' rejects immediately, so it must surface first — not wait for 'good'.
    expect(order).toEqual(['bad', 'good']);
    expect(updates.get('bad')).toBe('error');
    expect(updates.get('good')).toBe('ok');
  });
});

describe('scheduleSources', () => {
  it('re-arms each source on its own ttl and stops when the signal aborts', async () => {
    const cache = new MemoryCache();
    const ac = new AbortController();
    const slept: number[] = [];
    // Instant sleep, but records the requested delay so we can assert the cadence.
    const sleep = async (ms: number): Promise<void> => {
      slept.push(ms);
    };

    let n = 0;
    const s = source({ id: 'a', ttl: 500, fetch: async () => ++n });

    const seen: number[] = [];
    for await (const { state } of scheduleSources([s], {
      cache,
      secrets: noSecrets,
      now: () => FIXED,
      signal: ac.signal,
      sleep,
    })) {
      if (state.status === 'ok') seen.push(state.data as number);
      if (seen.length >= 3) ac.abort();
    }

    expect(seen).toEqual([1, 2, 3]); // same source fetched repeatedly => it re-armed
    expect(slept.every((ms) => ms === 500)).toBe(true); // each re-arm waited its own ttl
    expect(slept.length).toBeGreaterThanOrEqual(2);
  });

  it('paints cached data as stale first, then revalidates to fresh (SWR)', async () => {
    const cache = new MemoryCache();
    await cache.set('a', { v: 'cached' });
    const ac = new AbortController();
    // The fetch is delayed, so the stale paint must come from cache — before this resolves.
    const s = source<{ v: string }>({
      id: 'a',
      ttl: 10_000,
      fetch: () => new Promise((resolve) => setTimeout(() => resolve({ v: 'fresh' }), 20)),
    });

    const seen: SourceState[] = [];
    for await (const { state } of scheduleSources([s], {
      cache,
      secrets: noSecrets,
      now: () => FIXED,
      signal: ac.signal,
      sleep: async () => {},
    })) {
      seen.push(state);
      if (state.status === 'ok') ac.abort(); // fresh value arrived -> stop
    }

    // Two-phase: cached data instantly (stale), then the live value (ok).
    expect(seen.map((st) => st.status)).toEqual(['stale', 'ok']);
    const [first, second] = seen;
    if (first.status === 'stale') expect(first.data).toEqual({ v: 'cached' });
    if (second.status === 'ok') expect(second.data).toEqual({ v: 'fresh' });
  });

  it('skips hydration when there is no cache — first emission is the live result', async () => {
    const cache = new MemoryCache(); // empty: nothing to hydrate from
    const ac = new AbortController();
    const s = source({ id: 'a', ttl: 10_000, fetch: async () => ({ v: 'fresh' }) });

    const statuses: string[] = [];
    for await (const { state } of scheduleSources([s], {
      cache,
      secrets: noSecrets,
      now: () => FIXED,
      signal: ac.signal,
      sleep: async () => {},
    })) {
      statuses.push(state.status);
      ac.abort(); // one emission is enough
    }

    expect(statuses).toEqual(['ok']); // no phantom 'stale' before the live value
  });

  it('forces a stuck (no-cache) source to a terminal state when the global budget elapses', async () => {
    const cache = new MemoryCache(); // empty: nothing to hydrate, so it starts on 'loading'
    const ac = new AbortController();
    // Fetch resolves slower than the budget, so the budget wins the race.
    const s = source({
      id: 'a',
      timeout: 1_000,
      fetch: () => new Promise((r) => setTimeout(() => r(1), 200)),
    });

    const seen: SourceState[] = [];
    for await (const { state } of scheduleSources([s], {
      cache,
      secrets: noSecrets,
      now: () => FIXED,
      signal: ac.signal,
      budgetMs: 20, // real 20ms via defaultSleep
    })) {
      seen.push(state);
      ac.abort(); // the forced emission is enough
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe('error');
    if (seen[0].status === 'error') expect(seen[0].error.message).toMatch(/budget/);
  });

  it('does not force a panel that already painted from cache (budget skips it)', async () => {
    const cache = new MemoryCache();
    await cache.set('a', { v: 'cached' });
    const ac = new AbortController();
    // Revalidation finishes after the budget, so the budget fires while 'a' shows cache.
    const s = source<{ v: string }>({
      id: 'a',
      timeout: 1_000,
      fetch: () => new Promise((r) => setTimeout(() => r({ v: 'fresh' }), 60)),
    });

    const seen: SourceState[] = [];
    for await (const { state } of scheduleSources([s], {
      cache,
      secrets: noSecrets,
      now: () => FIXED,
      signal: ac.signal,
      budgetMs: 20,
    })) {
      seen.push(state);
      if (state.status === 'ok') ac.abort();
    }

    // Budget fires at 20ms, but 'a' already painted via hydrate — no forced emission sneaks in.
    expect(seen.map((st) => st.status)).toEqual(['stale', 'ok']);
  });
});

describe('runAll', () => {
  it('isolates a failing source from a healthy one', async () => {
    const cache = new MemoryCache();
    const ok = source({ id: 'ok', fetch: async () => 1 });
    const bad = source({
      id: 'bad',
      fetch: async () => {
        throw new Error('nope');
      },
    });

    const [a, b] = await runAll([ok, bad], deps(cache));

    expect(a?.status).toBe('ok');
    expect(b?.status).toBe('error');
    if (b?.status === 'error') {
      expect(b.error.message).toBe('nope');
    }
  });
});
