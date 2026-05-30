import { Copy, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createUser, deleteUser, fetchUsers, resetUserPassword, updateUser, type ManagedUser } from '../auth/auth-api';
import type { UserRole } from '../auth/types';
import { ActionMenu } from '../components/ActionMenu';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [userToDelete, setUserToDelete] = useState<ManagedUser | null>(null);
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

  function closeUserModal() {
    setIsModalOpen(false);
    setEditingUser(null);
    resetForm();
  }

  function openEditUser(user: ManagedUser) {
    setEditingUser(user);
    setEmail(user.email);
    setRole(user.role);
    setFormError(null);
    setIsModalOpen(true);
  }

  async function submitUserForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (editingUser) {
      setIsUpdating(true);
      try {
        const response = await updateUser(editingUser.id, { email: email.trim(), role });
        setUsers((currentUsers) => upsertUser(currentUsers, response.user));
        closeUserModal();
        showToast('User updated.');
      } catch (updateError) {
        setFormError(updateError instanceof Error ? updateError.message : 'Unable to update user.');
      } finally {
        setIsUpdating(false);
      }
      return;
    }

    setIsCreating(true);
    try {
      const response = await createUser({ email: email.trim(), role });
      setUsers((currentUsers) => upsertUser(currentUsers, response.user));
      setTemporaryPassword({ email: response.user.email, password: response.temporaryPassword });
      closeUserModal();
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

  async function confirmDeleteUser() {
    if (!userToDelete) {
      return;
    }

    setIsDeleting(true);

    try {
      await deleteUser(userToDelete.id);
      setUsers((currentUsers) => currentUsers.filter((user) => user.id !== userToDelete.id));
      setTemporaryPassword((currentPassword) => {
        if (currentPassword?.email === userToDelete.email) {
          return null;
        }

        return currentPassword;
      });
      setUserToDelete(null);
      showToast('User deleted.');
    } catch (deleteError) {
      showToast(deleteError instanceof Error ? deleteError.message : 'Unable to delete user.', 'error');
    } finally {
      setIsDeleting(false);
    }
  }

  function copyTemporaryPassword() {
    if (!temporaryPassword) {
      return;
    }

    void navigator.clipboard?.writeText(temporaryPassword.password);
    showToast('Password copied.');
  }

  const isSavingUser = isCreating || isUpdating;
  const modalTitle = editingUser ? 'Edit User' : 'Add User';
  const submitLabel = editingUser ? 'Save User' : 'Create User';
  const busySubmitLabel = editingUser ? 'Saving...' : 'Creating...';

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
        <div className="state-panel generated-password-panel" role="status">
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
            <table className="users-table">
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
                      <ActionMenu
                        extraActions={[
                          {
                            label: resettingUserId === user.id ? 'Resetting...' : 'Reset password',
                            icon: RotateCcw,
                            onSelect: () => void submitResetPassword(user)
                          }
                        ]}
                        onEdit={() => openEditUser(user)}
                        onDelete={() => setUserToDelete(user)}
                      />
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
          <form className="modal" aria-modal="true" aria-labelledby="user-modal-title" onSubmit={submitUserForm} role="dialog">
            <div className="modal__header">
              <h2 id="user-modal-title">{modalTitle}</h2>
              <button
                aria-label="Close"
                className="button button--secondary"
                disabled={isSavingUser}
                onClick={closeUserModal}
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
                disabled={isSavingUser}
                onClick={closeUserModal}
                type="button"
              >
                Cancel
              </button>
              <button className="button button--primary" disabled={isSavingUser} type="submit">
                {isSavingUser ? busySubmitLabel : submitLabel}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(userToDelete)}
        title="Delete user"
        message={userToDelete ? `Delete "${userToDelete.email}" permanently? They will no longer be able to sign in.` : ''}
        isBusy={isDeleting}
        onCancel={() => setUserToDelete(null)}
        onConfirm={confirmDeleteUser}
      />
    </section>
  );
}
