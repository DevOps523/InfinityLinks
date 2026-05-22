import { Edit, MoreVertical, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

type ActionMenuProps = {
  onEdit: () => void;
  onDelete: () => void;
};

export function ActionMenu({ onEdit, onDelete }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => editButtonRef.current?.focus(), 0);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="action-menu" ref={rootRef}>
      <button
        className="icon-button"
        type="button"
        aria-label="Open action menu"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical aria-hidden="true" size={18} />
      </button>
      {open ? (
        <div className="action-menu__panel" id={menuId} role="menu">
          <button
            className="action-menu__item"
            type="button"
            role="menuitem"
            ref={editButtonRef}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Edit aria-hidden="true" size={16} />
            Edit
          </button>
          <button
            className="action-menu__item action-menu__item--danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 aria-hidden="true" size={16} />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
