type CodeState =
  | { kind: 'editing'; code: string }
  | { kind: 'fading'; code: string; timer: ReturnType<typeof setTimeout> }
  | { kind: 'submitting'; code: string }
  | { kind: 'disposed'; code?: never };

export type EmailOtpResendResult = { kind: 'sent' } | { kind: 'failed'; message: string };

export type EmailOtpVerificationState =
  | { kind: 'ready' }
  | { kind: 'pending' }
  | { kind: 'rejected'; message: string };

type ResendState =
  | { kind: 'available'; label: string }
  | { kind: 'sending'; until: number }
  | { kind: 'cooldown'; until: number; label: string };

export type EmailOtpSessionSnapshot = {
  code: string;
  phase: 'editing' | 'fading' | 'submitting';
  error: string;
  resend: { available: boolean; label: string } | null;
};

export type EmailOtpSessionOptions = {
  onSubmit: (code: string) => void;
  onChange: (snapshot: EmailOtpSessionSnapshot) => void;
  resend: { send: () => Promise<EmailOtpResendResult>; cooldownMs: number } | null;
};

export class EmailOtpSession {
  private codeState: CodeState = { kind: 'editing', code: '' };
  private resendState: ResendState = { kind: 'available', label: 'Resend code' };
  private error = '';
  private countdown: ReturnType<typeof setInterval> | null = null;

  private readonly options: EmailOtpSessionOptions;

  constructor(options: EmailOtpSessionOptions) {
    this.options = options;
  }

  input = (rawValue: string): void => {
    if (this.codeState.kind !== 'editing') return;
    const code = rawValue.replace(/\D/g, '').slice(0, 6);
    this.error = '';
    this.codeState = { kind: 'editing', code };
    if (code.length === 6) {
      this.confirm();
    } else {
      this.publish();
    }
  };

  confirm(): 'accepted' | 'invalid' | 'ignored' {
    if (this.codeState.kind !== 'editing') return 'ignored';
    const code = this.codeState.code;
    if (code.length !== 6) {
      this.error = 'Enter the 6-digit Email OTP code.';
      this.publish();
      return 'invalid';
    }
    this.error = '';
    this.codeState = { kind: 'fading', code, timer: setTimeout(this.submit, 150) };
    this.publish();
    return 'accepted';
  }

  private submit = (): void => {
    if (this.codeState.kind !== 'fading') return;
    const code = this.codeState.code;
    this.codeState = { kind: 'submitting', code };
    this.publish();
    if (!this.isDisposed()) this.options.onSubmit(code);
  };

  retry(message: string): void {
    if (this.codeState.kind === 'disposed') return;
    this.cancelFade();
    this.codeState = { kind: 'editing', code: this.codeState.code };
    this.error = message;
    this.publish();
  }

  setVerification(state: EmailOtpVerificationState): void {
    if (this.codeState.kind === 'disposed') return;
    switch (state.kind) {
      case 'ready':
        if (this.codeState.kind === 'submitting') this.retry('');
        return;
      case 'pending':
        this.cancelFade();
        this.codeState = { kind: 'submitting', code: this.codeState.code };
        this.publish();
        return;
      case 'rejected':
        this.retry(state.message);
        return;
    }
  }

  resend = async (): Promise<void> => {
    if (this.codeState.kind !== 'editing' || this.resendState.kind !== 'available') return;
    const action = this.options.resend;
    if (!action) return;
    const until = Date.now() + action.cooldownMs;
    const pending: ResendState = { kind: 'sending', until };
    this.resendState = pending;
    this.error = '';
    this.publish();
    if (this.isDisposed()) return;
    let result: EmailOtpResendResult;
    try {
      result = await action.send();
    } catch {
      result = { kind: 'failed', message: 'Could not send code.' };
    }
    if (this.isDisposed() || this.resendState !== pending) return;
    const label = result.kind === 'sent' ? 'Code sent' : 'Resend code';
    if (result.kind === 'failed') this.error = result.message;
    if (Date.now() >= until) {
      this.resendState = { kind: 'available', label };
    } else {
      this.resendState = { kind: 'cooldown', until, label };
      this.countdown = setInterval(this.tick, 250);
    }
    this.publish();
  };

  private tick = (): void => {
    if (this.resendState.kind !== 'cooldown') return;
    if (Date.now() >= this.resendState.until) {
      this.resendState = { kind: 'available', label: this.resendState.label };
      this.clearCountdown();
    }
    this.publish();
  };

  private isDisposed(): boolean {
    return this.codeState.kind === 'disposed';
  }

  private publish(): void {
    if (this.codeState.kind === 'disposed') return;
    this.options.onChange({
      code: this.codeState.code,
      phase: this.codeState.kind,
      error: this.error,
      resend: this.options.resend ? this.resendSnapshot() : null,
    });
  }

  private resendSnapshot(): { available: boolean; label: string } {
    switch (this.resendState.kind) {
      case 'available':
        return { available: this.codeState.kind === 'editing', label: this.resendState.label };
      case 'sending':
        return { available: false, label: 'Sending...' };
      case 'cooldown':
        return {
          available: false,
          label: `Resend in ${Math.max(1, Math.ceil((this.resendState.until - Date.now()) / 1000))}s`,
        };
    }
  }

  private cancelFade(): void {
    if (this.codeState.kind === 'fading') clearTimeout(this.codeState.timer);
  }

  private clearCountdown(): void {
    if (this.countdown !== null) clearInterval(this.countdown);
    this.countdown = null;
  }

  dispose(): void {
    this.cancelFade();
    this.clearCountdown();
    this.codeState = { kind: 'disposed' };
    this.error = '';
  }
}
