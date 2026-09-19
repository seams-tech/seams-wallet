import React from 'react';
import type { EmailOtpAuthPolicy } from '@/core/types/seams';
import { ArrowLeftIcon, FingerprintIcon } from './ui/icons';
import { SocialProviders } from './ui/SocialProviders';
import QRCodeIcon from '../QRCodeIcon';
import { ArrowRightAnim } from '../ArrowRightAnim';
import { SeamsAuthMenuThemeScope } from './themeScope';
import { useTheme } from '../theme';
import { getModeTitle, resolveDefaultMode } from './controller/mode';
import {
  AuthMenuMode,
  AuthMenuModeMap,
  type AuthMenuHeadings,
  type SeamsAuthMenuRegistrationAccountInput,
} from './types';
import {
  getGoogleSsoButtonLabel,
  getGoogleSsoHelperText,
  getPasskeyButtonLabel,
} from './socialCopy';

export interface SeamsAuthMenuSkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  /** Best-effort to match the hydrated UI default intent. */
  defaultMode?: AuthMenuMode;
  /** Best-effort to match the hydrated UI headings. */
  headings?: AuthMenuHeadings;
  /** Best-effort to match the hydrated UI Email OTP signing-session policy. */
  emailOtpAuthPolicy?: EmailOtpAuthPolicy;
  /** Best-effort to match the hydrated UI registration input policy. */
  registrationAccountInput?: SeamsAuthMenuRegistrationAccountInput;
  /** Best-effort to match the hydrated UI generated registration input visibility. */
  showRegistrationInput?: boolean;
}

export const SeamsAuthMenuSkeletonInner = React.forwardRef<
  HTMLDivElement,
  SeamsAuthMenuSkeletonProps
>(
  (
    {
      className,
      style,
      defaultMode,
      headings,
      emailOtpAuthPolicy,
      registrationAccountInput = 'implicit_wallet',
      showRegistrationInput = false,
    },
    ref,
  ) => {
    const mode = resolveDefaultMode(defaultMode);
    const resolvedEmailOtpAuthPolicy: EmailOtpAuthPolicy = emailOtpAuthPolicy || 'session';
    const title = getModeTitle(mode, headings ?? null);
    const showAccountInput =
      mode === AuthMenuMode.Login ||
      registrationAccountInput === 'sponsored_named_near_account' ||
      (registrationAccountInput === 'implicit_wallet' && showRegistrationInput);
    const placeholder =
      mode === AuthMenuMode.Register
        ? registrationAccountInput === 'implicit_wallet'
          ? 'Wallet name'
          : 'Pick a username'
        : 'Enter your username';
    const intentSwitchPrompt =
      mode === AuthMenuMode.Register ? 'Already have an account?' : "Don't have an account?";
    const intentSwitchAction = mode === AuthMenuMode.Register ? 'Sign in' : 'Sign up';

    return (
      <div
        ref={ref}
        className={`seams-signup-menu-root seams-skeleton${className ? ` ${className}` : ''}`}
        style={style}
        data-mode={mode}
        data-mode-label={AuthMenuModeMap[mode]}
        data-waiting="false"
        data-scan-device="false"
      >
        <div className="seams-content-switcher">
          <button aria-label="Back" type="button" className="seams-back-button" disabled>
            <ArrowLeftIcon size={18} strokeWidth={2.25} style={{ display: 'block' }} />
          </button>

          <div className="seams-content-area">
            <div className="seams-content-sizer">
              <div className="seams-signin-menu">
                <div className="seams-header">
                  <div>
                    <div className="seams-title">{title.title}</div>
                    <div className="seams-subhead">{title.subtitle}</div>
                  </div>
                </div>

                {showAccountInput ? (
                  <div className="seams-passkey-row">
                    <div className="seams-input-pill">
                      <div className="seams-input-wrap">
                        <input
                          type="text"
                          name="passkey"
                          disabled
                          placeholder={placeholder}
                          className="seams-input"
                          aria-disabled="true"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="text"
                          style={{ pointerEvents: 'none' }}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {(mode === AuthMenuMode.Login || mode === AuthMenuMode.Register) && (
                  <div className="seams-auth-methods">
                    <div className="seams-auth-method-stack">
                      {mode === AuthMenuMode.Login && (
                        <>
                          <button
                            className="seams-auth-method-btn seams-auth-method-btn-primary"
                            disabled
                          >
                            <FingerprintIcon size={22} style={{ display: 'block' }} />
                            <span>{getPasskeyButtonLabel(AuthMenuMode.Login)}</span>
                            <ArrowRightAnim size={16} className="seams-auth-method-arrow" />
                          </button>
                          <SocialProviders
                            socialLogin={{ google: () => undefined }}
                            providers={['google']}
                            disabled
                            providerCopy={{
                              google: {
                                buttonLabel: getGoogleSsoButtonLabel(AuthMenuMode.Login),
                                helperText: getGoogleSsoHelperText(
                                  AuthMenuMode.Login,
                                  resolvedEmailOtpAuthPolicy,
                                ),
                              },
                            }}
                          />
                        </>
                      )}
                      {mode === AuthMenuMode.Register && (
                        <>
                          <button
                            className="seams-auth-method-btn seams-auth-method-btn-primary"
                            disabled
                          >
                            <span>{getPasskeyButtonLabel(AuthMenuMode.Register)}</span>
                            <ArrowRightAnim size={16} className="seams-auth-method-arrow" />
                          </button>
                          <SocialProviders
                            socialLogin={{ google: () => undefined }}
                            providers={['google']}
                            disabled
                            providerCopy={{
                              google: {
                                buttonLabel: getGoogleSsoButtonLabel(AuthMenuMode.Register),
                                helperText: getGoogleSsoHelperText(
                                  AuthMenuMode.Register,
                                  resolvedEmailOtpAuthPolicy,
                                ),
                              },
                            }}
                          />
                        </>
                      )}
                    </div>
                  </div>
                )}

                {(mode === AuthMenuMode.Login || mode === AuthMenuMode.Register) && (
                  <div className="seams-scan-device-row">
                    <div className="seams-section-divider">
                      <span className="seams-section-divider-text">Other options</span>
                    </div>
                    <div className="seams-secondary-actions">
                      <button className="seams-link-device-btn" disabled>
                        <QRCodeIcon width={18} height={18} strokeWidth={2} />
                        Scan and Link Device
                      </button>
                    </div>
                  </div>
                )}
                {(mode === AuthMenuMode.Login || mode === AuthMenuMode.Register) && (
                  <div className="seams-auth-intent-switch">
                    <span>{intentSwitchPrompt}</span>
                    <span className="seams-auth-intent-switch-action">{intentSwitchAction}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
SeamsAuthMenuSkeletonInner.displayName = 'SeamsAuthMenuSkeletonInner';

export const SeamsAuthMenuSkeleton: React.FC<SeamsAuthMenuSkeletonProps> = (props) => {
  const { theme, tokens } = useTheme();
  return (
    <SeamsAuthMenuThemeScope theme={theme} tokens={tokens}>
      <SeamsAuthMenuSkeletonInner {...props} />
    </SeamsAuthMenuThemeScope>
  );
};

export default SeamsAuthMenuSkeleton;
