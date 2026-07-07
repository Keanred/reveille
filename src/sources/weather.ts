import type { WeatherSourceConfig } from '../config/schema.js';
import { fetchJson } from '../core/http.js';
import { resolveSecret } from '../core/secrets.js';
import type { Source } from '../core/source.js';

interface OpenWeatherResponse {
  name?: string;
  main?: { temp?: number; feels_like?: number; humidity?: number };
  weather?: Array<{ description?: string }>;
  wind?: { speed?: number };
  rain?: Record<string, number>;
  snow?: Record<string, number>;
}

export interface WeatherData {
  location: string;
  temp: number | null;
  feelsLike: number | null;
  description: string;
  humidity: number | null;
  windSpeed: number | null;
  precipMm: number | null;
  precipKind: 'rain' | 'snow' | null;
}

export function weatherSource(cfg: WeatherSourceConfig): Source<WeatherData> {
  return {
    id: cfg.id,
    kind: 'weather',
    label: cfg.title ?? 'Weather',
    ttl: (cfg.refresh ?? 600) * 1000,
    timeout: 10_000,
    async fetch(ctx) {
      const url = new URL(cfg.url);
      if (cfg.secret) {
        url.searchParams.set('appid', await resolveSecret(cfg.secret, ctx.secrets));
      }
      const res = await fetchJson<OpenWeatherResponse>(url, { signal: ctx.signal });
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
