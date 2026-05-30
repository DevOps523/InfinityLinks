import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import type { SessionUser } from '../auth/types';

type AccountMenuProps = {
  user: SessionUser;
  onChangePassword: () => void;
  onSignOut: () => Promise<void>;
};

function roleLabel(role: SessionUser['role']) {
  return role === 'admin' ? 'Admin' : 'Superadmin';
}

export function AccountMenu({ user, onChangePassword, onSignOut }: AccountMenuProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitSignOut() {
    setError(null);
    setIsSigningOut(true);

    try {
      await onSignOut();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Sign out failed. Please try again.');
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="account-menu">
      <div className="account-menu__identity">
        <strong>{user.email}</strong>
        <span>{roleLabel(user.role)}</span>
      </div>
      <div className="account-menu__actions">
        <button
          aria-label="Change password"
          className="button button--secondary account-menu__button"
          onClick={onChangePassword}
          title="Change password"
          type="button"
        >
          <KeyRound aria-hidden="true" size={18} />
        </button>
        <button
          aria-label="Sign out"
          className="button button--secondary account-menu__button"
          disabled={isSigningOut}
          onClick={() => void submitSignOut()}
          title="Sign out"
          type="button"
        >
          <LogOut aria-hidden="true" size={18} />
        </button>
      </div>
      {error ? (
        <div className="state-panel state-panel--error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
