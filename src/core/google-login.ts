import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CALENDAR_READONLY_SCOPE,
  GOOGLE_REFRESH_ACCOUNT,
  googleExchangeCode,
} from './google-oauth.js';
import type { SecretStore } from './secrets.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: params.scope,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    state: params.state,
  }).toString();
  return url.toString();
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    }).unref();
  } catch {
    // noop
  }
}

interface Loopback {
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
}

function startLoopback(expectedState: string, timeoutMs: number): Promise<Loopback> {
  return new Promise((resolveServer, rejectServer) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const code = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const reply = (msg: string) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><body style="font:16px sans-serif;padding:2rem">
                    <p>${msg}</p><p>You can close this tab and return to the terminal.</p>`);
      };

      const err = url.searchParams.get('error');
      const gotState = url.searchParams.get('state');
      const gotCode = url.searchParams.get('code');

      if (err) {
        reply(`Authorization failed: ${err}`);
        rejectCode(new Error(`authorization denied: ${err}`));
      } else if (gotState !== expectedState) {
        reply('State mismatch — aborting for safety.');
        rejectCode(new Error('state mismatch (possible CSRF); aborted'));
      } else if (!gotCode) {
        reply('No authorization code received.');
      } else {
        reply('Authorized ✓');
        resolveCode(gotCode);
      }
    });

    const timer = setTimeout(
      () => rejectCode(new Error('login timed out waiting for authorization')),
      timeoutMs,
    );

    server.on('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolveServer({
        redirectUri: `http://127.0.0.1:${port}`,
        waitForCode: () => code,
        close: () => {
          clearTimeout(timer);
          server.close();
        },
      });
    });
  });
}

export interface LoginOptions {
  clientId: string;
  clientSecret: string;
  secrets: SecretStore;
  scope?: string;
  timeoutMs?: number;
  openBrowser?: (url: string) => void;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

export async function loginGoogle(opts: LoginOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const open = opts.openBrowser ?? openBrowser;
  const scope = opts.scope ?? CALENDAR_READONLY_SCOPE;

  const { verifier, challenge } = generatePkce();
  const state = base64url(randomBytes(16));
  const loopback = await startLoopback(state, opts.timeoutMs ?? 120_000);

  try {
    const authUrl = buildAuthUrl({
      clientId: opts.clientId,
      redirectUri: loopback.redirectUri,
      scope,
      challenge,
      state,
    });

    log('Opening your browser to authorize reveille…');
    log(`If it doesn't open, visit:\n${authUrl}`);
    open(authUrl);

    const code = await loopback.waitForCode();
    const tokens = await googleExchangeCode(
      {
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        code,
        redirectUri: loopback.redirectUri,
        codeVerifier: verifier,
      },
      opts.signal,
    );

    await opts.secrets.set(GOOGLE_REFRESH_ACCOUNT, tokens.refreshToken);
    log('✓ Logged in — refresh token stored in your keychain.');
  } finally {
    loopback.close();
  }
}
