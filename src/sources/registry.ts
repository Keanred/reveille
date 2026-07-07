import type { ReveilleConfig, SourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';
import { clockSource } from './clock.js';
import { httpJsonSource } from './http-json.js';
import { weatherSource } from './weather.js';
import { gitSource } from './git.js';
import { githubSource } from './github.js';
import { googleCalendarSource } from './google-calendar.js';
import { todoSource } from './todo.js';
import { dockerSource } from './docker.js';
import { localsSource } from './locals.js';
import { daylightSource } from './daylight.js';
import { headlineSource } from './headline.js';

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
    case 'google-calendar':
      return googleCalendarSource(cfg);
    case 'todo':
      return todoSource(cfg);
    case 'docker':
      return dockerSource(cfg);
    case 'locals':
      return localsSource(cfg);
    case 'daylight':
      return daylightSource(cfg);
    case 'headline':
      return headlineSource(cfg);
    default: {
      const _exhaustive: never = cfg;
      throw new Error(`Unknown source type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function buildSources(config: ReveilleConfig): Source[] {
  const fallbackMs = config.app.refresh * 1000;
  return config.sources.map((cfg) => {
    const source = buildSource(cfg);
    return source.ttl ? source : { ...source, ttl: fallbackMs };
  });
}
