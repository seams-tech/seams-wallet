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
import './SigningKeysSection.css';

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
type Context = {
  readonly seams: ReturnType<typeof useSeams>['seams'];
  readonly walletId: string;
  readonly nearAccountId: string;
  readonly nearClient: MinimalNearClient;
  readonly live: { current: boolean };
  readonly busy: { current: boolean };
  readonly setState: React.Dispatch<React.SetStateAction<ViewState>>;
};

export function SigningKeysSection(props: {
  readonly walletId: string;
  readonly nearAccountId: string;
}) {
  const { seams } = useSeams();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const context = useMemo(
    buildContext.bind(null, seams, props.walletId, props.nearAccountId, setState),
    [seams, props.walletId, props.nearAccountId],
  );
  useEffect(startMetadataRead.bind(null, context), [context]);
  return (
    <div className="seams-signing-keys">
      <p className="seams-account-description">
        <WalletText copy="Choose how you sign transactions for this NEAR account." />
      </p>
      <p className="seams-signing-key-account">{props.nearAccountId}</p>
      <div className="seams-signing-key-row">
        <strong>Ed25519</strong>
        <span>
          <WalletText
            copy={
              state.kind === 'ready' && state.preference.kind === 'ed25519'
                ? 'Default signing key'
                : 'Standard signing'
            }
          />
        </span>
        <button
          type="button"
          className="seams-account-action"
          disabled={state.kind === 'working' || state.kind === 'loading'}
          onClick={setDefault.bind(null, context, { kind: 'ed25519' })}
        >
          <WalletText copy="Use Ed25519 by default" />
        </button>
      </div>
      {renderState(context, state)}
    </div>
  );
}
function buildContext(
  seams: Context['seams'],
  walletId: string,
  nearAccountId: string,
  setState: Context['setState'],
): Context {
  return {
    seams,
    walletId,
    nearAccountId,
    live: { current: true },
    busy: { current: false },
    setState,
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
  context.setState({ kind: 'working', message: 'Creating your recoverable ML-DSA signer…' });
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
      kind: 'ml_dsa_65',
      walletSession: context.walletId,
      nearAccount: context.nearAccountId,
      signer,
    });
  } catch (error) {
    showFailure(context, error);
  } finally {
    context.busy.current = false;
  }
}
function renderState(context: Context, state: ViewState): React.ReactNode {
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
          {state.rows.map(renderKey.bind(null, context, state.preference))}
          {state.rows.length === 0 ? (
            <>
              <div className="seams-account-inset">
                <WalletText copy="Add an ML-DSA-65 signing key to this account. You can recover it with your existing wallet recovery method." />
              </div>
              <p className="seams-account-description">
                <WalletText copy="Setup creates a signer, then asks you to approve adding a full-access key on NEAR. Existing keys remain valid." />
              </p>
              <button
                type="button"
                className="seams-account-action primary"
                onClick={addSigner.bind(null, context)}
              >
                <WalletText copy="Add ML-DSA signer" />
              </button>
            </>
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
    <div className="seams-signing-key-row" key={row.signer.signingKeyId}>
      <strong>ML-DSA-65</strong>
      <span>
        <WalletText copy={enrollmentLabel(row.enrollment)} />
      </span>
      {preferred ? (
        <small>
          <WalletText copy="Default signing key" />
        </small>
      ) : null}
      <small>{row.signer.signingKeyId}</small>
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
      <details>
        <summary>
          <WalletText copy="Key details" />
        </summary>
        <textarea
          className="seams-signing-key-fingerprint"
          aria-label="ML-DSA public key (base64url)"
          rows={3}
          readOnly
          value={row.signer.publicKeyB64u}
        />
        <button
          type="button"
          className="seams-account-action"
          onClick={exportSigner.bind(null, context, row.signer)}
        >
          <WalletText copy="Export FIPS seed" />
        </button>
      </details>
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
