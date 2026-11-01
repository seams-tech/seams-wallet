import type { WalletSessionCapabilityLaneReadiness } from '@/core/types/seams';
import { signingKeyReadinessLabel } from './signingKeyReadiness';
import type { AccountMenuButtonProps } from './types';
import type { NearSignerPreference } from '@/core/types/nearSigningKeys';
import { RegistrationEventPhase, type RegistrationFlowEvent } from '@/core/types/sdkSentEvents';
import React, { useEffect, useMemo, useState } from 'react';
import { useSeams } from '../../context';
import { WalletText } from '../../context/WalletLocale';
import {
  nearAccountRefFromAccountId,
  walletSessionRefFromSession,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { AddedMlDsaSignerCapability } from '@/core/types/seams';
import type { MlDsaNearEnrollmentOutcome } from '@/core/signingEngine/walletCustody/mlDsaEnrollment';
import {
  NearSigningKeysLifecycle,
  type MlDsaSigningKeyRow as KeyRow,
} from '@/SeamsWeb/operations/near/signingKeys';
import { AccountMenuScreen } from './AccountMenuScreen';
import { SigningKeyDetails } from './SigningKeyDetails';
import './SigningKeysSection.css';

export type NearSigningKeysScreen =
  | { readonly kind: 'list' }
  | { readonly kind: 'add' }
  | { readonly kind: 'ed25519' }
  | { readonly kind: 'ml_dsa_65'; readonly signingKeyId: string };
type Navigation = {
  readonly screen: NearSigningKeysScreen;
  readonly onNavigate: (screen: NearSigningKeysScreen) => void;
};

type ViewState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly rows: readonly KeyRow[];
      readonly preference: NearSignerPreference;
    }
  | { readonly kind: 'working'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };
type ExportHooks = Pick<AccountMenuButtonProps, 'onExportKeyError' | 'onExportKeyEvent'>;
type Context = ExportHooks & {
  readonly nearAccountId: string;
  readonly lifecycle: NearSigningKeysLifecycle;
  readonly live: { current: boolean };
  readonly busy: { current: boolean };
  readonly setState: React.Dispatch<React.SetStateAction<ViewState>>;
};

export function NearSigningKeysSection(
  props: {
    readonly walletId: string;
    readonly nearAccountId: string;
    readonly publicKey: string;
    readonly readiness: WalletSessionCapabilityLaneReadiness;
  } & ExportHooks &
    Navigation,
) {
  const { seams } = useSeams();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const context = useMemo(
    buildContext.bind(
      null,
      seams,
      props.walletId,
      props.nearAccountId,
      setState,
      props.onExportKeyError,
      props.onExportKeyEvent,
    ),
    [seams, props.walletId, props.nearAccountId, props.onExportKeyError, props.onExportKeyEvent],
  );
  useEffect(startMetadataRead.bind(null, context), [context]);
  if (props.screen.kind !== 'list') {
    return renderScreen(context, state, props);
  }
  return (
    <div className="seams-signing-keys">
      <p className="seams-account-description">
        <WalletText copy="NEAR signing keys" />
      </p>
      <p className="seams-signing-key-account">{props.nearAccountId}</p>
      <div className="seams-signing-key-row" role="group" aria-label="Ed25519 signing key">
        <strong>Ed25519</strong>
        <span>
          <WalletText copy={signingKeyReadinessLabel(props.readiness)} />
        </span>
        {state.kind === 'ready' && state.preference.kind === 'ed25519' ? (
          <small className="seams-signing-key-default">
            <WalletText copy="Default signing key" />
          </small>
        ) : null}
        <button
          type="button"
          className="seams-account-action"
          disabled={state.kind === 'working' || state.kind === 'loading'}
          onClick={props.onNavigate.bind(null, { kind: 'ed25519' })}
        >
          <WalletText copy="Key details" />
        </button>
      </div>
      {renderState(context, state, props.onNavigate)}
    </div>
  );
}
function buildContext(
  seams: ReturnType<typeof useSeams>['seams'],
  walletId: string,
  nearAccountId: string,
  setState: Context['setState'],
  onExportKeyError: ExportHooks['onExportKeyError'],
  onExportKeyEvent: ExportHooks['onExportKeyEvent'],
): Context {
  return {
    nearAccountId,
    live: { current: true },
    busy: { current: false },
    setState,
    onExportKeyError,
    onExportKeyEvent,
    lifecycle: new NearSigningKeysLifecycle({
      wallet: seams,
      configs: seams.configs,
      walletSession: walletSessionRefFromSession({ walletId }),
      nearAccount: nearAccountRefFromAccountId(nearAccountId),
    }),
  };
}
function stopMetadataRead(context: Context): void {
  context.live.current = false;
}
function startMetadataRead(context: Context): () => void {
  context.live.current = true;
  void refreshKeys(context);
  return stopMetadataRead.bind(null, context);
}
function showFailure(context: Context, error: unknown): void {
  if (context.live.current)
    context.setState({
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Unable to read signing keys. Try again.',
    });
}
async function refreshKeys(context: Context): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  if (context.live.current) context.setState({ kind: 'loading' });
  try {
    await readKeys(context);
  } catch (error) {
    showFailure(context, error);
  } finally {
    context.busy.current = false;
  }
}
async function readKeys(context: Context): Promise<void> {
  const result = await context.lifecycle.read();
  if (result.kind === 'refused') throw new Error(result.failure.message);
  if (context.live.current)
    context.setState({
      kind: 'ready',
      rows: result.snapshot.rows,
      preference: result.snapshot.preference,
    });
}
function showCreationStage(context: Context, event: RegistrationFlowEvent): void {
  if (event.phase === RegistrationEventPhase.STEP_05_ML_DSA_SIGNER_CREATE_STARTED)
    context.setState({ kind: 'working', message: 'Creating ML-DSA key' });
}
async function addSigner(context: Context): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  context.setState({ kind: 'working', message: 'Preparing secure key material' });
  try {
    const result = await context.lifecycle.create({
      onEvent: showCreationStage.bind(null, context),
    });
    switch (result.kind) {
      case 'unsupported_network':
        throw new Error('This NEAR network does not support ML-DSA yet.');
      case 'registration_failed':
        throw new Error(result.message);
      case 'created':
        break;
      default:
        return assertNever(result);
    }
    await readKeys(context);
  } catch (error) {
    showFailure(context, error);
  } finally {
    context.busy.current = false;
  }
}
async function activateSigner(context: Context, signer: AddedMlDsaSignerCapability): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  context.setState({ kind: 'working', message: 'Add key to NEAR' });
  try {
    const outcome = await context.lifecycle.activate(signer);
    if (outcome.kind === 'refused')
      throw new Error(`Key activation is unavailable: ${outcome.reason}.`);
    await readKeys(context);
  } catch (error) {
    showFailure(context, error);
  } finally {
    context.busy.current = false;
  }
}
async function exportSigner(context: Context, signer: AddedMlDsaSignerCapability): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  try {
    await context.lifecycle.exportMlDsa(signer, { onEvent: context.onExportKeyEvent });
  } catch (error) {
    context.onExportKeyError?.(error instanceof Error ? error : new Error(String(error)));
    showFailure(context, error);
  } finally {
    context.busy.current = false;
  }
}
function renderState(
  context: Context,
  state: ViewState,
  onNavigate: Navigation['onNavigate'],
): React.ReactNode {
  switch (state.kind) {
    case 'loading':
      return (
        <p role="status">
          <WalletText copy="Loading signing keys…" />
        </p>
      );
    case 'working':
      return (
        <p role="status">
          <WalletText copy={state.message} />
        </p>
      );
    case 'failed':
      return (
        <>
          <p role="alert">{state.message}</p>
          <button
            type="button"
            className="seams-account-action"
            onClick={refreshKeys.bind(null, context)}
          >
            <WalletText copy="Try again" />
          </button>
        </>
      );
    case 'ready':
      return (
        <>
          {state.rows.map(renderKey.bind(null, context, state.preference, onNavigate, 'list'))}
          {state.rows.length === 0 ? (
            <button
              type="button"
              className="seams-account-action primary"
              onClick={onNavigate.bind(null, { kind: 'add' })}
            >
              <WalletText copy="Add signer" />
            </button>
          ) : null}
          <button
            type="button"
            className="seams-account-action"
            onClick={refreshKeys.bind(null, context)}
          >
            <WalletText copy="Check status" />
          </button>
        </>
      );
    default:
      return assertNever(state);
  }
}
function renderKey(
  context: Context,
  preference: NearSignerPreference,
  onNavigate: Navigation['onNavigate'],
  presentation: 'list' | 'setup',
  row: KeyRow,
): React.ReactNode {
  if (row.kind === 'pending')
    return (
      <div className="seams-signing-key-row" key={row.entry.signingKeyId}>
        <strong>ML-DSA-65</strong>
        <span>
          <WalletText
            copy={row.entry.kind === 'restoring' ? 'Restoration in progress' : 'Setup in progress'}
          />
        </span>
        <small>{row.entry.signingKeyId}</small>
      </div>
    );
  const canActivate = row.enrollment.kind === 'pending' && row.enrollment.reason === 'not_final';
  const preferred =
    preference.kind === 'near_ml_dsa_65' && preference.signingKeyId === row.signer.signingKeyId;
  return (
    <div
      role="group"
      aria-label="ML-DSA-65 signing key"
      className="seams-signing-key-row"
      key={row.signer.signingKeyId}
    >
      <strong>ML-DSA-65</strong>
      <span>
        <WalletText copy={enrollmentLabel(row.enrollment)} />
      </span>
      {preferred ? (
        <small className="seams-signing-key-default">
          <WalletText copy="Default signing key" />
        </small>
      ) : null}
      <small>{row.signer.signingKeyId}</small>
      {canActivate && presentation === 'setup' ? (
        <p className="seams-account-description">
          <WalletText copy="Next, approve a full-access key on NEAR. This key can authorize any transaction for this account." />
        </p>
      ) : null}
      {canActivate ? (
        <button
          type="button"
          className="seams-account-action primary"
          onClick={
            presentation === 'setup'
              ? activateSigner.bind(null, context, row.signer)
              : onNavigate.bind(null, { kind: 'add' })
          }
        >
          <WalletText
            copy={
              presentation === 'setup' ? 'Approve NEAR key addition' : 'Review NEAR key addition'
            }
          />
        </button>
      ) : null}
      {presentation === 'setup' && row.enrollment.kind === 'enrolled'
        ? renderDefaultAction(context, preference, {
            kind: 'near_ml_dsa_65',
            signingKeyId: row.signer.signingKeyId,
          })
        : null}
      <button
        type="button"
        className="seams-account-action"
        onClick={onNavigate.bind(null, {
          kind: 'ml_dsa_65',
          signingKeyId: row.signer.signingKeyId,
        })}
      >
        <WalletText copy="Key details" />
      </button>
    </div>
  );
}
function assertNever(value: never): never {
  throw new Error(`Unsupported signing key state: ${String(value)}`);
}

async function setDefault(context: Context, preference: NearSignerPreference): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  context.setState({ kind: 'working', message: 'Saving your default signing key…' });
  try {
    await context.lifecycle.setDefault(preference);
    await readKeys(context);
  } catch (error) {
    showFailure(context, error);
  } finally {
    context.busy.current = false;
  }
}
function enrollmentLabel(outcome: MlDsaNearEnrollmentOutcome): string {
  switch (outcome.kind) {
    case 'enrolled':
      return 'Active on NEAR';
    case 'pending':
      return outcome.reason === 'not_final'
        ? 'Created — activation pending'
        : 'Unable to check NEAR activation';
    case 'unavailable':
      return 'NEAR is unavailable. Check status again.';
    case 'refused':
      switch (outcome.reason) {
        case 'restricted_key':
          return 'This key has restricted permissions';
        case 'wrong_wallet':
          return 'This key belongs to another wallet';
        case 'unsupported_protocol':
          return 'This network does not support ML-DSA';
        default:
          return assertNever(outcome);
      }
    default:
      return assertNever(outcome);
  }
}

async function exportEd25519(context: Context): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  try {
    await context.lifecycle.exportEd25519({ onEvent: context.onExportKeyEvent });
  } catch (error) {
    context.onExportKeyError?.(error instanceof Error ? error : new Error(String(error)));
    showFailure(context, error);
  } finally {
    context.busy.current = false;
  }
}

function renderScreen(
  context: Context,
  state: ViewState,
  props: Navigation & {
    readonly publicKey: string;
    readonly readiness: WalletSessionCapabilityLaneReadiness;
  },
): React.ReactNode {
  const back = props.onNavigate.bind(null, { kind: 'list' });
  if (props.screen.kind === 'ed25519') {
    return (
      <SigningKeyDetails
        title="Ed25519"
        account={context.nearAccountId}
        status={signingKeyReadinessLabel(props.readiness)}
        publicKey={props.publicKey}
        publicKeyLabel="Ed25519 public key"
        keyId={null}
        onBack={back}
        onExport={exportEd25519.bind(null, context)}
      >
        {state.kind === 'ready'
          ? renderDefaultAction(context, state.preference, { kind: 'ed25519' })
          : null}
        {state.kind === 'failed' ? <p role="alert">{state.message}</p> : null}
      </SigningKeyDetails>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <AccountMenuScreen title="Signing key setup" onBack={back}>
        {renderState(context, state, props.onNavigate)}
      </AccountMenuScreen>
    );
  }
  switch (props.screen.kind) {
    case 'list':
      return renderState(context, state, props.onNavigate);
    case 'add':
      if (state.rows.length > 0) {
        const complete = state.rows.every(isEnrolledKey);
        return (
          <AccountMenuScreen
            title={complete ? 'Key active' : 'Add key to NEAR'}
            onBack={back}
          >
            <p className="seams-signing-key-account">{context.nearAccountId}</p>
            {complete ? (
              <p role="status">
                <WalletText copy="Your key is active on NEAR. Signing can still require preparation." />
              </p>
            ) : null}
            {state.rows.map(
              renderKey.bind(null, context, state.preference, props.onNavigate, 'setup'),
            )}
            {!complete ? (
              <button
                type="button"
                className="seams-account-action"
                onClick={refreshKeys.bind(null, context)}
              >
                <WalletText copy="Check status" />
              </button>
            ) : null}
            <button type="button" className="seams-account-action" onClick={back}>
              <WalletText copy={complete ? 'Done' : 'Finish later'} />
            </button>
          </AccountMenuScreen>
        );
      }
      return (
        <AccountMenuScreen title="Add signing key" onBack={back}>
          <p className="seams-signing-key-account">{context.nearAccountId}</p>
          <div className="seams-signing-key-row">
            <strong>Ed25519</strong>
            <span>
              <WalletText copy="Already added to this account" />
            </span>
          </div>
          <div className="seams-signing-key-row">
            <strong>ML-DSA-65</strong>
            <span>
              <WalletText copy="Post-quantum signatures for NEAR" />
            </span>
          </div>
          <p className="seams-account-description">
            <WalletText copy="Create your key, then approve adding a full-access key on NEAR. Your existing keys stay active." />
          </p>
          <p className="seams-account-description">
            <WalletText copy="Your existing wallet recovery restores this key. Your default signing key stays the same." />
          </p>
          <button
            type="button"
            className="seams-account-action primary"
            onClick={addSigner.bind(null, context)}
          >
            <WalletText copy="Create key" />
          </button>
          <button type="button" className="seams-account-action" onClick={back}>
            <WalletText copy="Cancel" />
          </button>
        </AccountMenuScreen>
      );
    case 'ml_dsa_65': {
      const signingKeyId = props.screen.signingKeyId;
      const row = state.rows.find(matchesSigningKey.bind(null, signingKeyId));
      if (!row || row.kind !== 'published') {
        return (
          <AccountMenuScreen title="Key details" onBack={back}>
            <p role="status">
              <WalletText copy="This key is unavailable. Check signing key status again." />
            </p>
          </AccountMenuScreen>
        );
      }
      return (
        <SigningKeyDetails
          title="ML-DSA-65"
          account={context.nearAccountId}
          status={enrollmentLabel(row.enrollment)}
          publicKey={row.signer.publicKeyB64u}
          publicKeyLabel="ML-DSA public key (base64url)"
          keyId={row.signer.signingKeyId}
          exportNote="Export contains the standard FIPS ML-DSA seed."
          onBack={back}
          onExport={exportSigner.bind(null, context, row.signer)}
        >
          {row.enrollment.kind === 'enrolled'
            ? renderDefaultAction(context, state.preference, {
                kind: 'near_ml_dsa_65',
                signingKeyId: row.signer.signingKeyId,
              })
            : null}
        </SigningKeyDetails>
      );
    }
    default:
      return assertNever(props.screen);
  }
}
function matchesSigningKey(signingKeyId: string, row: KeyRow): boolean {
  return row.kind === 'published' && row.signer.signingKeyId === signingKeyId;
}

function isEnrolledKey(row: KeyRow): boolean {
  return row.kind === 'published' && row.enrollment.kind === 'enrolled';
}
function renderDefaultAction(
  context: Context,
  current: NearSignerPreference,
  target: NearSignerPreference,
): React.ReactNode {
  const preferred =
    current.kind === target.kind &&
    (current.kind === 'ed25519' ||
      (target.kind === 'near_ml_dsa_65' && current.signingKeyId === target.signingKeyId));
  return (
    <button
      type="button"
      className="seams-account-action"
      disabled={preferred}
      onClick={setDefault.bind(null, context, target)}
    >
      <WalletText copy={preferred ? 'Default signing key' : 'Make default'} />
    </button>
  );
}
