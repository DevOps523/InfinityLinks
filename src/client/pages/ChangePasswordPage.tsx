import { LogOut, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { SessionUser } from '../auth/types';

type ChangePasswordPageProps = {
  user: SessionUser;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function ChangePasswordPage({ user, onChangePassword, onSignOut }: ChangePasswordPageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onChangePassword(currentPassword, newPassword);
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : 'Password change failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

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
    <main className="content-shell">
      <section className="page-section">
        <header className="page-header">
          <div>
            <h1>Change password</h1>
            <p>Create a permanent password before continuing.</p>
          </div>
          <button className="button button--secondary" disabled={isSigningOut} onClick={() => void submitSignOut()} type="button">
            <LogOut aria-hidden="true" size={18} />
            {isSigningOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </header>

        <form className="form-panel" onSubmit={submitPasswordChange}>
          <div>
            <strong>{user.email}</strong>
            <p className="field-hint">This account requires a password change.</p>
          </div>

          <label>
            Current password
            <input
              autoComplete="current-password"
              name="currentPassword"
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </label>

          <label>
            New password
            <input
              autoComplete="new-password"
              name="newPassword"
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </label>

          {error ? (
            <div className="state-panel state-panel--error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="form-actions">
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              <Save aria-hidden="true" size={18} />
              {isSubmitting ? 'Saving...' : 'Save password'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
