/// <reference lib="dom" />

/**
 * Thin wrappers over the runtime's native `fetch` (undici under the hood on
 * Node 20+). Every request is abortable and timeout-bounded — this is the whole
 * reason we target a modern runtime.
 */

export interface FetchOptions extends RequestInit {
  /** Abort the request after this many milliseconds. Default: 10_000. */
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} ${statusText} for ${url}`);
    this.name = 'HttpError';
  }
}

/**
 * `fetch` with a hard timeout. Any caller-supplied `signal` is combined with the
 * timeout signal via `AbortSignal.any`, so either can abort the request.
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: FetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 10_000, signal, ...init } = options;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return fetch(url, { ...init, signal: AbortSignal.any(signals) });
}

/** `fetchWithTimeout` that asserts a 2xx response and parses JSON. */
export async function fetchJson<T>(url: string | URL, options: FetchOptions = {}): Promise<T> {
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: { accept: 'application/json', ...options.headers },
  });
  if (!res.ok) {
    throw new HttpError(res.status, res.statusText, String(url));
  }
  return (await res.json()) as T;
}
