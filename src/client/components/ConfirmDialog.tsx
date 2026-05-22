import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  isBusy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', isBusy = false, onCancel, onConfirm }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => cancelRef.current?.focus(), 0);

    return () => {
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !isBusy) {
      onCancel();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onKeyDown={handleKeyDown}>
        <div className="dialog__icon dialog__icon--danger">
          <AlertTriangle aria-hidden="true" size={22} />
        </div>
        <div className="dialog__body">
          <h2 id="confirm-title">{title}</h2>
          <p>{message}</p>
          <div className="dialog__actions">
            <button className="button button--secondary" type="button" onClick={onCancel} disabled={isBusy} ref={cancelRef}>
              Cancel
            </button>
            <button className="button button--danger" type="button" onClick={onConfirm} disabled={isBusy}>
              {isBusy ? 'Deleting...' : confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
