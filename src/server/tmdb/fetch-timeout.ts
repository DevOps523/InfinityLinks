export type TmdbFetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
};

export type TmdbFetchWithInit = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<TmdbFetchResponse>;

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

export function withFetchTimeout(fetcher: TmdbFetchWithInit, timeoutMs: number): TmdbFetchWithInit {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const callerSignal = init.signal;
    let isSettled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const abortFromCaller = () => controller.abort();

    const cleanup = () => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    };

    timeout = setTimeout(() => {
      controller.abort();
      cleanup();
    }, timeoutMs);

    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    let response: TmdbFetchResponse;
    try {
      response = await Promise.race([
        fetcher(input, {
          ...init,
          signal: controller.signal
        }),
        waitForAbort(controller.signal)
      ]);
    } catch (error) {
      cleanup();
      throw error;
    }

    if (!response.ok) {
      cleanup();
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: async () => {
        try {
          return await Promise.race([response.json(), waitForAbort(controller.signal)]);
        } finally {
          cleanup();
        }
      }
    };
  };
}
