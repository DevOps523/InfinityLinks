import { Lock, LogIn, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';

type LoginPageProps = {
  onLogin: (email: string, password: string) => Promise<void>;
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onLogin(email.trim(), password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="content-shell">
      <section className="page-section">
        <header className="page-header">
          <div>
            <h1>Welcome back</h1>
            <p>Sign in to manage the InfinityLinks catalog.</p>
          </div>
        </header>

        <form className="form-panel" onSubmit={submitLogin}>
          <label>
            Email
            <span className="input-with-icon">
              <Mail aria-hidden="true" size={18} />
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </span>
          </label>

          <label>
            Password
            <span className="input-with-icon">
              <Lock aria-hidden="true" size={18} />
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </span>
          </label>

          {error ? (
            <div className="state-panel state-panel--error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="form-actions">
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              <LogIn aria-hidden="true" size={18} />
              {isSubmitting ? 'Logging in...' : 'Login'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
