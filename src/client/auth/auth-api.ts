import { apiJson } from '../api/http';
import type { SessionUser } from './types';

type CurrentUserResponse = {
  user: SessionUser | null;
};

type TemporaryPasswordResponse = {
  temporaryPassword: string;
};

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

  const csrf = (await csrfResponse.json()) as { csrfToken?: unknown };
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

  if (!response.ok) {
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
  const csrf = (await csrfResponse.json()) as { csrfToken?: unknown };
  const body = new URLSearchParams({
    csrfToken: typeof csrf.csrfToken === 'string' ? csrf.csrfToken : '',
    redirect: 'false',
    json: 'true'
  });

  await fetch('/auth/signout', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}

export type { TemporaryPasswordResponse };
