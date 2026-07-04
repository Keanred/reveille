import { fetchWithTimeout } from './http.js';
import { refreshingProvider, type RefreshResult, type TokenProvider } from './token.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Read-only access to the user's calendars. */
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** Keychain account (under the `reveille` service) where the refresh token is stored. */
export const GOOGLE_REFRESH_ACCOUNT = 'google-refresh';

/** The long-lived credentials needed to mint Google access tokens. */
export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** The token endpoint returns either the success fields or an OAuth error pair. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Exchange a refresh token for a fresh access token (OAuth 2.0 refresh grant).
 * Pure and abortable — mock `fetch` to test it. Throws with an actionable message
 * when the refresh token is dead (`invalid_grant`), which is the common case once
 * an unpublished app's 7-day refresh-token limit elapses.
 *
 * Note: Google does not rotate the refresh token on this grant, so there's nothing
 * new to persist here — the caller keeps reusing the same stored refresh token.
 */
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

  // Fall back to {} if the body isn't JSON (e.g. an HTML 5xx page) so we raise
  // our own clear error below rather than a parse error.
  const data: TokenResponse = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new Error(`Google token refresh failed: ${describeTokenError(data, res)}`);
  }

  // Google omits expires_in only in edge cases; default to its usual 1h.
  return { accessToken: data.access_token, expiresInSec: data.expires_in ?? 3600 };
}

/** The tokens returned when first exchanging an authorization code at login. */
export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

/**
 * Exchange a one-time authorization code (from the loopback login flow) for the
 * initial token set, including the long-lived refresh token we persist. Requires
 * the PKCE `codeVerifier` that matches the challenge sent to the auth endpoint.
 */
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

  // No refresh_token usually means a prior consent without `prompt=consent`.
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

/** Turn a failed token response into a short, actionable message. */
function describeTokenError(data: TokenResponse, res: Response): string {
  // invalid_grant means the refresh token is dead — re-login is the only fix.
  if (data.error === 'invalid_grant') {
    return 'refresh token expired or revoked — run `reveille login google` again';
  }
  return data.error_description ?? data.error ?? `${res.status} ${res.statusText}`;
}

/**
 * A {@link TokenProvider} backed by Google's refresh grant: hands out a cached
 * access token, refreshing via {@link googleRefresh} as it nears expiry. Pass
 * `now` for deterministic expiry tests and `signal` to make refreshes abortable
 * (thread `ctx.signal` from the source's `fetch`).
 */
export function googleTokenProvider(
  creds: GoogleCredentials,
  opts: { now?: () => number; signal?: AbortSignal } = {},
): TokenProvider {
  return refreshingProvider(() => googleRefresh(creds, opts.signal), opts.now);
}
