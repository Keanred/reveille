import { useEffect, useState } from 'react';
import type { Cache } from '../core/cache.js';
import { scheduleSources } from '../core/orchestrator.js';
import type { SecretStore } from '../core/secrets.js';
import type { Source, SourceState } from '../core/source.js';
import { initialState } from '../core/source.js';

export interface UseDashboardDeps {
  cache: Cache;
  secrets: SecretStore;
  /** Global first-paint budget in ms. Omit for no budget. */
  budgetMs?: number;
}

/** Drives every source through one `scheduleSources` stream, keyed by id. */
export function useDashboard(sources: readonly Source[], deps: UseDashboardDeps) {
  const { cache, secrets, budgetMs } = deps;
  const [states, setStates] = useState<Map<string, SourceState>>(
    () => new Map(sources.map((s) => [s.id, initialState()])),
  );

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const stream = scheduleSources(sources, { cache, secrets, signal: ac.signal, budgetMs });
      for await (const { id, state } of stream) {
        setStates((prev) => new Map(prev).set(id, state)); // NEW Map => React re-renders
      }
    })();
    return () => ac.abort(); // unmount -> abort-aware loop ends, in-flight fetches cancel
  }, [sources, cache, secrets, budgetMs]);

  return states;
}
