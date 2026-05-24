import { Edit, MoreVertical, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ActionMenuProps = {
  extraActions?: Array<{
    label: string;
    icon: LucideIcon;
    onSelect: () => void;
  }>;
  onEdit: () => void;
  onDelete: () => void;
};

export function ActionMenu({ extraActions = [], onEdit, onDelete }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return;
    }

    function updatePanelPosition() {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      const rect = root.getBoundingClientRect();
      const panelWidth = panelRef.current?.offsetWidth ?? 164;
      const panelHeight = panelRef.current?.offsetHeight ?? (extraActions.length + 2) * 40 + 12;
      const viewportPadding = 8;
      const gap = 6;
      const maxLeft = window.innerWidth - panelWidth - viewportPadding;
      const left = Math.max(viewportPadding, Math.min(rect.right - panelWidth, maxLeft));
      const opensDown = rect.bottom + gap + panelHeight <= window.innerHeight - viewportPadding;
      const preferredTop = opensDown ? rect.bottom + gap : rect.top - panelHeight - gap;
      const maxTop = window.innerHeight - panelHeight - viewportPadding;
      const top = Math.max(viewportPadding, Math.min(preferredTop, maxTop));

      setPanelPosition({ left, top });
    }

    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);

    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [extraActions.length, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
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
    window.setTimeout(() => firstButtonRef.current?.focus(), 0);

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
      {open && panelPosition
        ? createPortal(
            <div
              className="action-menu__panel"
              id={menuId}
              ref={panelRef}
              role="menu"
              style={{ left: panelPosition.left, top: panelPosition.top }}
            >
              {extraActions.map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    className="action-menu__item"
                    type="button"
                    role="menuitem"
                    ref={index === 0 ? firstButtonRef : undefined}
                    key={action.label}
                    onClick={() => {
                      setOpen(false);
                      action.onSelect();
                    }}
                  >
                    <Icon aria-hidden="true" size={16} />
                    {action.label}
                  </button>
                );
              })}
              <button
                className="action-menu__item"
                type="button"
                role="menuitem"
                ref={extraActions.length === 0 ? firstButtonRef : undefined}
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
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
