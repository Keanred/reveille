import type { SecretStore } from './secrets.js';
import { resolveSecret } from './secrets.js';

export interface TokenProvider {
  token(): Promise<string>;
  invalidate(): void;
}

export function createTokenProvider(getToken: () => Promise<string>): TokenProvider {
  let cached: string | null = null;
  return {
    async token() {
      if (cached === null) {
        cached = await getToken();
      }
      return cached;
    },
    invalidate() {
      cached = null;
    },
  };
}

export function patProvider(secretRef: string, secrets: SecretStore): TokenProvider {
  return createTokenProvider(() => resolveSecret(secretRef, secrets));
}

export interface RefreshResult {
  accessToken: string;
  expiresInSec: number;
}

export function refreshingProvider(
  refresh: () => Promise<RefreshResult>,
  now: () => number = Date.now,
  skewMs = 60_000,
): TokenProvider {
  let cached: { accessToken: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  return {
    async token() {
      if (cached && now() + skewMs < cached.expiresAt) return cached.accessToken;
      if (!inflight) {
        inflight = (async () => {
          const { accessToken, expiresInSec } = await refresh();
          cached = { accessToken, expiresAt: now() + expiresInSec * 1000 };
          return accessToken;
        })().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}
