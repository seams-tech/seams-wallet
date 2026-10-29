import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletText } from '@/core/ui/messages';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { UserAccountButton } from './UserAccountButton';
import { ProfileDropdown } from './ProfileDropdown';
import { AccountSettingsDialog } from './AccountSettingsDialog';
import type { AccountMenuPresentationMode } from './types';
import { LockKeyholeIcon } from './icons/LockKeyholeIcon';
import TouchIcon from './icons/TouchIcon';
import { SEAMS_STANDARD_WORDMARK_PATH } from '../../../core/signingEngine/uiConfirm/ui/seamsWordmarkPaths';
import './Web3AuthProfileButton.css';

type AccountMenuButtonViewProps = {
  presentation: AccountMenuPresentationMode;
  buttonRef: React.RefObject<HTMLDivElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  trigger: React.ComponentProps<typeof UserAccountButton>;
  dropdown: React.ComponentProps<typeof ProfileDropdown>;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

// The layout height, not the client rect: a host that scales the menu with a
// transform would shrink the rect and clip the panel's bottom (its footer).
function measurePanel(
  element: HTMLDivElement,
  setHeight: React.Dispatch<React.SetStateAction<number | null>>,
): void {
  setHeight(element.offsetHeight);
}

function observePanel(
  contentRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  presentation: AccountMenuPresentationMode,
  setHeight: React.Dispatch<React.SetStateAction<number | null>>,
): (() => void) | undefined {
  const content = contentRef.current;
  if (!content || !isOpen || presentation === 'drawer') {
    setHeight(null);
    return;
  }
  const measure = measurePanel.bind(null, content, setHeight);
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(content);
  return observer.disconnect.bind(observer);
}
function closeWithEscape(
  presentation: AccountMenuPresentationMode,
  onClose: () => void,
  event: React.KeyboardEvent,
): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  if (presentation !== 'dropdown') event.stopPropagation();
  onClose();
}

function revealDialogScreen(
  presentation: AccountMenuPresentationMode,
  event: React.FocusEvent<HTMLDivElement>,
): void {
  if (presentation === 'dropdown' || !(event.target instanceof HTMLElement)) return;
  if (!event.target.matches('.seams-account-heading h2, .seams-account-identity')) return;
  const scrollArea =
    presentation === 'drawer'
      ? event.target.closest<HTMLElement>('.seams-account-main')
      : event.currentTarget.closest<HTMLElement>('dialog.seams-account-dialog');
  if (scrollArea) scrollArea.scrollTop = 0;
}

function restoreTriggerFocus(
  buttonRef: React.RefObject<HTMLDivElement | null>,
  previousOpen: React.MutableRefObject<boolean>,
  isOpen: boolean,
): void {
  if (previousOpen.current && !isOpen) {
    buttonRef.current
      ?.querySelector<HTMLElement>('[aria-expanded]')
      ?.focus({ preventScroll: true });
  }
  previousOpen.current = isOpen;
}

function restoreOverviewFocus(
  buttonRef: React.RefObject<HTMLDivElement | null>,
  previousScreen: React.MutableRefObject<boolean>,
  hasScreen: boolean,
): void {
  if (previousScreen.current && !hasScreen) {
    buttonRef.current
      ?.querySelector<HTMLElement>('.seams-account-identity')
      ?.focus({ preventScroll: true });
  }
  previousScreen.current = hasScreen;
}

/** One shell for live account screens and the provider-free preview. */
export function AccountMenuButtonView({
  presentation,
  buttonRef,
  dropdownRef,
  trigger,
  dropdown,
  className,
  style,
  children,
}: AccountMenuButtonViewProps): React.JSX.Element {
  const locale = useWalletLocale();
  const contentRef = useRef<HTMLDivElement>(null);
  const hasScreen = children !== null && children !== undefined;
  const previousScreen = useRef(hasScreen);
  useLayoutEffect(restoreOverviewFocus.bind(null, buttonRef, previousScreen, hasScreen), [
    buttonRef,
    hasScreen,
  ]);
  const previousOpen = useRef(trigger.isOpen);
  useLayoutEffect(restoreTriggerFocus.bind(null, buttonRef, previousOpen, trigger.isOpen), [
    buttonRef,
    trigger.isOpen,
  ]);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(observePanel.bind(null, contentRef, trigger.isOpen, presentation, setHeight), [
    trigger.isOpen,
    presentation,
  ]);
  const panelOpen = presentation !== 'dropdown' || trigger.isOpen;
  const panel = (
    <div
      ref={buttonRef}
      className={`seams-profile-button-morphable ${panelOpen ? 'open' : 'closed'} ${className ?? ''}`}
      style={panelOpen ? style : { ...style, width: 'fit-content' }}
      data-state={panelOpen ? 'open' : 'closed'}
      onFocusCapture={revealDialogScreen.bind(null, presentation)}
    >
      {panelOpen ? (
        <div
          className="seams-account-resize"
          onKeyDown={closeWithEscape.bind(null, presentation, dropdown.onClose)}
          style={{ height: presentation === 'drawer' ? undefined : (height ?? undefined) }}
        >
          <div ref={contentRef} className="seams-account-panel-content">
            <header className="seams-account-origin">
              <LockKeyholeIcon size={14} />
              <span>{typeof window === 'undefined' ? '' : window.location.host}</span>
              <button
                type="button"
                className="seams-account-close"
                aria-label={walletText(locale, 'Close wallet settings')}
                onClick={dropdown.onClose}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
              {presentation === 'drawer' ? (
                <h2 className="seams-account-drawer-title">
                  <WalletText message="Wallet settings" />
                </h2>
              ) : null}
            </header>
            <div className="seams-account-main" ref={dropdownRef}>
              {children ?? (
                <>
                  <div
                    className="seams-account-identity"
                    tabIndex={-1}
                    role="group"
                    aria-label={walletText(locale, 'Wallet account')}
                  >
                    <span className="seams-account-avatar">
                      <TouchIcon width={23} height={23} strokeWidth={1.5} />
                    </span>
                    <div>
                      <strong>{trigger.fullAccountId ?? trigger.username}</strong>
                      {trigger.emailAddress ? <small>{trigger.emailAddress}</small> : null}
                    </div>
                  </div>
                  <ProfileDropdown {...dropdown} />
                </>
              )}
            </div>
            <footer className="seams-account-footer">
              <span>
                <WalletText message="Secured by" />
              </span>
              <svg
                className="seams-account-wordmark"
                viewBox="0 0 1428 285"
                role="img"
                aria-label="seams"
              >
                <path d={SEAMS_STANDARD_WORDMARK_PATH} fill="currentColor" fillRule="evenodd" />
              </svg>
            </footer>
          </div>
        </div>
      ) : (
        <UserAccountButton {...trigger} />
      )}
    </div>
  );
  switch (presentation) {
    case 'dropdown':
      return panel;
    case 'modal':
    case 'drawer':
      return (
        <AccountSettingsDialog
          presentation={presentation}
          isOpen={trigger.isOpen}
          onClose={dropdown.onClose}
        >
          {panel}
        </AccountSettingsDialog>
      );
    default:
      return assertNever(presentation);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported account menu presentation: ${String(value)}`);
}
