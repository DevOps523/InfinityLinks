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
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card__accent" aria-hidden="true" />
        <div className="auth-card__body">
          <header className="auth-card__brand">
            <div className="auth-card__mark" aria-hidden="true">
              IL
            </div>
            <div>
              <span>InfinityLinks Admin</span>
              <h1 id="login-title">Welcome back</h1>
            </div>
          </header>
          <p>Sign in to manage the InfinityLinks catalog.</p>

          <form className="auth-card__form" onSubmit={submitLogin}>
            <label>
              Email
              <span className="input-with-icon">
                <Mail aria-hidden="true" size={18} />
                <input
                  autoComplete="email"
                  className="auth-input"
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
                  className="auth-input"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </span>
            </label>

            {error ? (
              <div className="auth-card__error" role="alert">
                {error}
              </div>
            ) : null}

            <button className="button button--primary auth-card__submit" disabled={isSubmitting} type="submit">
              <LogIn aria-hidden="true" size={18} />
              {isSubmitting ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
