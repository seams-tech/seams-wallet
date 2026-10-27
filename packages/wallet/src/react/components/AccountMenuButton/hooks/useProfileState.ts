import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import type { AccountMenuPresentation, ProfileStateRefs } from '../types';

type ProfileOpenControl =
  | {
      kind: 'uncontrolled';
      initialOpen: boolean;
      open?: never;
      onOpenChange?: (open: boolean) => void;
    }
  | {
      kind: 'controlled';
      open: boolean;
      initialOpen?: never;
      onOpenChange: (open: boolean) => void;
    };

export function profileOpenControl(
  props: AccountMenuPresentation,
  initialOpen: boolean,
): ProfileOpenControl {
  if (props.isMenuOpen !== undefined) {
    return { kind: 'controlled', open: props.isMenuOpen, onOpenChange: props.onMenuOpenChange };
  }
  return { kind: 'uncontrolled', initialOpen, onOpenChange: props.onMenuOpenChange };
}

function changeOpen(
  control: ProfileOpenControl,
  setUncontrolledOpen: React.Dispatch<React.SetStateAction<boolean>>,
  open: boolean,
): void {
  switch (control.kind) {
    case 'uncontrolled':
      setUncontrolledOpen(open);
      control.onOpenChange?.(open);
      return;
    case 'controlled':
      control.onOpenChange(open);
      return;
    default:
      return assertNever(control);
  }
}

function currentOpen(control: ProfileOpenControl, uncontrolledOpen: boolean): boolean {
  switch (control.kind) {
    case 'controlled':
      return control.open;
    case 'uncontrolled':
      return uncontrolledOpen;
    default:
      return assertNever(control);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown account menu control: ${String(value)}`);
}

function closeOutside(
  buttonRef: React.RefObject<HTMLDivElement | null>,
  close: () => void,
  event: Event,
): void {
  for (const target of event.composedPath()) {
    if (target === buttonRef.current) return;
    if (
      target instanceof HTMLElement &&
      target.matches(
        '[data-seams-root].seams-wallet-overlay-dialog, .seams-linked-devices-modal-backdrop, .qr-scanner-modal',
      )
    )
      return;
  }
  close();
}

function observeOutside(
  presentation: 'dropdown' | 'modal' | 'page',
  isOpen: boolean,
  buttonRef: React.RefObject<HTMLDivElement | null>,
  close: () => void,
): (() => void) | undefined {
  if (presentation !== 'dropdown' || !isOpen) return;
  const root = buttonRef.current?.getRootNode();
  if (!root) return;
  const listener = closeOutside.bind(null, buttonRef, close);
  root.addEventListener('click', listener, true);
  return root.removeEventListener.bind(root, 'click', listener, true);
}

export function useProfileState(
  presentation: 'dropdown' | 'modal' | 'page',
  control: ProfileOpenControl,
) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    control.kind === 'uncontrolled' ? control.initialOpen : false,
  );
  const isOpen = currentOpen(control, uncontrolledOpen);
  const buttonRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuItemsRef = useRef<(HTMLElement | null)[]>([]);
  const refs: ProfileStateRefs = { buttonRef, dropdownRef, menuItemsRef };
  const handleClose = changeOpen.bind(null, control, setUncontrolledOpen, false);
  const handleToggle = changeOpen.bind(null, control, setUncontrolledOpen, !isOpen);

  useEffect(observeOutside.bind(null, presentation, isOpen, buttonRef, handleClose), [
    presentation,
    isOpen,
    buttonRef,
    handleClose,
  ]);

  return { isOpen, refs, handleToggle, handleClose };
}
