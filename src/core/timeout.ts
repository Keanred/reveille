/**
 * Hard-deadline helper built on AbortController.
 *
 * `withTimeout` hands the work an AbortSignal and guarantees the returned promise
 * settles within `ms`: on expiry it aborts the signal (so well-behaved callers
 * like `fetch` actually cancel) *and* rejects with a TimeoutError (so callers
 * that ignore the signal can't hang the dashboard). A parent signal can abort it
 * early. This is the resilience primitive the orchestrator is built on.
 */

export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export interface WithTimeoutOptions {
  /** Aborts the work early (e.g. on unmount). Combined with the timeout. */
  signal?: AbortSignal;
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  options: WithTimeoutOptions = {},
): Promise<T> {
  const { signal: parent } = options;

  // Already cancelled: reject without ever starting the work.
  if (parent?.aborted) {
    throw parent.reason instanceof Error ? parent.reason : new Error('Aborted');
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;

  // A promise that rejects when the deadline elapses or the parent aborts.
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new TimeoutError(ms);
      controller.abort(err);
      reject(err);
    }, ms);

    if (parent) {
      onParentAbort = () => {
        const reason = parent.reason instanceof Error ? parent.reason : new Error('Aborted');
        controller.abort(reason);
        reject(reason);
      };
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  });

  try {
    return await Promise.race([fn(controller.signal), guard]);
  } finally {
    if (timer) clearTimeout(timer);
    if (parent && onParentAbort) parent.removeEventListener('abort', onParentAbort);
  }
}
