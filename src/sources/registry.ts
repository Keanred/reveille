import type { ReveilleConfig, SourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';
import { clockSource } from './clock.js';
import { httpJsonSource } from './http-json.js';
import { weatherSource } from './weather.js';
import { gitSource } from './git.js';

/**
 * Turns a single config entry into a live Source. The `type` discriminant maps
 * to a concrete implementation — add new source types here.
 */
export function buildSource(cfg: SourceConfig): Source {
  switch (cfg.type) {
    case 'clock':
      return clockSource(cfg);
    case 'http-json':
      return httpJsonSource(cfg);
    case 'weather':
      return weatherSource(cfg);
    case 'git':
      return gitSource(cfg);
    case 'github':
      return githubSource(cfg);
    default: {
      // Exhaustiveness guard: a new SourceConfig variant will fail to compile here.
      const _exhaustive: never = cfg;
      throw new Error(`Unknown source type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Builds every Source declared in the config, applying the app-wide refresh default. */
export function buildSources(config: ReveilleConfig): Source[] {
  const fallbackMs = config.app.refresh * 1000;
  return config.sources.map((cfg) => {
    const source = buildSource(cfg);
    return source.ttl ? source : { ...source, ttl: fallbackMs };
  });
}
