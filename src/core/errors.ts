import { HttpError } from '../core/http.js';

export function friendlyError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401) return 'Unauthorized: check your credentials';
    if (err.status === 403) return 'Forbidden: check your credentials';
    if (err.status === 404) return 'Not found: check your config';
    if (err.status === 429) return 'Too many requests: check your rate limits';
    if (err.status >= 500) return 'Server error: try again later';
    return `HTTP error ${err.status}: ${err.message}`;
  }

  const e = err as (NodeJS.ErrnoException & { name?: string }) | null;

  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
    return 'Request timed out: check your network connection';
  }

  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (message.startsWith('could not resolve secret reference')) {
    return 'missing credentials: check your keychain or config';
  }

  const code = e?.code;

  if (code === 'ECONNREFUSED') {
    return 'Connection refused: check your network connection';
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Host not found: check your network connection';
  }

  return message.split('\n')[0] || 'An unknown error occurred';
}
