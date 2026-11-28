import { AUTH_CODES, isAuthCode } from '../codes';
import { LOGIN_AUDIENCE, webauthnChallengeB64u } from '../proofs/audience';
import { deviceKeyProofBytes } from '../proofs/deviceKey';
import type { AuthLocale, AuthMenuText } from '../shared/copy';
import type {
  AuthMethodName,
  AuthMethodSummary,
  MethodChangeResult,
  MethodsResult,
  ProveResult,
  SessionResult,
  SignInResult,
} from '../shared/protocol';
import type { ApiFailure, AuthApi } from './api';
import {
  bindDeviceKey,
  boundDeviceKeys,
  createDeviceKey,
  deleteDeviceKey,
  gateStoreFor,
  loadGate,
  signWithDeviceKey,
  type DeviceKeyRecord,
} from './deviceKeys';
import { el, MenuClosedError, type Menu } from './menu';
import {
  PasskeyCancelledError,
  PasskeyUnsupportedError,
  createPasskey,
  getPasskeyAssertion,
  type PasskeyCreationOptions,
} from './passkeys';
import type { PluginProof, PluginProveRequest, PluginProveResult } from './plugins';
import type { SessionStore } from './sessionStore';

// The flows of the account frame: sign-in, the proof of a method and the method changes. Each
// flow shows views of the menu, runs the browser step of a method and calls the Auth Worker.

export type FlowContext = {
  readonly api: AuthApi;
  readonly sessions: SessionStore;
  readonly menu: Menu;
  readonly text: AuthMenuText;
  readonly locale: AuthLocale;
  /** The methods that the app offers. */
  readonly methods: readonly AuthMethodName[];
  readonly rpId: string;
  /** The purpose text of each audience, from the operator's configuration of this origin. */
  readonly purposes: Readonly<Record<string, Readonly<Record<AuthLocale, string>>>>;
  /** The element where a gate draws. */
  readonly gateSurface: HTMLElement;
  /** Aborts when the user or the page closes the dialog. */
  readonly signal: AbortSignal;
  /** Asks each plugin before a method is removed. False refuses the removal. */
  beforeMethodRemoval(method: AuthMethodSummary): Promise<boolean>;
};

type WireMethod = {
  readonly id: string;
  readonly kind: 'passkey' | 'email_otp' | 'voiceid';
  readonly label: string;
  readonly createdAtMs: number;
};

type SignedInBody = {
  readonly sessionToken: string;
  readonly accountId: string;
  readonly loginToken: string;
  readonly loginTokenExpiresAtMs: number;
};

const METHOD_NAME = {
  passkey: 'passkey',
  email_otp: 'email_code',
  voiceid: 'voiceid',
} as const satisfies Record<WireMethod['kind'], AuthMethodName>;

function summary(method: WireMethod): AuthMethodSummary {
  return {
    id: method.id,
    method: METHOD_NAME[method.kind],
    label: method.label,
    createdAtMs: method.createdAtMs,
  };
}

function methodLabel(text: AuthMenuText, method: AuthMethodSummary): string {
  const names = {
    passkey: text.methodPasskey,
    email_code: text.methodEmail,
    voiceid: text.methodVoiceId,
  };
  return names[method.method];
}

/** Shows a refusal of the Auth Worker in the user's language, and reports its raw text. */
function showFailure(context: FlowContext, failure: ApiFailure): void {
  const shown = isAuthCode(failure.code)
    ? AUTH_CODES[failure.code][context.locale]
    : AUTH_CODES.internal[context.locale];
  context.menu.showError(failure.code, shown, failure.message || shown);
}

/** Shows the fault of a passkey prompt. Another error is not a passkey fault. */
function showPasskeyFault(context: FlowContext, error: unknown): void {
  if (error instanceof PasskeyCancelledError) {
    context.menu.showError('passkey_cancelled', context.text.passkeyCancelled);
  } else if (error instanceof PasskeyUnsupportedError) {
    context.menu.showError('passkey_unsupported', context.text.passkeyUnsupported);
  } else {
    throw error;
  }
}

function signedIn(context: FlowContext, body: SignedInBody): SignInResult {
  context.sessions.write({ sessionToken: body.sessionToken, accountId: body.accountId });
  return {
    kind: 'signed_in',
    accountId: body.accountId,
    token: body.loginToken,
    tokenExpiresAtMs: body.loginTokenExpiresAtMs,
  };
}

/** Runs a gate on its own surface, in place of the menu. */
async function passGate(
  context: FlowContext,
  record: DeviceKeyRecord,
  purpose: 'sign_in' | 'prove' | 'method_change',
): Promise<boolean> {
  const gate = await loadGate(record.gate);
  if (!gate) {
    context.menu.showError('voiceid_unavailable', context.text.voiceIdUnavailable);
    return false;
  }
  context.menu.hide();
  context.gateSurface.hidden = false;
  try {
    const answer = await gate.check({
      surface: { element: context.gateSurface, locale: context.locale },
      store: gateStoreFor(record.deviceKeyId),
      purpose,
      signal: context.signal,
    });
    return answer === 'passed';
  } finally {
    context.gateSurface.replaceChildren();
    context.gateSurface.hidden = true;
  }
}

type CodeChoice = { kind: 'code'; code: string } | { kind: 'resend' } | { kind: 'back' };

function askCode(context: FlowContext, address: string): Promise<CodeChoice> {
  const { menu, text } = context;
  return menu.ask<CodeChoice>((choose) => ({
    name: 'email_code',
    title: text.codeTitle,
    subtitle: text.codeSubtitle.replace('{email}', address),
    content: [
      menu.form({
        label: text.codeLabel,
        cta: text.codeCta,
        field: {
          className: 'field code',
          inputMode: 'numeric',
          autocomplete: 'one-time-code',
          pattern: '[0-9]{6}',
          maxLength: 6,
          autofocus: true,
        },
        onSubmit: (code) => choose({ kind: 'code', code }),
      }),
      menu.button(text.resendCta, () => choose({ kind: 'resend' }), 'quiet'),
      menu.button(text.backCta, () => choose({ kind: 'back' }), 'quiet'),
    ],
  }));
}

/**
 * Sends a code and asks for it until the Auth Worker accepts one. `submit` gets each code with
 * its code ID. Null: the user went back.
 */
async function withEmailCode<Body extends object>(
  context: FlowContext,
  address: string,
  send: () => ReturnType<AuthApi['post']>,
  submit: (proof: {
    factor: 'email_code';
    codeId: string;
    code: string;
  }) => Promise<({ ok: true } & Body) | (ApiFailure & Record<string, unknown>)>,
): Promise<(({ ok: true } & Body) | (ApiFailure & Record<string, unknown>)) | null> {
  let sent = await send();
  for (;;) {
    if (!sent.ok) {
      showFailure(context, sent);
      return null;
    }
    const choice = await askCode(context, address);
    if (choice.kind === 'back') return null;
    if (choice.kind === 'resend') {
      sent = await send();
      continue;
    }
    const result = await submit({
      factor: 'email_code',
      codeId: String((sent as { codeId?: unknown }).codeId),
      code: choice.code,
    });
    // A wrong code stays in the code view. Each other answer ends it.
    if (result.ok || result.code !== 'email_code_invalid') return result;
    showFailure(context, result);
  }
}

type StartChoice =
  | { kind: 'passkey' }
  | { kind: 'create' }
  | { kind: 'email'; email: string }
  | { kind: 'voiceid'; record: DeviceKeyRecord };

export async function signInFlow(context: FlowContext): Promise<SignInResult> {
  const { menu, text, methods } = context;
  const deviceKeys = methods.includes('voiceid') ? await boundDeviceKeys() : [];
  for (;;) {
    const choice = await menu.ask<StartChoice>((choose) => ({
      name: 'sign_in',
      title: text.title,
      subtitle: text.subtitle,
      content: [
        methods.includes('passkey') &&
          menu.button(text.passkeyCta, () => choose({ kind: 'passkey' }), 'primary'),
        deviceKeys[0] !== undefined &&
          menu.button(text.voiceIdCta, () => choose({ kind: 'voiceid', record: deviceKeys[0]! })),
        methods.includes('email_code') && el('div', { className: 'divider' }),
        methods.includes('email_code') &&
          menu.form({
            label: text.emailLabel,
            cta: text.emailCta,
            field: { type: 'email', autocomplete: 'email', name: 'email' },
            primary: !methods.includes('passkey'),
            onSubmit: (email) => choose({ kind: 'email', email }),
          }),
        methods.includes('passkey') &&
          menu.button(text.createAccountCta, () => choose({ kind: 'create' }), 'quiet'),
      ],
    }));
    try {
      const result = await signInWith(context, choice);
      if (result) return result;
    } catch (error) {
      showPasskeyFault(context, error);
    }
  }
}

async function signInWith(context: FlowContext, choice: StartChoice): Promise<SignInResult | null> {
  const { api, signal } = context;
  switch (choice.kind) {
    case 'create': {
      const options = await api.post<PasskeyCreationOptions & { challengeId: string }>(
        '/v1/passkeys/options',
      );
      if (!options.ok) return (showFailure(context, options), null);
      const registration = await createPasskey(options, signal);
      const created = await api.post<SignedInBody>('/v1/passkeys', {
        challengeId: options.challengeId,
        registration,
      });
      return created.ok ? signedIn(context, created) : (showFailure(context, created), null);
    }
    case 'passkey':
    case 'voiceid': {
      if (choice.kind === 'voiceid' && !(await passGate(context, choice.record, 'sign_in'))) {
        return null;
      }
      const start = await api.post<{ challengeId: string; challenge: string }>('/v1/sign-in/start');
      if (!start.ok) return (showFailure(context, start), null);
      const proof =
        choice.kind === 'passkey'
          ? {
              factor: 'webauthn',
              assertion: (
                await getPasskeyAssertion(
                  {
                    rpId: context.rpId,
                    challengeB64u: await webauthnChallengeB64u(LOGIN_AUDIENCE, start.challenge),
                  },
                  signal,
                )
              ).assertion,
            }
          : await deviceKeyProof(choice.record, LOGIN_AUDIENCE, start.challenge);
      const result = await api.post<SignedInBody>('/v1/sign-in', {
        challengeId: start.challengeId,
        proof,
      });
      return result.ok ? signedIn(context, result) : (showFailure(context, result), null);
    }
    case 'email':
      return await signInWithEmail(context, choice.email);
  }
}

async function deviceKeyProof(record: DeviceKeyRecord, audience: string, challenge: string) {
  const methodId = record.methodId ?? '';
  return {
    factor: 'device_key',
    methodId,
    signatureB64u: await signWithDeviceKey(
      record,
      deviceKeyProofBytes({ audience, challenge, methodId, deviceKeyId: record.deviceKeyId }),
    ),
  };
}

async function signInWithEmail(context: FlowContext, email: string): Promise<SignInResult | null> {
  const { api, menu, text, locale } = context;
  let accountId: string | undefined;
  let proof: { factor: 'email_code'; codeId: string; code: string } | undefined;
  const result = await withEmailCode<SignedInBody>(
    context,
    email,
    () => api.post('/v1/email-codes', { audience: LOGIN_AUDIENCE, email, locale }),
    (codeProof) => {
      proof = codeProof;
      return api.post<SignedInBody>('/v1/sign-in', { proof: codeProof });
    },
  );
  if (!result) return null;
  if (result.ok) return signedIn(context, result);
  if (result.code !== 'account_choice_required' || !Array.isArray(result.accounts) || !proof) {
    return (showFailure(context, result), null);
  }
  // The address is a method of more than one account. The same code signs in to the chosen one.
  const accounts = result.accounts.filter((id): id is string => typeof id === 'string');
  accountId = await menu.ask<string>((choose) => ({
    name: 'account_choice',
    title: text.accountChoiceTitle,
    content: accounts.map((id) => menu.button(id, () => choose(id))),
  }));
  const chosen = await api.post<SignedInBody>('/v1/sign-in', { proof, accountId });
  return chosen.ok ? signedIn(context, chosen) : (showFailure(context, chosen), null);
}

/** The login session as the app page sees it: a new login token, with no dialog. */
export async function readSession(
  context: Pick<FlowContext, 'api' | 'sessions'>,
): Promise<SessionResult> {
  const stored = context.sessions.read();
  if (!stored) return { kind: 'none' };
  const minted = await context.api.post<{
    loginToken: string;
    loginTokenExpiresAtMs: number;
    accountId: string;
  }>('/v1/session/token', {}, stored.sessionToken);
  if (!minted.ok) {
    // The Auth Worker ended the session. A fault of the network keeps it.
    if (minted.code === 'unauthorized') context.sessions.clear();
    return { kind: 'none' };
  }
  return {
    kind: 'session',
    accountId: minted.accountId,
    token: minted.loginToken,
    tokenExpiresAtMs: minted.loginTokenExpiresAtMs,
  };
}

async function accountMethods(
  context: Pick<FlowContext, 'api' | 'sessions'>,
): Promise<{ sessionToken: string; accountId: string; methods: AuthMethodSummary[] } | null> {
  const stored = context.sessions.read();
  if (!stored) return null;
  const account = await context.api.post<{ accountId: string; methods: WireMethod[] }>(
    '/v1/account',
    {},
    stored.sessionToken,
  );
  if (!account.ok) return null;
  return {
    sessionToken: stored.sessionToken,
    accountId: account.accountId,
    methods: account.methods.map(summary),
  };
}

export async function listMethods(
  context: Pick<FlowContext, 'api' | 'sessions'>,
): Promise<MethodsResult> {
  const account = await accountMethods(context);
  return account
    ? { kind: 'methods', methods: account.methods }
    : { kind: 'unavailable', reason: 'not_signed_in' };
}

type ProofSource = {
  readonly audience: string;
  readonly challenge: string;
  readonly purpose?: string;
  /** The view of the menu, for an error report. */
  readonly view: string;
  readonly title: string;
  readonly subtitle?: string;
  /** The methods that can prove. */
  readonly candidates: readonly AuthMethodSummary[];
  readonly prfSalt?: ArrayBuffer;
  readonly deviceKeyMessage?: Uint8Array<ArrayBuffer>;
  /** Turns the checked code of an email method into its proof. */
  emailProof(proof: {
    factor: 'email_code';
    codeId: string;
    code: string;
  }): Promise<({ ok: true } & { statement?: string }) | (ApiFailure & Record<string, unknown>)>;
};

type Proven = {
  readonly method: AuthMethodSummary;
  readonly proof: PluginProof | { factor: 'email_code'; codeId: string; code: string };
  readonly prfFirst: ArrayBuffer | null;
};

/**
 * Asks the user for one of the candidate methods and runs its browser step. Null: the user
 * went back, or the step failed and the menu shows why.
 */
async function proveWithOneMethod(
  context: FlowContext,
  source: ProofSource,
): Promise<Proven | null> {
  const { api, menu, text, locale, signal } = context;
  const deviceKeys = await boundDeviceKeys();
  const usable = source.candidates.filter(
    (method) =>
      method.method !== 'voiceid' || deviceKeys.some((record) => record.methodId === method.id),
  );
  const purposeText = context.purposes[source.audience]?.[locale];
  const method = await menu.ask<AuthMethodSummary>((choose) => ({
    name: source.view,
    title: source.title,
    subtitle: source.subtitle,
    content: [
      purposeText ? el('p', { className: 'purpose', textContent: purposeText }) : null,
      ...usable.map((candidate, index) =>
        menu.button(
          candidate.method === 'passkey'
            ? text.provePasskeyCta
            : candidate.method === 'email_code'
              ? text.proveEmailCta.replace('{email}', candidate.label)
              : text.proveVoiceIdCta,
          () => choose(candidate),
          index === 0 ? 'primary' : 'plain',
        ),
      ),
    ],
  }));
  try {
    switch (method.method) {
      case 'passkey': {
        const asserted = await getPasskeyAssertion(
          {
            rpId: context.rpId,
            challengeB64u: await webauthnChallengeB64u(source.audience, source.challenge),
            ...(source.prfSalt ? { prfSalt: source.prfSalt } : {}),
          },
          signal,
        );
        return {
          method,
          proof: { factor: 'webauthn', assertion: asserted.assertion },
          prfFirst: asserted.prfFirst,
        };
      }
      case 'voiceid': {
        const record = deviceKeys.find((candidate) => candidate.methodId === method.id);
        if (!record || !(await passGate(context, record, 'prove'))) return null;
        const signatureB64u = source.deviceKeyMessage
          ? await signWithDeviceKey(record, source.deviceKeyMessage)
          : (await deviceKeyProof(record, source.audience, source.challenge)).signatureB64u;
        return { method, proof: { factor: 'device_key', signatureB64u }, prfFirst: null };
      }
      case 'email_code': {
        let statement: string | undefined;
        let accepted: Proven['proof'] | undefined;
        const result = await withEmailCode<{ statement?: string }>(
          context,
          method.label,
          () =>
            api.post('/v1/email-codes', {
              audience: source.audience,
              challenge: source.challenge,
              ...(source.purpose ? { purpose: source.purpose } : {}),
              methodId: method.id,
              locale,
            }),
          async (codeProof) => {
            accepted = codeProof;
            const checked = await source.emailProof(codeProof);
            if (checked.ok) statement = checked.statement;
            return checked;
          },
        );
        if (!result) return null;
        if (!result.ok) return (showFailure(context, result), null);
        const proof = statement ? ({ factor: 'email_code', statement } as const) : accepted;
        return proof ? { method, proof, prfFirst: null } : null;
      }
    }
  } catch (error) {
    showPasskeyFault(context, error);
    return null;
  }
}

/** The proof of a method for the app page: a signed statement of the Auth Worker. */
export async function proveFlow(
  context: FlowContext,
  request: { readonly audience: string; readonly challenge: string },
): Promise<ProveResult> {
  const account = await accountMethods(context);
  if (!account) return { kind: 'unavailable', reason: 'not_signed_in' };
  const post = (proof: object) =>
    context.api.post<{ statement: string; expiresAtMs: number }>(
      '/v1/proofs',
      { audience: request.audience, challenge: request.challenge, proof },
      account.sessionToken,
    );
  for (;;) {
    let result: Awaited<ReturnType<typeof post>> | undefined;
    const proven = await proveWithOneMethod(context, {
      ...request,
      view: 'prove',
      title: context.text.proveTitle,
      candidates: account.methods,
      async emailProof(codeProof) {
        result = await post(codeProof);
        return result;
      },
    });
    if (!proven) continue;
    if (proven.proof.factor === 'device_key') {
      result = await post({ ...proven.proof, methodId: proven.method.id });
    } else if (proven.proof.factor === 'webauthn') {
      result = await post(proven.proof);
    }
    if (result?.ok) {
      return { kind: 'proved', statement: result.statement, expiresAtMs: result.expiresAtMs };
    }
    if (result) showFailure(context, result);
  }
}

/**
 * The proof of a method for a plugin: the raw proof, for the plugin's own server to check
 * against the key that it pinned. For an email code it is the statement of the Auth Worker. A
 * PRF result goes into the plugin's secret sink and nowhere else.
 */
export async function pluginProveFlow(
  context: FlowContext,
  request: PluginProveRequest,
): Promise<PluginProveResult> {
  const account = await accountMethods(context);
  if (!account) return { kind: 'unavailable', reason: 'not_signed_in' };
  const candidates = request.methodId
    ? account.methods.filter((method) => method.id === request.methodId)
    : account.methods;
  if (candidates.length === 0) return { kind: 'unavailable', reason: 'no_method' };
  for (;;) {
    const proven = await proveWithOneMethod(context, {
      audience: request.audience,
      challenge: request.challenge,
      purpose: request.purpose,
      view: 'prove',
      title: context.text.proveTitle,
      candidates,
      prfSalt: request.secretSink ? request.prfSalt : undefined,
      deviceKeyMessage: request.deviceKeyMessage,
      emailProof: (proof) =>
        context.api.post<{ statement: string }>(
          '/v1/proofs',
          { audience: request.audience, challenge: request.challenge, proof },
          account.sessionToken,
        ),
    });
    if (!proven || (proven.proof.factor === 'email_code' && !('statement' in proven.proof)))
      continue;
    if (request.secretSink && proven.prfFirst) {
      request.secretSink.postMessage({ type: 'factor_secret', secret: proven.prfFirst }, [
        proven.prfFirst,
      ]);
    }
    return {
      kind: 'proved',
      accountId: account.accountId,
      methodId: proven.method.id,
      method: proven.method.method,
      proof: proven.proof as PluginProof,
    };
  }
}

export async function addMethodFlow(
  context: FlowContext,
  method: AuthMethodName,
): Promise<MethodChangeResult> {
  const { api, menu, text, locale, signal } = context;
  const account = await accountMethods(context);
  if (!account) return { kind: 'unavailable', reason: 'not_signed_in' };
  const session = account.sessionToken;
  const done = async (): Promise<MethodChangeResult> => {
    const after = await accountMethods(context);
    return { kind: 'done', methods: after?.methods ?? account.methods };
  };
  for (;;) {
    try {
      if (method === 'passkey') {
        await menu.ask<true>((choose) => ({
          name: 'add_passkey',
          title: text.addPasskeyCta,
          content: [menu.button(text.addPasskeyCta, () => choose(true), 'primary')],
        }));
        const options = await api.post<PasskeyCreationOptions & { challengeId: string }>(
          '/v1/passkeys/options',
          {},
          session,
        );
        if (!options.ok) {
          showFailure(context, options);
          continue;
        }
        const registration = await createPasskey(options, signal);
        const added = await api.post(
          '/v1/passkeys',
          { challengeId: options.challengeId, registration },
          session,
        );
        if (added.ok) return await done();
        showFailure(context, added);
      } else if (method === 'email_code') {
        const email = await menu.ask<string>((choose) => ({
          name: 'add_email',
          title: text.addEmailCta,
          content: [
            menu.form({
              label: text.emailLabel,
              cta: text.emailCta,
              field: { type: 'email', autocomplete: 'email', name: 'email', autofocus: true },
              onSubmit: choose,
            }),
          ],
        }));
        const added = await withEmailCode(
          context,
          email,
          () =>
            api.post('/v1/email-codes', { audience: 'auth_add_method', email, locale }, session),
          (proof) => api.post('/v1/methods/email', { proof }, session),
        );
        if (added?.ok) return await done();
        if (added) showFailure(context, added);
      } else {
        await menu.ask<true>((choose) => ({
          name: 'add_voiceid',
          title: text.addVoiceIdCta,
          content: [menu.button(text.addVoiceIdCta, () => choose(true), 'primary')],
        }));
        if (await addVoiceId(context, account)) return await done();
      }
    } catch (error) {
      showPasskeyFault(context, error);
    }
  }
}

/** Enrolls the gate, makes a device key and stores it as a method. False: the menu shows why. */
async function addVoiceId(
  context: FlowContext,
  account: { sessionToken: string; accountId: string },
): Promise<boolean> {
  const { api, menu, locale, signal } = context;
  const gate = await loadGate('voice');
  if (!gate) {
    menu.showError('voiceid_unavailable', context.text.voiceIdUnavailable);
    return false;
  }
  const record = await createDeviceKey('voice');
  menu.hide();
  context.gateSurface.hidden = false;
  let enrolled: 'enrolled' | 'cancelled';
  try {
    enrolled = await gate.enroll({
      surface: { element: context.gateSurface, locale },
      store: gateStoreFor(record.deviceKeyId),
      signal,
    });
  } finally {
    context.gateSurface.replaceChildren();
    context.gateSurface.hidden = true;
  }
  const change =
    enrolled === 'enrolled'
      ? await api.post<{ challengeId: string; challenge: string }>(
          '/v1/methods/change',
          {},
          account.sessionToken,
        )
      : null;
  const added = change?.ok
    ? await api.post<{ method: WireMethod }>(
        '/v1/methods/device-key',
        {
          challengeId: change.challengeId,
          publicKeyB64u: record.publicKeyB64u,
          signatureB64u: await signWithDeviceKey(
            record,
            deviceKeyProofBytes({
              audience: 'auth_add_method',
              challenge: change.challenge,
              methodId: record.deviceKeyId,
              deviceKeyId: record.deviceKeyId,
            }),
          ),
        },
        account.sessionToken,
      )
    : change;
  if (added?.ok) {
    await bindDeviceKey(record, { methodId: added.method.id, accountId: account.accountId });
    return true;
  }
  await deleteDeviceKey(record.deviceKeyId);
  if (added) showFailure(context, added);
  return false;
}

export async function removeMethodFlow(
  context: FlowContext,
  id: string,
): Promise<MethodChangeResult> {
  const { api, text } = context;
  const account = await accountMethods(context);
  if (!account) return { kind: 'unavailable', reason: 'not_signed_in' };
  const target = account.methods.find((method) => method.id === id);
  if (!target) return { kind: 'unavailable', reason: 'not_found' };
  if (!(await context.beforeMethodRemoval(target))) {
    return { kind: 'unavailable', reason: 'removal_refused' };
  }
  const others = account.methods.filter((method) => method.id !== id);
  if (others.length === 0) return { kind: 'unavailable', reason: 'last_method' };
  for (;;) {
    const change = await api.post<{ challengeId: string; challenge: string }>(
      '/v1/methods/change',
      { removeMethodId: id },
      account.sessionToken,
    );
    if (!change.ok) return { kind: 'unavailable', reason: change.code };
    const proven = await proveWithOneMethod(context, {
      audience: 'auth_remove_method',
      challenge: change.challenge,
      view: 'remove_method',
      title: text.removeTitle,
      subtitle: `${methodLabel(text, target)} ${target.label}`.trim() + ` — ${text.removeSubtitle}`,
      candidates: others,
      // The removal route checks the code itself.
      emailProof: async () => ({ ok: true }),
    });
    if (!proven) continue;
    const removed = await api.post<{ methods: WireMethod[] }>(
      '/v1/methods/remove',
      {
        methodId: id,
        challengeId: change.challengeId,
        proof:
          proven.proof.factor === 'device_key'
            ? { ...proven.proof, methodId: proven.method.id }
            : proven.proof,
      },
      account.sessionToken,
    );
    if (removed.ok) {
      for (const record of await boundDeviceKeys()) {
        if (record.methodId === id) await deleteDeviceKey(record.deviceKeyId);
      }
      return { kind: 'done', methods: removed.methods.map(summary) };
    }
    showFailure(context, removed);
  }
}

export { MenuClosedError };
