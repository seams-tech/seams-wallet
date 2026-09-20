/** @jsxImportSource preact */
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { HaloBorder } from './HaloBorder';

type PasskeyHaloLoadingProps = {
  animated: boolean;
  icon: 'fingerprint' | 'mail';
  styles: CspStylesheetManager;
  innerPadding?: string;
  size?: 36 | 44;
};

export function PasskeyHaloLoading(props: PasskeyHaloLoadingProps) {
  return (
    <div class="seams-passkey-halo-loading" aria-hidden="true">
      <div class="seams-passkey-loading-root">
        <HaloBorder
          animated={props.animated}
          innerPadding={props.innerPadding}
          styles={props.styles}
        >
          <div class="seams-passkey-loading-touch-icon-container">
            <svg
              class="seams-passkey-loading-touch-icon"
              width={props.size ?? 36}
              height={props.size ?? 36}
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              focusable="false"
            >
              {props.icon === 'mail' ? <MailPaths /> : <FingerprintPath />}
            </svg>
          </div>
        </HaloBorder>
      </div>
    </div>
  );
}

function MailPaths() {
  return (
    <>
      <path
        d="M4.5 6.5H19.5C20.0523 6.5 20.5 6.94772 20.5 7.5V16.5C20.5 17.0523 20.0523 17.5 19.5 17.5H4.5C3.94772 17.5 3.5 17.0523 3.5 16.5V7.5C3.5 6.94772 3.94772 6.5 4.5 6.5Z"
        stroke="currentColor"
        stroke-width="var(--seams-modal__passkey-halo-loading-touch-icon__stroke-width, 3)"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
      <path
        d="M4.25 7.25L12 12.75L19.75 7.25"
        stroke="currentColor"
        stroke-width="var(--seams-modal__passkey-halo-loading-touch-icon__stroke-width, 3)"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </>
  );
}

function FingerprintPath() {
  return (
    <path
      d="M6.40519 19.0481C6.58912 18.6051 6.75832 18.1545 6.91219 17.6969M14.3433 20.6926C14.6095 19.9418 14.8456 19.1768 15.0502 18.399C15.2359 17.6934 15.3956 16.9772 15.5283 16.2516M19.4477 17.0583C19.8121 15.0944 20.0026 13.0694 20.0026 11C20.0026 6.58172 16.4209 3 12.0026 3C10.7472 3 9.55932 3.28918 8.50195 3.80456M3.52344 15.0245C3.83663 13.7343 4.00262 12.3865 4.00262 11C4.00262 9.25969 4.55832 7.64917 5.50195 6.33621M12.003 11C12.003 13.7604 11.5557 16.4163 10.7295 18.8992C10.5169 19.5381 10.2792 20.1655 10.0176 20.7803M7.71227 14.5C7.90323 13.3618 8.00262 12.1925 8.00262 11C8.00262 8.79086 9.79348 7 12.0026 7C14.2118 7 16.0026 8.79086 16.0026 11C16.0026 11.6166 15.9834 12.2287 15.9455 12.8357"
      stroke="currentColor"
      stroke-width="var(--seams-modal__passkey-halo-loading-touch-icon__stroke-width, 3)"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
      pathLength="1"
    />
  );
}
