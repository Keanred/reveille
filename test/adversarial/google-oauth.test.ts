import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  googleRefresh,
  googleTokenProvider,
  type GoogleCredentials,
} from '../../src/core/google-oauth.js';

const creds: GoogleCredentials = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' };

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('googleRefresh', () => {
  it('posts the refresh grant and returns the access token + lifetime', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenResponse({ access_token: 'at', expires_in: 3599 }));

    expect(await googleRefresh(creds)).toEqual({ accessToken: 'at', expiresInSec: 3599 });

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
    const params = init?.body as URLSearchParams;
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('client_id')).toBe('cid');
    expect(params.get('client_secret')).toBe('secret');
    expect(params.get('refresh_token')).toBe('rt');
  });

  it('defaults the lifetime to 1h when expires_in is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse({ access_token: 'at' }));
    expect(await googleRefresh(creds)).toEqual({ accessToken: 'at', expiresInSec: 3600 });
  });

  it('throws an actionable message when the refresh token is dead (invalid_grant)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse(
        { error: 'invalid_grant', error_description: 'Token expired or revoked.' },
        400,
      ),
    );
    await expect(googleRefresh(creds)).rejects.toThrow(/reveille login google/);
  });

  it('throws with the status on other non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 500, statusText: 'Server Error' }),
    );
    await expect(googleRefresh(creds)).rejects.toThrow(/Google token refresh failed/);
  });

  it('treats a 200 with no access_token as a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse({ scope: 'calendar' }));
    await expect(googleRefresh(creds)).rejects.toThrow(/Google token refresh failed/);
  });
});

describe('googleTokenProvider', () => {
  it('caches the access token and refreshes only once it nears expiry', async () => {
    let t = 0;
    let minted = 0;
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        tokenResponse({ access_token: `at-${++minted}`, expires_in: 3600 }),
      );

    const provider = googleTokenProvider(creds, { now: () => t });

    expect(await provider.token()).toBe('at-1');
    t += 30 * 60_000; // +30 min — still fresh
    expect(await provider.token()).toBe('at-1');
    expect(spy).toHaveBeenCalledTimes(1);

    t += 30 * 60_000; // within the 60s skew of the 1h expiry → refresh
    expect(await provider.token()).toBe('at-2');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
