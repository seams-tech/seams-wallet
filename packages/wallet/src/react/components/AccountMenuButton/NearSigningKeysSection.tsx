import type { WalletSessionCapabilityLaneReadiness } from '@/core/types/seams';
import { signingKeyReadinessLabel } from './signingKeyReadiness';
import type { AccountMenuButtonProps } from './types';
import { resolveWalletRpId } from '@/SeamsWeb/walletIframe/shared/configuration';
import type { NearSignerPreference } from '@/core/types/nearSigningKeys';
import React, { useEffect, useMemo, useState } from 'react';
import { useSeams } from '../../context';
import { WalletText } from '../../context/WalletLocale';
import { MinimalNearClient } from '@/core/rpcClients/near/NearClient';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import {
  nearAccountRefFromAccountId,
  walletSessionRefFromSession,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { AddedMlDsaSignerCapability } from '@/core/types/seams';
import type { MlDsaSignerInventoryEntry } from '@shared/near/mlDsaInventory';
import type { MlDsaNearEnrollmentOutcome } from '@/core/signingEngine/walletCustody/mlDsaEnrollment';
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

type KeyRow =
  | {
      readonly kind: 'published';
      readonly signer: AddedMlDsaSignerCapability;
      readonly enrollment: MlDsaNearEnrollmentOutcome;
    }
  | {
      readonly kind: 'pending';
      readonly entry: Exclude<MlDsaSignerInventoryEntry, { readonly kind: 'published' }>;
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
  readonly seams: ReturnType<typeof useSeams>['seams'];
  readonly walletId: string;
  readonly nearAccountId: string;
  readonly nearClient: MinimalNearClient;
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
          disabled={
            state.kind === 'working' ||
            state.kind === 'loading' ||
            (state.kind === 'ready' && state.preference.kind === 'ed25519')
          }
          onClick={setDefault.bind(null, context, { kind: 'ed25519' })}
        >
          <WalletText copy="Make default" />
        </button>
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
  seams: Context['seams'],
  walletId: string,
  nearAccountId: string,
  setState: Context['setState'],
  onExportKeyError: ExportHooks['onExportKeyError'],
  onExportKeyEvent: ExportHooks['onExportKeyEvent'],
): Context {
  return {
    seams,
    walletId,
    nearAccountId,
    live: { current: true },
    busy: { current: false },
    setState,
    onExportKeyError,
    onExportKeyEvent,
    nearClient: new MinimalNearClient(resolvePrimaryNearRpcUrl(seams.configs.network.chains)),
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
  const [inventory, preference] = await Promise.all([
    context.seams.near.getMlDsaSigners({ walletSession: context.walletId }),
    context.seams.near.getDefaultSigner({
      walletSession: context.walletId,
      nearAccount: context.nearAccountId,
    }),
  ]);
  if (inventory.kind !== 'inventory') throw new Error(inventory.message);
  const rows: KeyRow[] = [];
  for (const entry of inventory.entries) {
    if (entry.kind !== 'published') {
      rows.push({ kind: 'pending', entry });
      continue;
    }
    const signer: AddedMlDsaSignerCapability = {
      kind: 'near_ml_dsa_65',
      signingKeyId: entry.key.signingKeyId,
      publicKeyB64u: entry.key.publicKeyB64u,
      keyManifestDigestB64u: entry.key.keyManifestDigestB64u,
      materialEpoch: entry.key.materialEpoch,
    };
    const { resumeMlDsaNearEnrollment } =
      await import('@/core/signingEngine/walletCustody/mlDsaEnrollment');
    const enrollment = await resumeMlDsaNearEnrollment({
      nearClient: context.nearClient,
      continuation: {
        kind: 'awaiting_chain',
        request: {
          walletSession: walletSessionRefFromSession({ walletId: context.walletId }),
          nearAccount: nearAccountRefFromAccountId(context.nearAccountId),
          publication: { walletId: toWalletId(context.walletId), signer },
        },
      },
    });
    rows.push({ kind: 'published', signer, enrollment });
  }
  if (context.live.current) context.setState({ kind: 'ready', rows, preference });
}
async function addSigner(context: Context): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  context.setState({ kind: 'working', message: 'Creating your signing key…' });
  try {
    const { supportsMlDsaNearNetwork } =
      await import('@/core/signingEngine/walletCustody/mlDsaEnrollment');
    if (!(await supportsMlDsaNearNetwork(context.nearClient)))
      throw new Error('This NEAR network does not support ML-DSA yet.');
    const result = await context.seams.registration.addSigner({
      walletId: toWalletId(context.walletId),
      rpId: resolveWalletRpId(context.seams.configs),
      signerSelection: { mode: 'ml_dsa_65', mlDsa: { signerSlot: 1, purpose: { kind: 'create' } } },
    });
    if (!result.success) throw new Error(result.error);
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
  context.setState({ kind: 'working', message: 'Approve adding this signing key to NEAR…' });
  try {
    const { enrollMlDsaNearSigner } =
      await import('@/core/signingEngine/walletCustody/mlDsaEnrollment');
    const outcome = await enrollMlDsaNearSigner({
      near: context.seams.near,
      nearClient: context.nearClient,
      walletSession: walletSessionRefFromSession({ walletId: context.walletId }),
      nearAccount: nearAccountRefFromAccountId(context.nearAccountId),
      publication: { walletId: toWalletId(context.walletId), signer },
    });
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
    await context.seams.keys.exportKey({
      options: { onEvent: context.onExportKeyEvent },
      kind: 'ml_dsa_65',
      walletSession: context.walletId,
      nearAccount: context.nearAccountId,
      signer,
    });
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
          {state.rows.map(renderKey.bind(null, context, state.preference, onNavigate))}
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
  const active = row.enrollment.kind === 'enrolled';
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
      {canActivate ? (
        <p className="seams-account-description">
          <WalletText copy="Next, approve a full-access key on NEAR. This key can authorize any transaction for this account." />
        </p>
      ) : null}
      {canActivate ? (
        <button
          type="button"
          className="seams-account-action primary"
          onClick={activateSigner.bind(null, context, row.signer)}
        >
          <WalletText copy="Approve NEAR key addition" />
        </button>
      ) : null}
      {active && !preferred ? (
        <button
          type="button"
          className="seams-account-action"
          onClick={setDefault.bind(null, context, {
            kind: 'near_ml_dsa_65',
            signingKeyId: row.signer.signingKeyId,
          })}
        >
          <WalletText copy="Make default" />
        </button>
      ) : null}
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
    await context.seams.near.setDefaultSigner({
      walletSession: context.walletId,
      nearAccount: context.nearAccountId,
      preference,
    });
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
      return 'Available';
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
    await context.seams.keys.exportKey({
      options: { onEvent: context.onExportKeyEvent },
      kind: 'ed25519',
      walletSession: context.walletId,
      nearAccount: context.nearAccountId,
    });
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
        return (
          <AccountMenuScreen title="Add key to NEAR" onBack={back}>
            <p className="seams-signing-key-account">{context.nearAccountId}</p>
            {state.rows.map(renderKey.bind(null, context, state.preference, props.onNavigate))}
            <button type="button" className="seams-account-action" onClick={back}>
              <WalletText copy="Back to signing keys" />
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
        />
      );
    }
    default:
      return assertNever(props.screen);
  }
}
function matchesSigningKey(signingKeyId: string, row: KeyRow): boolean {
  return row.kind === 'published' && row.signer.signingKeyId === signingKeyId;
}
