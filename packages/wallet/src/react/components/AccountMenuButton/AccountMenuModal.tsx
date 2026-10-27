import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { walletText } from '@/core/ui/messages';
import { useWalletLocale } from '../../context/WalletLocale';
import { Theme, useTheme } from '../theme';

type AccountMenuModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

function openDialog(ref: React.RefObject<HTMLDialogElement | null>): (() => void) | undefined {
  const dialog = ref.current;
  if (!dialog) return;
  dialog.showModal();
  return dialog.close.bind(dialog);
}

function isBackdrop(event: React.MouseEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}

function rememberBackdrop(
  startedOutside: React.RefObject<boolean>,
  event: React.PointerEvent<HTMLDialogElement>,
): void {
  startedOutside.current = isBackdrop(event);
}

function closeBackdrop(
  startedOutside: React.RefObject<boolean>,
  onClose: () => void,
  event: React.MouseEvent<HTMLDialogElement>,
): void {
  const shouldClose = startedOutside.current && isBackdrop(event);
  startedOutside.current = false;
  if (!shouldClose) return;
  event.stopPropagation();
  onClose();
}

function cancelDialog(onClose: () => void, event: React.SyntheticEvent<HTMLDialogElement>): void {
  event.preventDefault();
  event.stopPropagation();
  onClose();
}

function SettingsDialog({ onClose, children }: Omit<AccountMenuModalProps, 'isOpen'>) {
  const locale = useWalletLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const startedOutside = useRef(false);
  useLayoutEffect(openDialog.bind(null, ref), []);
  return (
    <dialog
      ref={ref}
      data-seams-root=""
      className="seams-account-modal"
      aria-label={walletText(locale, 'Wallet settings')}
      onCancel={cancelDialog.bind(null, onClose)}
      onPointerDown={rememberBackdrop.bind(null, startedOutside)}
      onClick={closeBackdrop.bind(null, startedOutside, onClose)}
    >
      {children}
    </dialog>
  );
}

export function AccountMenuModal({ isOpen, onClose, children }: AccountMenuModalProps) {
  const { theme, tokens } = useTheme();
  if (!isOpen || typeof document === 'undefined') return null;
  return createPortal(
    <Theme tag="div" theme={theme} tokens={{ [theme]: tokens }}>
      <SettingsDialog onClose={onClose}>{children}</SettingsDialog>
    </Theme>,
    document.body,
  );
}
