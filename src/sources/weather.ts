import type { WeatherSourceConfig } from '../config/schema.js';
import { fetchJson } from '../core/http.js';
import { resolveSecret } from '../core/secrets.js';
import type { Source } from '../core/source.js';

/** The subset of the OpenWeather 2.5 `/weather` response we actually read. */
interface OpenWeatherResponse {
  name?: string;
  main?: { temp?: number; feels_like?: number; humidity?: number };
  weather?: Array<{ description?: string }>;
  wind?: { speed?: number };
  /** Present only when it's raining; keyed by window, e.g. `{ "1h": 0.5 }` (mm). */
  rain?: Record<string, number>;
  /** Present only when it's snowing; same shape as `rain`. */
  snow?: Record<string, number>;
}

/** Normalized current-conditions payload handed to the panel. */
export interface WeatherData {
  location: string;
  temp: number | null;
  feelsLike: number | null;
  description: string;
  humidity: number | null;
  windSpeed: number | null;
  /** Current precipitation over the last hour (mm), or null when dry. */
  precipMm: number | null;
  precipKind: 'rain' | 'snow' | null;
}

/**
 * Current conditions from an OpenWeather 2.5 `/weather` endpoint. The API key can
 * be baked into the configured `url` as `appid`, or supplied via `secret` — resolved
 * from the keychain/env and appended as the `appid` query param.
 */
export function weatherSource(cfg: WeatherSourceConfig): Source<WeatherData> {
  return {
    id: cfg.id,
    kind: 'weather',
    label: cfg.title ?? 'Weather',
    // Free-tier data refreshes roughly every 10 minutes; default to matching that.
    ttl: (cfg.refresh ?? 600) * 1000,
    timeout: 10_000,
    async fetch(ctx) {
      const url = new URL(cfg.url);
      if (cfg.secret) {
        url.searchParams.set('appid', await resolveSecret(cfg.secret, ctx.secrets));
      }
      const res = await fetchJson<OpenWeatherResponse>(url, { signal: ctx.signal });
      // OpenWeather only includes `rain`/`snow` while it's actively precipitating,
      // preferring the 1h window and falling back to 3h.
      const rain = res.rain?.['1h'] ?? res.rain?.['3h'];
      const snow = res.snow?.['1h'] ?? res.snow?.['3h'];
      return {
        location: res.name ?? cfg.title ?? 'Weather',
        temp: res.main?.temp ?? null,
        feelsLike: res.main?.feels_like ?? null,
        description: res.weather?.[0]?.description ?? '',
        humidity: res.main?.humidity ?? null,
        windSpeed: res.wind?.speed ?? null,
        precipMm: rain ?? snow ?? null,
        precipKind: rain != null ? 'rain' : snow != null ? 'snow' : null,
      };
    },
  };
}
