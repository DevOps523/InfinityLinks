import { apiJson } from '../api/http';
import type { SessionUser, UserRole } from './types';

type CurrentUserResponse = {
  user: SessionUser | null;
};

type TemporaryPasswordResponse = {
  temporaryPassword: string;
};

export type ManagedUser = {
  id: number;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type UsersResponse = {
  users?: ManagedUser[];
};

type UserWithTemporaryPasswordResponse = {
  user: ManagedUser;
  temporaryPassword: string;
};

type UserResponse = {
  user: ManagedUser;
};

const AUTH_RETURN_REDIRECT_HEADER = 'X-Auth-Return-Redirect';

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

function getAuthRedirectUrl(payload: Record<string, unknown>, message: string) {
  if (typeof payload.url !== 'string') {
    throw new Error(message);
  }

  return new URL(payload.url, window.location.origin);
}

function hasAuthError(url: URL) {
  return url.searchParams.has('error');
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
      'Content-Type': 'application/x-www-form-urlencoded',
      [AUTH_RETURN_REDIRECT_HEADER]: '1'
    }
  });

  if (!response.ok || response.redirected) {
    throw new Error('Invalid email or password.');
  }

  const payload = await readJsonObject(response, 'Invalid email or password.');
  const redirectUrl = getAuthRedirectUrl(payload, 'Invalid email or password.');

  if (hasAuthError(redirectUrl)) {
    throw new Error('Invalid email or password.');
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await apiJson('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export async function fetchUsers() {
  const payload = await apiJson<UsersResponse>('/api/admin/users');
  return payload?.users ?? [];
}

export async function createUser(input: { email: string; role: UserRole }) {
  return apiJson<UserWithTemporaryPasswordResponse>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input)
  }) as Promise<UserWithTemporaryPasswordResponse>;
}

export async function resetUserPassword(id: number) {
  return apiJson<UserWithTemporaryPasswordResponse>(`/api/admin/users/${id}/reset-password`, {
    method: 'POST'
  }) as Promise<UserWithTemporaryPasswordResponse>;
}

export async function updateUser(id: number, input: { email: string; role: UserRole }) {
  return apiJson<UserResponse>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  }) as Promise<UserResponse>;
}

export async function deleteUser(id: number) {
  await apiJson(`/api/admin/users/${id}`, {
    method: 'DELETE'
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
      'Content-Type': 'application/x-www-form-urlencoded',
      [AUTH_RETURN_REDIRECT_HEADER]: '1'
    }
  });

  if (!response.ok || response.redirected) {
    throw new Error('Sign out failed. Please try again.');
  }

  const payload = await readJsonObject(response, 'Sign out failed. Please try again.');
  const redirectUrl = getAuthRedirectUrl(payload, 'Sign out failed. Please try again.');

  if (hasAuthError(redirectUrl)) {
    throw new Error('Sign out failed. Please try again.');
  }
}

export type { TemporaryPasswordResponse };
