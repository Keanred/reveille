import type { HttpJsonSourceConfig } from '../config/schema.js';
import { fetchJson } from '../core/http.js';
import { resolveSecret } from '../core/secrets.js';
import type { Source } from '../core/source.js';

export function httpJsonSource(cfg: HttpJsonSourceConfig): Source<unknown> {
  return {
    id: cfg.id,
    kind: 'http-json',
    label: cfg.title ?? cfg.url,
    ttl: (cfg.refresh ?? 60) * 1000,
    timeout: 10_000,
    async fetch(ctx) {
      const headers: Record<string, string> = {};
      if (cfg.secret) {
        const token = await resolveSecret(cfg.secret, ctx.secrets);
        headers.authorization = `Bearer ${token}`;
      }
      return fetchJson<unknown>(cfg.url, { signal: ctx.signal, headers });
    },
  };
}
