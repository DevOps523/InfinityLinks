import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '../auth/types';

type AccountMenuProps = {
  user: SessionUser;
  onChangePassword: () => void;
  onSignOut: () => Promise<void>;
};

function roleLabel(role: SessionUser['role']) {
  return role === 'admin' ? 'Admin' : 'Superadmin';
}

function accountInitial(email: string) {
  return email.trim().charAt(0).toUpperCase() || 'U';
}

export function AccountMenu({ user, onChangePassword, onSignOut }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initial = accountInitial(user.email);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isOpen]);

  function openChangePassword() {
    setError(null);
    setIsOpen(false);
    onChangePassword();
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
    <div className="account-menu" ref={menuRef}>
      <button
        ref={triggerRef}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Open profile menu"
        className="account-menu__trigger"
        onClick={() => {
          setError(null);
          setIsOpen((currentValue) => !currentValue);
        }}
        type="button"
      >
        <span className="account-menu__avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="account-menu__trigger-text">
          <strong>{user.email}</strong>
          <span>{roleLabel(user.role)}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={isOpen ? 'account-menu__chevron account-menu__chevron--open' : 'account-menu__chevron'}
          size={18}
        />
      </button>

      {isOpen ? (
        <div className="account-menu__dropdown" role="menu" aria-label="Profile menu">
          <div className="account-menu__section">
            <button className="account-menu__item" onClick={openChangePassword} role="menuitem" type="button">
              <KeyRound aria-hidden="true" size={18} />
              <span>Change password</span>
            </button>
          </div>

          <div className="account-menu__section account-menu__section--last">
            <button
              className="account-menu__item account-menu__item--danger"
              disabled={isSigningOut}
              onClick={() => void submitSignOut()}
              role="menuitem"
              type="button"
            >
              <LogOut aria-hidden="true" size={18} />
              <span>{isSigningOut ? 'Signing out...' : 'Sign out'}</span>
            </button>
          </div>

          {error ? (
            <div className="state-panel state-panel--error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
