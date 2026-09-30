import React, { useEffect } from 'react';
import { Theme, useTheme } from '../theme';

type AccountMenuDialogPresentation = 'modal' | 'page';

// Keyboard handling for an account-menu dialog: Escape closes it, Tab and Shift+Tab wrap
// within it, and closing returns focus to where it was. A page presentation is not modal, so
// it gets none of this.
export function useAccountMenuDialogKeyboard(input: {
  readonly isOpen: boolean;
  readonly presentation: AccountMenuDialogPresentation;
  readonly onClose: () => void;
  readonly dialogRef: React.RefObject<HTMLDivElement | null>;
  readonly focusableSelector: string;
}): void {
  const { isOpen, presentation, onClose, dialogRef, focusableSelector } = input;
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  const handleDialogKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [dialogRef, focusableSelector, onClose],
  );

  useEffect(() => {
    if (!isOpen || presentation === 'page') return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    window.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.removeEventListener('keydown', handleDialogKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [dialogRef, handleDialogKeyDown, isOpen, presentation]);
}

// The themed backdrop, dialog, close button and title an account-menu dialog renders its
// content inside. As a page it is a labelled region with no close button.
export const AccountMenuDialogFrame: React.FC<{
  readonly presentation: AccountMenuDialogPresentation;
  readonly onClose: () => void;
  readonly dialogRef: React.RefObject<HTMLDivElement | null>;
  readonly contentClassName: string;
  readonly titleId: string;
  readonly title: string;
  readonly closeLabel: string;
  readonly children: React.ReactNode;
}> = ({
  presentation,
  onClose,
  dialogRef,
  contentClassName,
  titleId,
  title,
  closeLabel,
  children,
}) => {
  const { theme, tokens } = useTheme();
  const scopedTokens = React.useMemo(
    () => (theme === 'dark' ? { dark: tokens } : { light: tokens }),
    [theme, tokens],
  );
  return (
    <Theme theme={theme} tokens={scopedTokens}>
      <div
        className={`seams-linked-devices-modal-backdrop theme-${theme}`}
        data-presentation={presentation}
        role="presentation"
        onMouseDown={(event) => {
          if (presentation === 'modal' && event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          className={`seams-linked-devices-modal-content ${contentClassName}`}
          role={presentation === 'modal' ? 'dialog' : 'region'}
          aria-modal={presentation === 'modal' ? true : undefined}
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          {presentation === 'modal' ? (
            <button
              type="button"
              className="seams-linked-devices-modal-close"
              onClick={onClose}
              aria-label={closeLabel}
            >
              ✕
            </button>
          ) : null}
          <h2 id={titleId} className="seams-linked-devices-modal-title">
            {title}
          </h2>
          {children}
        </div>
      </div>
    </Theme>
  );
};
