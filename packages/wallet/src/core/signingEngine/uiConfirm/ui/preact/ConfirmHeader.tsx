/** @jsxImportSource preact */
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { PasskeyHaloLoading } from './PasskeyHaloLoading';

export type ConfirmationStatusText =
  | { kind: 'loading'; text?: never }
  | { kind: 'ready'; text: string };

export type ConfirmHeaderProps = {
  heading: string;
  icon: 'fingerprint' | 'mail';
  website: ConfirmationStatusText;
  chainDetails: ConfirmationStatusText;
  errorMessage?: string;
  styles: CspStylesheetManager;
};

export function ConfirmHeader(props: ConfirmHeaderProps) {
  return (
    <div class="hero seams-confirm-header">
      <PasskeyHaloLoading animated={!props.errorMessage} icon={props.icon} styles={props.styles} />
      <div class="hero-container">
        <h2 class="hero-heading">{props.heading}</h2>
        {props.errorMessage && <div class="error-banner">{props.errorMessage}</div>}
        <div class="rpid-wrapper">
          <div class="rpid">
            <div class="secure-indicator">
              <svg
                class="padlock-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span role="status">
                {props.website.kind === 'ready' ? (
                  <span class="domain-text">{props.website.text}</span>
                ) : (
                  <LoadingStatus label="Loading website" />
                )}
              </span>
            </div>
            <span class="security-details">
              <svg
                class="block-height-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A 2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                <path d="m3.3 7 8.7 5 8.7-5" />
                <path d="M12 22V12" />
              </svg>
              <span role="status">
                {props.chainDetails.kind === 'ready' ? (
                  props.chainDetails.text
                ) : (
                  <LoadingStatus label="Loading chain details" />
                )}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingStatus(props: { label: string }) {
  return (
    <>
      <span class="loading-ellipsis" aria-hidden="true">
        <span class="loading-ellipsis__dot">.</span>
        <span class="loading-ellipsis__dot">.</span>
        <span class="loading-ellipsis__dot">.</span>
      </span>
      <span class="sr-only">{props.label}</span>
    </>
  );
}
