import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { LoginPage } from '../pages/LoginPage';
import { changePassword, fetchCurrentUser, loginWithCredentials, signOut } from './auth-api';
import type { AuthState, SessionUser } from './types';

type AuthGateProps = {
  children: (props: {
    user: SessionUser;
    onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    onSignOut: () => Promise<void>;
  }) => ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading', user: null });
  const [sessionError, setSessionError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setSessionError(null);
    const user = await fetchCurrentUser();
    setAuthState(user ? { status: 'signed-in', user } : { status: 'signed-out', user: null });
    return user;
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadSession() {
      try {
        const user = await fetchCurrentUser();
        if (isActive) {
          setAuthState(user ? { status: 'signed-in', user } : { status: 'signed-out', user: null });
        }
      } catch (error) {
        if (isActive) {
          setSessionError(error instanceof Error ? error.message : 'Unable to load session.');
          setAuthState({ status: 'signed-out', user: null });
        }
      }
    }

    void loadSession();

    return () => {
      isActive = false;
    };
  }, []);

  async function handleLogin(email: string, password: string) {
    await loginWithCredentials(email, password);
    await refreshSession();
  }

  async function handleChangePassword(currentPassword: string, newPassword: string) {
    await changePassword(currentPassword, newPassword);
    await refreshSession();
  }

  async function handleSignOut() {
    await signOut();
    setAuthState({ status: 'signed-out', user: null });
  }

  if (authState.status === 'loading') {
    return (
      <main className="auth-page auth-loading">
        <div className="state-panel dashboard-state">Loading session...</div>
      </main>
    );
  }

  if (authState.status === 'signed-out') {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (authState.user.mustChangePassword) {
    return (
      <ChangePasswordPage
        user={authState.user}
        onChangePassword={handleChangePassword}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <>
      {sessionError ? (
        <div className="state-panel state-panel--error" role="alert">
          {sessionError}
        </div>
      ) : null}
      {children({
        user: authState.user,
        onChangePassword: handleChangePassword,
        onSignOut: handleSignOut
      })}
    </>
  );
}
