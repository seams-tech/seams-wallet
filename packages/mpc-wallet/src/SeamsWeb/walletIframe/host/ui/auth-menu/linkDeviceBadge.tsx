/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import type { AuthMenuLinkDeviceState } from '../../auth-menu/domain';

const LINK_DEVICE_DOT_COUNT = 12;

/* Three phases of one badge: `waiting` sweeps the dots like a clock spinner,
   `idle` rests them to a faint ring around whatever glyph the view supplies,
   and `approved` settles them while the check strokes itself in over the top. */
type LinkDeviceRingPhase = 'waiting' | 'idle' | 'approved';

export function linkDeviceDotRing(
  phase: LinkDeviceRingPhase,
  glyph?: ComponentChildren,
): ComponentChildren {
  return (
    <>
      <div class={`seams-link-device-dot-ring is-${phase}`} aria-hidden="true">
        {Array.from({ length: LINK_DEVICE_DOT_COUNT }, (_, index) => (
          <>
            <span data-dot-index={index}></span>
          </>
        ))}
        {glyph ? (
          <>
            <div class="seams-link-device-dot-ring-glyph">{glyph}</div>
          </>
        ) : null}
        <svg
          class="seams-link-device-dot-ring-check"
          viewBox="0 0 52 52"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m18.5 27 5 5 10-11" />
        </svg>
      </div>
    </>
  );
}

export type AuthMenuLinkDeviceEmailOtpState = Extract<
  AuthMenuLinkDeviceState,
  { kind: 'email_otp_required' }
>;

/* One row per activation state, so the badge, heading, and status line can
   never disagree about which phase the view is in. `pending` marks the phases
   the flow drives itself out of — those get the animated ellipsis. */
type LinkDeviceEmailOtpPresentation = {
  readonly ring: LinkDeviceRingPhase;
  readonly heading: string;
  readonly status: string;
  readonly pending: boolean;
  readonly tone: 'neutral' | 'error';
};

export function linkDeviceEmailOtpPresentation(
  activation: AuthMenuLinkDeviceEmailOtpState['state'],
): LinkDeviceEmailOtpPresentation {
  switch (activation.kind) {
    case 'sending':
      return {
        ring: 'waiting',
        heading: 'Sending your code',
        status: 'Emailing a 6-digit code',
        pending: true,
        tone: 'neutral',
      };
    case 'resending':
      return {
        ring: 'waiting',
        heading: 'Sending a new code',
        status: 'Emailing a fresh 6-digit code',
        pending: true,
        tone: 'neutral',
      };
    case 'submitting':
      return {
        ring: 'waiting',
        heading: 'Checking your code',
        status: 'Verifying the code you entered',
        pending: true,
        tone: 'neutral',
      };
    case 'code_input':
      return {
        ring: 'idle',
        heading: 'Verify your email',
        status: 'Enter the 6-digit code we just sent.',
        pending: false,
        tone: 'neutral',
      };
    case 'incorrect':
      return {
        ring: 'idle',
        heading: 'Verify your email',
        status: activation.message,
        pending: false,
        tone: 'error',
      };
    case 'expired':
      return {
        ring: 'idle',
        heading: 'That code expired',
        status: activation.message,
        pending: false,
        tone: 'error',
      };
    case 'unavailable':
      return {
        ring: 'idle',
        heading: 'Email code unavailable',
        status: activation.message,
        pending: false,
        tone: 'error',
      };
    case 'completed':
      return {
        ring: 'approved',
        heading: 'Email verified',
        status: 'Finishing linking this device',
        pending: true,
        tone: 'neutral',
      };
  }
}
