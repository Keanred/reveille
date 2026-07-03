import { describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../../src/core/secrets.js';
import { patProvider, refreshingProvider } from '../../src/core/token.js';

/** A mutable fake clock (epoch ms) so expiry is deterministic. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('refreshingProvider', () => {
  it('caches the access token until it nears expiry, then refreshes', async () => {
    const c = clock();
    const refresh = vi.fn(async () => ({ accessToken: `tok-${refresh.mock.calls.length}`, expiresInSec: 3600 }));
    const provider = refreshingProvider(refresh, c.now, 60_000);

    expect(await provider.token()).toBe('tok-1');
    c.advance(30 * 60_000); // half an hour — still fresh
    expect(await provider.token()).toBe('tok-1');
    expect(refresh).toHaveBeenCalledTimes(1);

    // Cross into the skew window (60s before the 1h expiry) → refresh.
    c.advance(30 * 60_000);
    expect(await provider.token()).toBe('tok-2');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('refreshes on every call once expired (proactive check is not short-circuited)', async () => {
    const c = clock();
    const refresh = vi.fn(async () => ({ accessToken: 'tok', expiresInSec: 0 })); // already expired
    const provider = refreshingProvider(refresh, c.now);

    await provider.token();
    await provider.token();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent refreshes into a single in-flight call', async () => {
    const c = clock();
    let resolveRefresh: (r: { accessToken: string; expiresInSec: number }) => void = () => {};
    const refresh = vi.fn(
      () => new Promise<{ accessToken: string; expiresInSec: number }>((r) => (resolveRefresh = r)),
    );
    const provider = refreshingProvider(refresh, c.now);

    const [a, b, d] = [provider.token(), provider.token(), provider.token()];
    resolveRefresh({ accessToken: 'shared', expiresInSec: 3600 });

    expect(await Promise.all([a, b, d])).toEqual(['shared', 'shared', 'shared']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces the next call to refresh', async () => {
    const c = clock();
    const refresh = vi.fn(async () => ({ accessToken: `tok-${refresh.mock.calls.length}`, expiresInSec: 3600 }));
    const provider = refreshingProvider(refresh, c.now);

    expect(await provider.token()).toBe('tok-1');
    provider.invalidate();
    expect(await provider.token()).toBe('tok-2'); // re-minted despite not being near expiry
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('patProvider', () => {
  const store = (value: string | undefined): SecretStore => ({
    get: async () => value,
    set: async () => {},
    delete: async () => false,
  });

  it('resolves the secret once and caches it', async () => {
    const secrets = store('pat-123');
    const getSpy = vi.spyOn(secrets, 'get');
    const provider = patProvider('keychain:github-token', secrets);

    expect(await provider.token()).toBe('pat-123');
    expect(await provider.token()).toBe('pat-123');
    expect(getSpy).toHaveBeenCalledTimes(1); // second call served from cache
    expect(getSpy).toHaveBeenCalledWith('github-token');
  });

  it('invalidate() re-reads the store (e.g. after a rotation)', async () => {
    let current = 'old';
    const secrets: SecretStore = { get: async () => current, set: async () => {}, delete: async () => false };
    const provider = patProvider('keychain:github-token', secrets);

    expect(await provider.token()).toBe('old');
    current = 'new';
    expect(await provider.token()).toBe('old'); // still cached
    provider.invalidate();
    expect(await provider.token()).toBe('new');
  });
});
