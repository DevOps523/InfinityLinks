import { useEffect, type KeyboardEvent, type RefObject } from 'react';

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

type UseModalFocusOptions = {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  closeOnEscape?: boolean;
};

export function useModalFocus({ open, dialogRef, initialFocusRef, onClose, closeOnEscape = true }: UseModalFocusOptions) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimeout = window.setTimeout(() => {
      const target = initialFocusRef?.current ?? (dialogRef.current ? getFocusableElements(dialogRef.current)[0] : undefined);
      target?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimeout);
      previousFocus?.focus();
    };
  }, [dialogRef, initialFocusRef, open]);

  return function handleModalKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && closeOnEscape) {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };
}
