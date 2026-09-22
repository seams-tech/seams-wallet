import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EmailOtpSession } from '../../packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/email-otp-session.ts';

class SessionHarness {
  submissions = [];
  snapshots = [];
  resendCalls = 0;
  disposeOnSubmitting = false;
  response = Promise.resolve({ kind: 'sent' });
  session;

  constructor() {
    this.session = new EmailOtpSession({
      onSubmit: this.recordSubmit,
      onChange: this.recordChange,
      resend: { send: this.send, cooldownMs: 100 },
    });
  }

  recordSubmit = (code) => {
    this.submissions.push(code);
  };
  recordChange = (snapshot) => {
    this.snapshots.push(snapshot);
    if (this.disposeOnSubmitting && snapshot.phase === 'submitting') this.session.dispose();
  };
  send = () => {
    this.resendCalls++;
    return this.response;
  };
  get latest() {
    return this.snapshots.at(-1);
  }
}

test('manual confirmation validates incomplete input without submitting', () => {
  const harness = new SessionHarness();
  harness.session.input('12a');
  assert.equal(harness.session.confirm(), 'invalid');
  assert.equal(harness.latest.code, '12');
  assert.equal(harness.latest.error, 'Enter the 6-digit Email OTP code.');
  assert.deepEqual(harness.submissions, []);
  harness.session.dispose();
});

test('manual retry shares the automatic submission gate and cannot double-submit', async () => {
  const harness = new SessionHarness();
  harness.session.input('123456');
  assert.equal(harness.session.confirm(), 'ignored');
  await delay(180);
  assert.deepEqual(harness.submissions, ['123456']);
  assert.equal(harness.session.confirm(), 'ignored');
  harness.session.retry('Please retry.');
  assert.equal(harness.session.confirm(), 'accepted');
  assert.equal(harness.session.confirm(), 'ignored');
  await delay(180);
  assert.deepEqual(harness.submissions, ['123456', '123456']);
  harness.session.dispose();
  assert.equal(harness.session.confirm(), 'ignored');
});

test('a subscriber can dispose before the submission callback', async () => {
  const harness = new SessionHarness();
  harness.disposeOnSubmitting = true;
  harness.session.input('123456');
  await delay(180);
  assert.deepEqual(harness.submissions, []);
});

test('resend is single-flight and becomes available after cooldown', async () => {
  const harness = new SessionHarness();
  const pending = Promise.withResolvers();
  harness.response = pending.promise;
  const first = harness.session.resend();
  await harness.session.resend();
  assert.equal(harness.resendCalls, 1);
  assert.equal(harness.latest.resend.label, 'Sending...');
  pending.resolve({ kind: 'sent' });
  await first;
  assert.equal(harness.latest.resend.available, false);
  await delay(280);
  assert.deepEqual(harness.latest.resend, { available: true, label: 'Code sent' });
  harness.session.dispose();
});

test('resend errors are displayed and editing clears them', async () => {
  const harness = new SessionHarness();
  harness.response = Promise.resolve({ kind: 'failed', message: 'Try again shortly.' });
  await harness.session.resend();
  assert.equal(harness.latest.error, 'Try again shortly.');
  harness.session.input('12');
  assert.equal(harness.latest.error, '');
  harness.session.dispose();
});

test('retry cancels the old fade and permits a new code', async () => {
  const harness = new SessionHarness();
  harness.session.input('123456');
  harness.session.retry('Code expired');
  assert.equal(harness.latest.phase, 'editing');
  assert.equal(harness.latest.error, 'Code expired');
  harness.session.input('654321');
  await delay(180);
  assert.deepEqual(harness.submissions, ['654321']);
  harness.session.dispose();
});

test('host verification cancels fading and rejection permits correction', async () => {
  const harness = new SessionHarness();
  harness.session.input('123456');
  harness.session.setVerification({ kind: 'pending' });
  harness.session.input('999999');
  await delay(180);
  assert.deepEqual(harness.submissions, []);
  assert.equal(harness.latest.phase, 'submitting');
  harness.session.setVerification({ kind: 'rejected', message: 'Incorrect code' });
  assert.equal(harness.latest.error, 'Incorrect code');
  assert.equal(harness.latest.phase, 'editing');
  harness.session.input('654321');
  await delay(180);
  assert.deepEqual(harness.submissions, ['654321']);
  harness.session.dispose();
});

test('normalizes input and submits once after fading', async () => {
  const submissions = [];
  const snapshots = [];
  const session = new EmailOtpSession({
    onSubmit: recordSubmit,
    onChange: recordChange,
    resend: null,
  });
  function recordSubmit(code) {
    submissions.push(code);
  }
  function recordChange(snapshot) {
    snapshots.push(snapshot);
  }
  session.input('12 34-56');
  assert.equal(snapshots.at(-1).phase, 'fading');
  session.input('999999');
  await delay(180);
  assert.deepEqual(submissions, ['123456']);
  assert.equal(snapshots.at(-1).phase, 'submitting');
  session.dispose();
});

test('disposal cancels submission and ignores a late resend result', async () => {
  const submissions = [];
  const snapshots = [];
  let resolveResend;
  const pending = new Promise((resolve) => {
    resolveResend = resolve;
  });
  const session = new EmailOtpSession({
    onSubmit: recordSubmit,
    onChange: recordChange,
    resend: { send, cooldownMs: 1000 },
  });
  function recordSubmit(code) {
    submissions.push(code);
  }
  function recordChange(snapshot) {
    snapshots.push(snapshot);
  }
  function send() {
    return pending;
  }
  const resend = session.resend();
  session.input('123456');
  session.dispose();
  const count = snapshots.length;
  resolveResend({ kind: 'sent' });
  await resend;
  await delay(180);
  assert.deepEqual(submissions, []);
  assert.equal(snapshots.length, count);
});
