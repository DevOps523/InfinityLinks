export function withFetchTimeout(fetcher: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = init.signal;

    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      return await fetcher(input, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  };
}
