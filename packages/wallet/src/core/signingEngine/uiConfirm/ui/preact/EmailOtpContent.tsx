/** @jsxImportSource preact */
import { Component, createRef } from 'preact';
import type { EmailOtpConfirmPrompt } from '@/core/signingEngine/stepUpConfirmation/types';
import { formatEmailOtpSentText } from '@/core/signingEngine/stepUpConfirmation/otpPrompt/promptText';
import { EmailOtpInput, type EmailOtpInputState, type EmailOtpResendAction } from './EmailOtpInput';
import {
  EmailOtpSession,
  type EmailOtpResendResult,
  type EmailOtpSessionSnapshot,
  type EmailOtpVerificationState,
} from './email-otp-session';

export type EmailOtpContentProps = {
  prompt: EmailOtpConfirmPrompt;
  verification: EmailOtpVerificationState;
  onSubmit: (code: string, challengeId: string) => void;
  formId?: string;
};

export function EmailOtpContent(props: EmailOtpContentProps) {
  return <EmailOtpSessionView key={props.prompt.challengeId} {...props} />;
}

class EmailOtpSessionView extends Component<EmailOtpContentProps, EmailOtpSessionSnapshot> {
  private readonly session: EmailOtpSession;
  private readonly form = createRef<HTMLFormElement>();
  private lifetime:
    | { kind: 'active'; challengeId: string; emailHint: string }
    | { kind: 'disposed' };

  constructor(props: EmailOtpContentProps) {
    super(props);
    this.lifetime = {
      kind: 'active',
      challengeId: props.prompt.challengeId,
      emailHint: props.prompt.emailHint?.trim() || '',
    };
    this.state = {
      code: '',
      phase: 'editing',
      error: '',
      resend: props.prompt.onResend ? { available: true, label: 'Resend code' } : null,
    };
    this.session = new EmailOtpSession({
      onSubmit: this.submit,
      onChange: this.change,
      resend: props.prompt.onResend
        ? {
            send: this.send,
            cooldownMs: Math.max(1000, Math.floor(Number(props.prompt.resendDebounceMs) || 10_000)),
          }
        : null,
    });
  }

  private submit = (code: string): void => {
    if (this.lifetime.kind === 'active') this.props.onSubmit(code, this.lifetime.challengeId);
  };

  private send = async (): Promise<EmailOtpResendResult> => {
    const callback = this.props.prompt.onResend;
    if (!callback) return { kind: 'failed', message: 'Could not send code.' };
    try {
      const result = await callback();
      if (this.lifetime.kind === 'disposed') return { kind: 'sent' };
      const challengeId = String(result?.challengeId || '').trim();
      const emailHint = String(result?.emailHint || '').trim();
      if (challengeId) {
        this.lifetime = {
          kind: 'active',
          challengeId,
          emailHint: emailHint || this.lifetime.emailHint,
        };
      }
      return { kind: 'sent' };
    } catch (error) {
      return { kind: 'failed', message: formatResendError(error) };
    }
  };

  private change = (snapshot: EmailOtpSessionSnapshot): void => {
    this.setState(snapshot);
  };

  private confirm = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.session.confirm() === 'invalid') this.setState({}, this.focusCode);
  };

  private focusCode = (): void => {
    this.form.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  };

  componentDidMount(): void {
    this.session.setVerification(this.props.verification);
  }

  componentDidUpdate(previous: EmailOtpContentProps): void {
    if (verificationChanged(previous.verification, this.props.verification)) {
      this.session.setVerification(this.props.verification);
    }
  }

  componentWillUnmount(): void {
    this.lifetime = { kind: 'disposed' };
    this.session.dispose();
  }

  private inputState(): EmailOtpInputState {
    switch (this.state.phase) {
      case 'editing':
        return { kind: 'editing', onInput: this.session.input };
      case 'fading':
        return { kind: 'fading' };
      case 'submitting':
        return { kind: 'submitting' };
    }
  }

  private resendAction(): EmailOtpResendAction | null {
    const resend = this.state.resend;
    if (!resend) return null;
    if (!resend.available) return { kind: 'unavailable', label: resend.label };
    return { kind: 'available', label: resend.label, onResend: this.session.resend };
  }

  render() {
    return (
      <form ref={this.form} id={this.props.formId} onSubmit={this.confirm} noValidate>
        <EmailOtpInput
          code={this.state.code}
          helperText={
            this.props.prompt.helperText?.trim() ||
            formatEmailOtpSentText(this.lifetime.kind === 'active' ? this.lifetime.emailHint : '')
          }
          errorMessage={this.state.error || undefined}
          state={this.inputState()}
          resend={this.resendAction()}
        />
      </form>
    );
  }
}

function verificationChanged(
  previous: EmailOtpVerificationState,
  next: EmailOtpVerificationState,
): boolean {
  if (previous.kind !== next.kind) return true;
  return (
    previous.kind === 'rejected' && next.kind === 'rejected' && previous.message !== next.message
  );
}

function formatResendError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'rate_limited') {
    const retryAfterMs = 'retryAfterMs' in error ? Number(error.retryAfterMs) : NaN;
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return `Too many requests. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`;
    }
    return 'Too many requests. Try again shortly.';
  }
  return error instanceof Error && error.message ? error.message : 'Could not send code.';
}
