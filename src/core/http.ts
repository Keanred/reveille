/// <reference lib="dom" />

export interface FetchOptions extends RequestInit {
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

export async function fetchWithTimeout(
  url: string | URL,
  options: FetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 10_000, signal, ...init } = options;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return fetch(url, { ...init, signal: AbortSignal.any(signals) });
}

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
