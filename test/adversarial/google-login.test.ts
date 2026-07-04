import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleExchangeCode } from '../../src/core/google-oauth.js';
import { buildAuthUrl, generatePkce } from '../../src/core/google-login.js';

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const b64url = (buf: Buffer) =>
  buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

afterEach(() => vi.restoreAllMocks());

describe('generatePkce', () => {
  it('produces a url-safe verifier and a matching S256 challenge', () => {
    const { verifier, challenge } = generatePkce();

    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    // The challenge must be the base64url SHA-256 of the verifier (no padding).
    expect(challenge).toBe(b64url(createHash('sha256').update(verifier).digest()));
    expect(challenge).not.toContain('=');
  });

  it('is random per call', () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

describe('buildAuthUrl', () => {
  it('includes the params that make Google return a refresh token', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:5000',
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        challenge: 'chal',
        state: 'st',
      }),
    );
    const p = url.searchParams;

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:5000');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('access_type')).toBe('offline'); // → refresh token
    expect(p.get('prompt')).toBe('consent'); // → re-issued every login
    expect(p.get('code_challenge')).toBe('chal');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('st');
  });
});

describe('googleExchangeCode', () => {
  const params = {
    clientId: 'cid',
    clientSecret: 'secret',
    code: 'auth-code',
    redirectUri: 'http://127.0.0.1:5000',
    codeVerifier: 'verifier',
  };

  it('exchanges the code and returns the token set including the refresh token', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
      );

    expect(await googleExchangeCode(params)).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresInSec: 3600,
    });

    const body = spy.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBe('verifier');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:5000');
  });

  it('fails clearly when Google returns no refresh token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ access_token: 'at', expires_in: 3600 }),
    );
    await expect(googleExchangeCode(params)).rejects.toThrow(/no refresh_token/);
  });

  it('surfaces an OAuth error from a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ error: 'invalid_grant', error_description: 'bad code' }, 400),
    );
    await expect(googleExchangeCode(params)).rejects.toThrow(/Google code exchange failed/);
  });
});
