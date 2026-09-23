/** @jsxImportSource preact */
import { Component, type TargetedEvent } from 'preact';

export type EmailOtpInputState =
  | { kind: 'editing'; onInput: (value: string) => void }
  | { kind: 'fading' | 'submitting'; onInput?: never };

export type EmailOtpResendAction =
  | { kind: 'available'; label: string; onResend: () => void }
  | { kind: 'unavailable'; label: string; onResend?: never };

export type EmailOtpInputProps = {
  challengeId: string;
  code: string;
  helperText: string;
  errorMessage?: string;
  state: EmailOtpInputState;
  resend: EmailOtpResendAction | null;
};

let nextInputId = 0;

export class EmailOtpInput extends Component<EmailOtpInputProps> {
  private readonly id = `seams-email-code-${++nextInputId}`;

  private input = (event: TargetedEvent<HTMLInputElement>): void => {
    if (this.props.state.kind === 'editing') this.props.state.onInput(event.currentTarget.value);
  };

  private resend = (): void => {
    if (this.props.resend?.kind === 'available') this.props.resend.onResend();
  };

  private renderDigit = (index: number) => {
    const digit = this.props.code[index] || '';
    return (
      <span key={index} class={`email-otp-confirm__slot${digit ? ' is-filled' : ''}`}>
        {digit}
      </span>
    );
  };

  render() {
    const disabled = this.props.state.kind !== 'editing';
    const helperId = `${this.id}-helper`;
    const errorId = `${this.id}-error`;
    return (
      <div class="email-otp-confirm">
        <label class="email-otp-confirm__label" for={this.id}>
          Email code
        </label>
        <div class="email-otp-confirm__code-field" data-disabled={disabled ? 'true' : 'false'}>
          <input
            id={this.id}
            name="email-code"
            type="text"
            class="email-otp-confirm__input"
            inputMode="numeric"
            autoComplete="one-time-code"
            data-email-otp-challenge-id={this.props.challengeId}
            pattern="[0-9]*"
            maxLength={6}
            spellcheck={false}
            value={this.props.code}
            disabled={disabled}
            onInput={this.input}
            aria-invalid={this.props.errorMessage ? 'true' : undefined}
            aria-describedby={this.props.errorMessage ? `${helperId} ${errorId}` : helperId}
          />
          <div
            class={`email-otp-confirm__slots${disabled ? ' is-submitting' : ''}`}
            aria-hidden="true"
          >
            {[0, 1, 2, 3, 4, 5].map(this.renderDigit)}
          </div>
        </div>
        <div id={helperId} class="email-otp-confirm__helper">
          {this.props.helperText}
        </div>
        {this.props.errorMessage && (
          <div id={errorId} class="email-otp-confirm__error">
            {this.props.errorMessage}
          </div>
        )}
        {this.props.resend && (
          <button
            type="button"
            class="email-otp-confirm__resend"
            disabled={this.props.resend.kind === 'unavailable'}
            onClick={this.resend}
          >
            {this.props.resend.label}
          </button>
        )}
      </div>
    );
  }
}
