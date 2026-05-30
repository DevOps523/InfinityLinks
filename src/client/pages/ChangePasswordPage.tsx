import { Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';

type ChangePasswordPageProps = {
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

export function ChangePasswordPage({ onChangePassword }: ChangePasswordPageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  return (
    <main className="content-shell">
      <section className="page-section">
        <header className="page-header">
          <div>
            <h1>Change password</h1>
            <p>Create a permanent password before continuing.</p>
          </div>
        </header>

        <form className="form-panel" onSubmit={submitPasswordChange}>
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
