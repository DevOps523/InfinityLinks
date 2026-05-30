import { Copy, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createUser, fetchUsers, resetUserPassword, type ManagedUser } from '../auth/auth-api';
import type { UserRole } from '../auth/types';
import { useToast } from '../components/ToastProvider';

type TemporaryPasswordState = {
  email: string;
  password: string;
};

function roleLabel(role: UserRole) {
  return role === 'admin' ? 'Admin' : 'Superadmin';
}

function upsertUser(users: ManagedUser[], updatedUser: ManagedUser) {
  const existingIndex = users.findIndex((user) => user.id === updatedUser.id);

  if (existingIndex === -1) {
    return [...users, updatedUser];
  }

  return users.map((user) => (user.id === updatedUser.id ? updatedUser : user));
}

export function UsersPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('superadmin');
  const [isCreating, setIsCreating] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<TemporaryPasswordState | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadUsers() {
      setIsLoading(true);
      setError(null);

      try {
        const loadedUsers = await fetchUsers();
        if (isActive) {
          setUsers(loadedUsers);
        }
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadUsers();

    return () => {
      isActive = false;
    };
  }, []);

  function resetForm() {
    setEmail('');
    setRole('superadmin');
    setFormError(null);
  }

  async function submitCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setFormError(null);

    try {
      const response = await createUser({ email: email.trim(), role });
      setUsers((currentUsers) => upsertUser(currentUsers, response.user));
      setTemporaryPassword({ email: response.user.email, password: response.temporaryPassword });
      setIsModalOpen(false);
      resetForm();
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'Unable to create user.');
    } finally {
      setIsCreating(false);
    }
  }

  async function submitResetPassword(user: ManagedUser) {
    setResettingUserId(user.id);
    setResetError(null);

    try {
      const response = await resetUserPassword(user.id);
      setUsers((currentUsers) => upsertUser(currentUsers, response.user));
      setTemporaryPassword({ email: response.user.email, password: response.temporaryPassword });
    } catch (resetPasswordError) {
      setResetError(resetPasswordError instanceof Error ? resetPasswordError.message : 'Unable to reset password.');
    } finally {
      setResettingUserId(null);
    }
  }

  function copyTemporaryPassword() {
    if (!temporaryPassword) {
      return;
    }

    void navigator.clipboard?.writeText(temporaryPassword.password);
    showToast('Password copied.');
  }

  return (
    <section className="page-section">
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>Manage admin access and password resets.</p>
        </div>
        <button className="button button--primary" onClick={() => setIsModalOpen(true)} type="button">
          <Plus aria-hidden="true" size={18} />
          Add User
        </button>
      </header>

      {temporaryPassword ? (
        <div className="state-panel users-temporary-password" role="status">
          <div>
            <strong>Temporary password for {temporaryPassword.email}</strong>
            <p>{temporaryPassword.password}</p>
          </div>
          <button className="button button--secondary" onClick={copyTemporaryPassword} type="button">
            <Copy aria-hidden="true" size={18} />
            Copy
          </button>
        </div>
      ) : null}

      {resetError ? (
        <div className="state-panel state-panel--error" role="alert">
          {resetError}
        </div>
      ) : null}

      <div className="table-card">
        {isLoading ? <div className="state-panel">Loading users...</div> : null}
        {!isLoading && error ? (
          <div className="state-panel state-panel--error" role="alert">
            {error}
          </div>
        ) : null}
        {!isLoading && !error && users.length === 0 ? <div className="state-panel">No users found.</div> : null}

        {!isLoading && !error && users.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{roleLabel(user.role)}</td>
                    <td>{user.mustChangePassword ? 'Must change password' : 'Active'}</td>
                    <td>
                      <button
                        className="button button--secondary"
                        disabled={resettingUserId === user.id}
                        onClick={() => void submitResetPassword(user)}
                        type="button"
                      >
                        <RotateCcw aria-hidden="true" size={18} />
                        {resettingUserId === user.id ? 'Resetting...' : 'Reset password'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {isModalOpen ? (
        <div className="modal-backdrop">
          <form className="modal" aria-modal="true" aria-labelledby="add-user-title" onSubmit={submitCreateUser} role="dialog">
            <div className="modal__header">
              <h2 id="add-user-title">Add User</h2>
              <button
                aria-label="Close"
                className="button button--secondary"
                disabled={isCreating}
                onClick={() => {
                  setIsModalOpen(false);
                  resetForm();
                }}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <label>
              Email
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>

            <label>
              Role
              <select name="role" onChange={(event) => setRole(event.target.value as UserRole)} value={role}>
                <option value="superadmin">Superadmin</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            {formError ? (
              <div className="state-panel state-panel--error" role="alert">
                {formError}
              </div>
            ) : null}

            <div className="form-actions">
              <button
                className="button button--secondary"
                disabled={isCreating}
                onClick={() => {
                  setIsModalOpen(false);
                  resetForm();
                }}
                type="button"
              >
                Cancel
              </button>
              <button className="button button--primary" disabled={isCreating} type="submit">
                {isCreating ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
