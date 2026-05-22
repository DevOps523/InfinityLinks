export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T | undefined> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    let message = response.statusText;

    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === 'string' && payload.error.trim()) {
        message = payload.error;
      }
    } catch {
      // Fall back to statusText when the server does not return JSON.
    }

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined;
  }

  return (await response.json()) as T;
}
