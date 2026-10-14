import React, { useLayoutEffect, useRef, useState } from 'react';
import { UserAccountButton } from './UserAccountButton';
import { ProfileDropdown } from './ProfileDropdown';
import { LockKeyholeIcon } from './icons/LockKeyholeIcon';
import TouchIcon from './icons/TouchIcon';
import { SEAMS_STANDARD_WORDMARK_PATH } from '../../../core/signingEngine/uiConfirm/ui/seamsWordmarkPaths';
import './Web3AuthProfileButton.css';

type AccountMenuButtonViewProps = {
  buttonRef: React.RefObject<HTMLDivElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  trigger: React.ComponentProps<typeof UserAccountButton>;
  dropdown: React.ComponentProps<typeof ProfileDropdown>;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

function measurePanel(
  element: HTMLDivElement,
  setHeight: React.Dispatch<React.SetStateAction<number | null>>,
): void {
  setHeight(element.getBoundingClientRect().height);
}

function observePanel(
  contentRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  setHeight: React.Dispatch<React.SetStateAction<number | null>>,
): (() => void) | undefined {
  const content = contentRef.current;
  if (!content || !isOpen) {
    setHeight(null);
    return;
  }
  const measure = measurePanel.bind(null, content, setHeight);
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(content);
  return observer.disconnect.bind(observer);
}
function closeWithEscape(onClose: () => void, event: React.KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  onClose();
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
      ?.querySelector<HTMLElement>('.seams-account-title')
      ?.focus({ preventScroll: true });
  }
  previousScreen.current = hasScreen;
}

/** One shell for live account screens and the provider-free preview. */
export function AccountMenuButtonView({
  buttonRef,
  dropdownRef,
  trigger,
  dropdown,
  className,
  style,
  children,
}: AccountMenuButtonViewProps): React.JSX.Element {
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
  useLayoutEffect(observePanel.bind(null, contentRef, trigger.isOpen, setHeight), [trigger.isOpen]);
  return (
    <div
      ref={buttonRef}
      className={`seams-profile-button-morphable ${trigger.isOpen ? 'open' : 'closed'} ${className ?? ''}`}
      style={style}
      data-state={trigger.isOpen ? 'open' : 'closed'}
    >
      {trigger.isOpen ? (
        <div
          className="seams-account-resize"
          onKeyDown={closeWithEscape.bind(null, dropdown.onClose)}
          style={{ height: height ?? undefined }}
        >
          <div ref={contentRef} className="seams-account-panel-content">
            <header className="seams-account-origin">
              <LockKeyholeIcon size={14} />
              <span>{typeof window === 'undefined' ? '' : window.location.host}</span>
              <button type="button" aria-label="Close wallet settings" onClick={dropdown.onClose}>
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
            </header>
            <div className="seams-account-main" ref={dropdownRef}>
              {children ?? (
                <>
                  <h2 className="seams-account-title" tabIndex={-1}>
                    Wallet settings
                  </h2>
                  <div className="seams-account-identity">
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
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
                <path d="m8 12 3 3 5-6" />
              </svg>
              <span>Secured by</span>
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
}
