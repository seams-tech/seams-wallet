/** @jsxImportSource preact */
import { WalletText, useWalletLocale } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import { walletText } from '@/core/ui/messages';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { PadlockIcon } from './PadlockIcon';
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
  const locale = useWalletLocale();
  return (
    <div class="hero seams-confirm-header">
      <PasskeyHaloLoading animated={!props.errorMessage} icon={props.icon} styles={props.styles} />
      <div class="hero-container">
        <h2 class="hero-heading">
          <WalletText copy={props.heading} />
        </h2>
        {props.errorMessage && (
          <div class="error-banner">
            <WalletText copy={props.errorMessage} />
          </div>
        )}
        <div class="rpid-wrapper">
          <div class="rpid">
            <div class="secure-indicator">
              <PadlockIcon />
              <span role="status">
                {props.website.kind === 'ready' ? (
                  <span class="domain-text">
                    <WalletText copy={props.website.text} />
                  </span>
                ) : (
                  <LoadingStatus label={walletText(locale, 'Loading website')} />
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
                  <WalletText copy={props.chainDetails.text} />
                ) : (
                  <LoadingStatus label={walletText(locale, 'Loading chain details')} />
                )}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoadingStatus(props: { label: string }) {
  return (
    <>
      <span class="loading-ellipsis" aria-hidden="true">
        <span class="loading-ellipsis__dot">.</span>
        <span class="loading-ellipsis__dot">.</span>
        <span class="loading-ellipsis__dot">.</span>
      </span>
      <span class="sr-only">
        <WalletText copy={props.label} />
      </span>
    </>
  );
}
