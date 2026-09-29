import { test, expect } from '@playwright/test';
import type { AppearanceConfig } from '@/core/types/seams';
import {
  normalizeConfirmationModel,
  type ConfirmationPresentationInput,
  type ConfirmationCallbacks,
} from '@/core/signingEngine/uiConfirm/ui/confirmation-model';

const appearance: AppearanceConfig = {
  palette: 'default',
  theme: { id: 'default', mode: 'dark', colors: {} },
};

class PresentationHarness {
  calls: string[] = [];
  confirm = (): void => {
    this.calls.push('confirm');
  };
  cancel = (): void => {
    this.calls.push('cancel');
  };
  submitEmail = (code: string, challengeId: string): void => {
    this.calls.push(`${challengeId}:${code}`);
  };
  readonly callbacks: ConfirmationCallbacks = {
    confirm: this.confirm,
    cancel: this.cancel,
    submitEmail: this.submitEmail,
  };
  normalize(presentation: ConfirmationPresentationInput) {
    return normalizeConfirmationModel({
      presentation,
      appearance,
      tree: null,
      callbacks: this.callbacks,
    });
  }
  transaction(presentation: ConfirmationPresentationInput) {
    const result = this.normalize(presentation);
    if (!result.ok || result.model.content.kind !== 'transaction')
      throw new Error('Expected transaction');
    return result.model.content;
  }
}

test('preparing details become explicit loading states with live cancellation', () => {
  const harness = new PresentationHarness();
  const content = harness.transaction({ loading: true });
  expect(content.header.website).toEqual({ kind: 'loading' });
  expect(content.header.chainDetails).toEqual({ kind: 'loading' });
  expect(content.transaction.decision).toEqual({ kind: 'preparing' });
  expect(content.body).toEqual({ kind: 'empty' });
  content.transaction.onCancel();
  expect(harness.calls).toEqual(['cancel']);
});

test('pending signing preparation holds only the confirm button in its loading state', () => {
  const harness = new PresentationHarness();
  const content = harness.transaction({ preparing: true, body: 'Send 1 NEAR' });
  expect(content.transaction.decision).toEqual({ kind: 'preparing' });
  expect(content.body).toEqual({ kind: 'text', text: 'Send 1 NEAR' });
  expect(content.header.chainDetails).toEqual({ kind: 'ready', text: 'block' });

  const email = harness.transaction({
    preparing: true,
    signingAuthMode: 'emailOtp',
    emailOtpPrompt: { challengeId: 'challenge' },
  });
  expect(email.transaction.decision).toEqual({ kind: 'preparing' });
  if (email.prompt.kind !== 'email') throw new Error('Expected email');
  expect(email.prompt.email.verification).toEqual({ kind: 'ready' });
});

test('email challenge validation never falls back to passkey confirmation', () => {
  const harness = new PresentationHarness();
  expect(harness.normalize({ signingAuthMode: 'emailOtp' })).toEqual({
    ok: false,
    error: 'missing_email_challenge',
  });
  expect(
    harness.normalize({ signingAuthMode: 'emailOtp', emailOtpPrompt: { challengeId: '  ' } }),
  ).toEqual({ ok: false, error: 'missing_email_challenge' });
  expect(harness.calls).toEqual([]);
});

test('email normalization preserves the challenge, heading, pending and rejection states', () => {
  const harness = new PresentationHarness();
  const source: ConfirmationPresentationInput = {
    signingAuthMode: 'emailOtp',
    emailOtpPrompt: { challengeId: ' challenge ', title: ' Verify email ' },
  };
  const content = harness.transaction(source);
  expect(content.header.heading).toBe('Verify email');
  expect(content.transaction.confirmText).toBe('Confirm Code');
  if (content.prompt.kind !== 'email') throw new Error('Expected email');
  expect(content.prompt.email.prompt.challengeId).toBe('challenge');
  expect(content.prompt.email.verification).toEqual({ kind: 'ready' });
  content.prompt.email.onSubmit('123456', 'resent');
  expect(harness.calls).toEqual(['resent:123456']);
  const pending = harness.transaction({ ...source, loading: true, errorMessage: 'Prior error' });
  const rejected = harness.transaction({ ...source, errorMessage: 'Try again' });
  if (pending.prompt.kind !== 'email' || rejected.prompt.kind !== 'email')
    throw new Error('Expected email');
  expect(pending.prompt.email.verification).toEqual({ kind: 'pending' });
  expect(rejected.prompt.email.verification).toEqual({ kind: 'rejected', message: 'Try again' });
});

test('registration selects the dedicated branch and retains the displayed identity', () => {
  const harness = new PresentationHarness();
  const result = harness.normalize({
    loading: true,
    title: ' Create account ',
    body: ' ',
    securityContext: {
      passkeyRegistration: {
        kind: 'passkey_registration_confirm_display_v1',
        intendedUserName: 'Alice',
        accountId: 'internal.testnet',
        rpId: 'wallet.example',
        signerSlot: 0,
      },
    },
  });
  if (!result.ok || result.model.content.kind !== 'registration')
    throw new Error('Expected registration');
  const registration = result.model.content.registration;
  expect(registration.heading).toBe('Create account');
  expect(registration.display.intendedUserName).toBe('Alice');
  expect(registration.body).toBe(
    'Use Touch ID or your device passkey to create credentials for this account.',
  );
  expect(registration.decision).toEqual({ kind: 'creating' });
  registration.onCancel();
  expect(harness.calls).toEqual(['cancel']);
});

test('funding and progress body messages retain their distinct presentation', () => {
  const harness = new PresentationHarness();
  const funding = harness.transaction({
    body: 'NEAR account funding-account.testnet needs funding before signing.',
  });
  expect(funding.body).toEqual({
    kind: 'funding',
    accountId: 'funding-account.testnet',
    shortAccountId: 'fund...tnet',
  });
  const progress = harness.transaction({ body: ' Topping up account... ' });
  expect(progress.body).toEqual({ kind: 'status', text: 'Topping up account...' });
  expect(progress.header.chainDetails).toEqual({ kind: 'loading' });
});
