export type UserRole = 'admin' | 'superadmin';

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
};

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signed-out'; user: null }
  | { status: 'signed-in'; user: SessionUser };
