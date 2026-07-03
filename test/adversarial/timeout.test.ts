import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from '../../src/core/timeout.js';

describe('withTimeout', () => {
  it('resolves with the value when the work finishes in time', async () => {
    await expect(withTimeout(async () => 42, 1000)).resolves.toBe(42);
  });

  it('rejects with TimeoutError and aborts the work signal once the deadline passes', async () => {
    let aborted = false;
    const promise = withTimeout<never>(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
      5,
    );

    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it('rejects early when the parent signal aborts', async () => {
    const parent = new AbortController();
    const promise = withTimeout<never>(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      10_000,
      { signal: parent.signal },
    );

    parent.abort(new Error('unmounted'));
    await expect(promise).rejects.toThrow('unmounted');
  });

  it('rejects immediately when the parent signal is already aborted', async () => {
    const parent = new AbortController();
    parent.abort(new Error('gone'));
    await expect(withTimeout(async () => 1, 1000, { signal: parent.signal })).rejects.toThrow(
      'gone',
    );
  });
});
