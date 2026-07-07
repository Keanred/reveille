import type { ClockSourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';

export interface ClockData {
  iso: string;
  display: string;
}

export function clockSource(cfg: ClockSourceConfig): Source<ClockData> {
  return {
    id: cfg.id,
    kind: 'clock',
    label: cfg.title ?? 'Clock',
    ttl: (cfg.refresh ?? 1) * 1000,
    timeout: 5_000,
    async fetch(ctx) {
      const now = new Date(ctx.now());
      return {
        iso: now.toISOString(),
        display: now.toLocaleTimeString(),
      };
    },
  };
}
