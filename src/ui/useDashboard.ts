import { useEffect, useState } from 'react';
import type { Cache } from '../core/cache.js';
import { scheduleSources } from '../core/orchestrator.js';
import type { SecretStore } from '../core/secrets.js';
import type { Source, SourceState } from '../core/source.js';
import { initialState } from '../core/source.js';

export interface UseDashboardDeps {
  cache: Cache;
  secrets: SecretStore;
  budgetMs?: number;
}

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
        setStates((prev) => new Map(prev).set(id, state));
      }
    })();
    return () => ac.abort();
  }, [sources, cache, secrets, budgetMs]);

  return states;
}
