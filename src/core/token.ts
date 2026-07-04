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

/**
 * Provider for a static Personal Access Token: resolve it from the keychain/env
 * once and cache it. `invalidate()` drops the cache so a 401 re-reads the store
 * (e.g. after the user rotates the token). A PAT never expires on a timer, so no
 * refresh logic is needed.
 */
export function patProvider(secretRef: string, secrets: SecretStore): TokenProvider {
  return createTokenProvider(() => resolveSecret(secretRef, secrets));
}

export interface RefreshResult {
  accessToken: string;
  expiresInSec: number;
}

/**
 * Provider for a token that expires on a timer (e.g. an OAuth access token). The
 * injected `refresh` mints a new token; we cache it and hand it back until it is
 * within `skewMs` of expiry, then refresh again. `now` is injectable so the expiry
 * logic is deterministically testable.
 *
 * Unlike {@link createTokenProvider}, this implements the contract directly so
 * `token()` re-checks expiry on every call — wrapping the cached-string provider
 * would short-circuit that. Concurrent callers share a single in-flight refresh.
 */
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
