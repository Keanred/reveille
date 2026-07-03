import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, fetchWithTimeout, HttpError } from '../../src/core/http.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchJson', () => {
  it('parses JSON on a 2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"value":42}', { status: 200 }));
    expect(await fetchJson<{ value: number }>('https://x')).toEqual({ value: 42 });
  });

  it('throws HttpError on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }));
    await expect(fetchJson('https://x')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('fetchWithTimeout', () => {
  it('aborts the request once the timeout elapses', async () => {
    // A fetch that only settles when its signal aborts — simulating a hung server.
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    await expect(fetchWithTimeout('https://slow', { timeoutMs: 5 })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('aborts when a caller-supplied signal fires', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const controller = new AbortController();
    const promise = fetchWithTimeout('https://x', { timeoutMs: 10_000, signal: controller.signal });
    controller.abort(new Error('caller cancelled'));
    await expect(promise).rejects.toThrow('caller cancelled');
  });
});
