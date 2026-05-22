import { AlertTriangle } from 'lucide-react';
import { useRef } from 'react';
import { useModalFocus } from './useModalFocus';

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
  const dialogRef = useRef<HTMLElement>(null);
  const handleKeyDown = useModalFocus({
    open,
    dialogRef,
    initialFocusRef: cancelRef,
    onClose: onCancel,
    closeOnEscape: !isBusy
  });

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" ref={dialogRef} onKeyDown={handleKeyDown}>
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
