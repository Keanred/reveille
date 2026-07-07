import { fetchWithTimeout } from './http.js';
import { refreshingProvider, type RefreshResult, type TokenProvider } from './token.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export const GOOGLE_REFRESH_ACCOUNT = 'google-refresh';

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export async function googleRefresh(
  creds: GoogleCredentials,
  signal?: AbortSignal,
): Promise<RefreshResult> {
  const res = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal,
  });

  const data: TokenResponse = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new Error(`Google token refresh failed: ${describeTokenError(data, res)}`);
  }

  return { accessToken: data.access_token, expiresInSec: data.expires_in ?? 3600 };
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export async function googleExchangeCode(
  params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
  signal?: AbortSignal,
): Promise<GoogleTokens> {
  const res = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
    }),
    signal,
  });

  const data: TokenResponse = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token || !data.refresh_token) {
    const why =
      res.ok && !data.refresh_token ? 'no refresh_token returned' : describeTokenError(data, res);
    throw new Error(`Google code exchange failed: ${why}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSec: data.expires_in ?? 3600,
  };
}

function describeTokenError(data: TokenResponse, res: Response): string {
  if (data.error === 'invalid_grant') {
    return 'refresh token expired or revoked — run `reveille login google` again';
  }
  return data.error_description ?? data.error ?? `${res.status} ${res.statusText}`;
}

export function googleTokenProvider(
  creds: GoogleCredentials,
  opts: { now?: () => number; signal?: AbortSignal } = {},
): TokenProvider {
  return refreshingProvider(() => googleRefresh(creds, opts.signal), opts.now);
}
