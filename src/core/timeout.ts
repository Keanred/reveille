export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export interface WithTimeoutOptions {
  signal?: AbortSignal;
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  options: WithTimeoutOptions = {},
): Promise<T> {
  const { signal: parent } = options;

  if (parent?.aborted) {
    throw parent.reason instanceof Error ? parent.reason : new Error('Aborted');
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;

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
