import { MoreVertical, Trash2 } from 'lucide-react';
import { useState } from 'react';

type ActionMenuProps = {
  onDelete: () => void;
};

export function ActionMenu({ onDelete }: ActionMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="action-menu">
      <button className="icon-button" type="button" aria-label="Open action menu" onClick={() => setOpen((value) => !value)}>
        <MoreVertical aria-hidden="true" size={18} />
      </button>
      {open ? (
        <div className="action-menu__panel">
          <button
            className="action-menu__item action-menu__item--danger"
            type="button"
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
