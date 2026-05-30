import { apiJson } from '../api/http';
import type { SessionUser } from './types';

type CurrentUserResponse = {
  user: SessionUser | null;
};

type TemporaryPasswordResponse = {
  temporaryPassword: string;
};

function getContentType(response: Response) {
  return response.headers?.get?.('content-type')?.toLowerCase() ?? '';
}

async function readJsonObject(response: Response, message: string) {
  const contentType = getContentType(response);

  if (contentType && !contentType.includes('application/json')) {
    throw new Error(message);
  }

  try {
    const payload = (await response.json()) as unknown;

    if (payload && typeof payload === 'object') {
      return payload as Record<string, unknown>;
    }
  } catch {
    throw new Error(message);
  }

  throw new Error(message);
}

export async function fetchCurrentUser() {
  const payload = await apiJson<CurrentUserResponse>('/api/auth/me');
  return payload?.user ?? null;
}

export async function loginWithCredentials(email: string, password: string) {
  const csrfResponse = await fetch('/auth/csrf', {
    credentials: 'same-origin'
  });

  if (!csrfResponse.ok) {
    throw new Error('Login failed. Please try again.');
  }

  const csrf = await readJsonObject(csrfResponse, 'Login failed. Please try again.');
  if (typeof csrf.csrfToken !== 'string') {
    throw new Error('Login failed. Please try again.');
  }

  const body = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email,
    password,
    redirect: 'false',
    json: 'true'
  });

  const response = await fetch('/auth/callback/credentials', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok || response.redirected) {
    throw new Error('Invalid email or password.');
  }

  const payload = await readJsonObject(response, 'Invalid email or password.');
  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new Error('Invalid email or password.');
  }

  if (payload.ok !== true) {
    throw new Error('Invalid email or password.');
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await apiJson('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export async function signOut() {
  const csrfResponse = await fetch('/auth/csrf', {
    credentials: 'same-origin'
  });

  if (!csrfResponse.ok) {
    throw new Error('Sign out failed. Please try again.');
  }

  const csrf = await readJsonObject(csrfResponse, 'Sign out failed. Please try again.');
  if (typeof csrf.csrfToken !== 'string') {
    throw new Error('Sign out failed. Please try again.');
  }

  const body = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    redirect: 'false',
    json: 'true'
  });

  const response = await fetch('/auth/signout', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok || response.redirected) {
    throw new Error('Sign out failed. Please try again.');
  }

  const payload = await readJsonObject(response, 'Sign out failed. Please try again.');
  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new Error('Sign out failed. Please try again.');
  }

  if (payload.ok === false) {
    throw new Error('Sign out failed. Please try again.');
  }
}

export type { TemporaryPasswordResponse };
