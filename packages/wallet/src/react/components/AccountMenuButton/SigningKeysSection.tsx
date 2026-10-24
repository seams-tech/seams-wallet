import type { Variant } from '@shared/utils/variant';
import { signingKeyReadinessLabel } from './signingKeyReadiness';
import type { AccountMenuButtonProps } from './types';
import React, { useEffect, useMemo, useState } from 'react';
import { useSeams } from '../../context';
import { WalletText } from '../../context/WalletLocale';
import type {
  NearProvisioningState,
  WalletSessionAppIdentity,
  WalletSessionCapabilityLaneReadiness,
} from '@/core/types/seams';
import type { ThresholdEcdsaChainTarget } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { resolveWalletRpId } from '@/SeamsWeb/walletIframe/shared/configuration';
import { listThresholdEcdsaProvisionTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import { isNearChainNetwork } from '@/core/config/chains';
import { THRESHOLD_SECP256K1_ECDSA_2P_PARTICIPANT_IDS_V1 } from '@shared/threshold/secp256k1';
import { THRESHOLD_ED25519_2P_PARTICIPANT_IDS } from '@shared/threshold/participants';
import {
  NEAR_ED25519_YAO_KEY_VERSION_V1,
  REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION,
  type AddSignerSelection,
} from '@shared/utils/registrationSignerPlan';
import { NearSigningKeysSection } from './NearSigningKeysSection';
import './SigningKeysSection.css';

type EcdsaKey = {
  readonly id: string;
  readonly target: ThresholdEcdsaChainTarget;
  readonly readiness: WalletSessionCapabilityLaneReadiness;
};
type AddableSigner = Variant<AddSignerSelection, 'mode', 'ed25519' | 'ecdsa'>;
type Inventory = {
  readonly identity: Variant<WalletSessionAppIdentity, 'kind', 'resolved'>;
  readonly nearReadiness: WalletSessionCapabilityLaneReadiness | null;
  readonly provisioning: NearProvisioningState | null;
  readonly ecdsa: readonly EcdsaKey[];
  readonly additions: readonly AddableSigner[];
};
type ViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly inventory: Inventory }
  | { readonly kind: 'working'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };
type ExportHooks = Pick<AccountMenuButtonProps, 'onExportKeyError' | 'onExportKeyEvent'>;
type Context = ExportHooks & {
  readonly seams: ReturnType<typeof useSeams>['seams'];
  readonly walletId: string;
  readonly live: { current: boolean };
  readonly busy: { current: boolean };
  readonly setState: React.Dispatch<React.SetStateAction<ViewState>>;
};
export function SigningKeysSection({
  walletId,
  onExportKeyError,
  onExportKeyEvent,
}: { readonly walletId: string } & ExportHooks) {
  const { seams } = useSeams();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const context = useMemo(
    createContext.bind(null, seams, walletId, setState, onExportKeyError, onExportKeyEvent),
    [seams, walletId, onExportKeyError, onExportKeyEvent],
  );
  useEffect(startRead.bind(null, context), [context]);
  return (
    <div className="seams-signing-keys">
      <p className="seams-account-description">
        <WalletText copy="Manage the signing keys for your accounts. Recovery and linked-device access use your wallet permissions." />
      </p>
      {renderState(context, state)}
    </div>
  );
}
function createContext(
  seams: Context['seams'],
  walletId: string,
  setState: Context['setState'],
  onExportKeyError: ExportHooks['onExportKeyError'],
  onExportKeyEvent: ExportHooks['onExportKeyEvent'],
): Context {
  return {
    seams,
    walletId,
    setState,
    onExportKeyError,
    onExportKeyEvent,
    live: { current: true },
    busy: { current: false },
  };
}
function startRead(context: Context): () => void {
  context.live.current = true;
  void refresh(context);
  return stopRead.bind(null, context);
}
function stopRead(context: Context): void {
  context.live.current = false;
}
function fail(context: Context, error: unknown): void {
  if (context.live.current)
    context.setState({
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Unable to read signing keys.',
    });
}
async function refresh(context: Context): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  try {
    const session = await context.seams.auth.getSession(context.walletId);
    if (
      session.authentication.kind !== 'authenticated' ||
      session.authentication.walletId !== context.walletId ||
      session.appIdentity.kind !== 'resolved' ||
      session.appIdentity.walletId !== context.walletId
    )
      throw new Error('Unlock this wallet to manage signing keys.');
    const ecdsa: EcdsaKey[] = [];
    const projection = session.capabilityProjection;
    if (projection.kind !== 'resolved')
      throw new Error('Signing key availability is not resolved. Unlock this wallet again.');
    let hasEcdsa = false;
    let hasNear = false;
    let nearReadiness: WalletSessionCapabilityLaneReadiness | null = null;
    for (const capability of projection.capabilities) {
      switch (capability.kind) {
        case 'near_ed25519':
          hasNear = true;
          nearReadiness = capability.lane;
          break;
        case 'evm_family_ecdsa':
          hasEcdsa = true;
          if (capability.targets.kind === 'configured_targets') {
            for (const lane of capability.targets.lanes)
              ecdsa.push({
                id: capability.subject.ecdsaThresholdKeyId,
                target: lane.chainTarget,
                readiness: lane.readiness,
              });
          }
          break;
        default:
          assertNever(capability);
      }
    }
    const additions: AddableSigner[] = [];
    const configs = context.seams.configs;
    const provisioning = hasNear
      ? null
      : await context.seams.registration.getNearAccountState({ walletId: context.walletId });
    if (!hasNear && provisioning === null && configs.network.chains.some(isNearConfig))
      additions.push({
        mode: 'ed25519',
        ed25519: {
          mode: 'create_implicit_near_account',
          signerSlot: 1,
          participantIds: [...THRESHOLD_ED25519_2P_PARTICIPANT_IDS],
          keyPurpose: 'near_tx',
          keyVersion: NEAR_ED25519_YAO_KEY_VERSION_V1,
          derivationVersion: REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION,
        },
      });
    if (!hasEcdsa) {
      const targets = listThresholdEcdsaProvisionTargets({
        chains: configs.network.chains,
        signerOptions: configs.signing.thresholdEcdsa.provisioningDefaults,
      });
      if (targets.length)
        additions.push({
          mode: 'ecdsa',
          ecdsa: {
            chainTargets: targets.map(targetForAddition),
            participantIds: [...THRESHOLD_SECP256K1_ECDSA_2P_PARTICIPANT_IDS_V1],
          },
        });
    }
    if (context.live.current)
      context.setState({
        kind: 'ready',
        inventory: { identity: session.appIdentity, nearReadiness, provisioning, ecdsa, additions },
      });
  } catch (error) {
    fail(context, error);
  } finally {
    context.busy.current = false;
  }
}
function isNearConfig(
  chain: ReturnType<typeof useSeams>['seams']['configs']['network']['chains'][number],
): boolean {
  return isNearChainNetwork(chain.network);
}
function targetForAddition(target: ReturnType<typeof listThresholdEcdsaProvisionTargets>[number]) {
  return target.chainTarget;
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
            onClick={refresh.bind(null, context)}
          >
            <WalletText copy="Try again" />
          </button>
        </>
      );
    case 'ready': {
      const identity = state.inventory.identity;
      return (
        <>
          {identity.nearAccountId &&
          identity.nearOperationalPublicKey &&
          state.inventory.nearReadiness ? (
            <section aria-label="NEAR signing keys">
              <NearSigningKeysSection
                walletId={context.walletId}
                nearAccountId={identity.nearAccountId}
                publicKey={identity.nearOperationalPublicKey}
                readiness={state.inventory.nearReadiness}
                onExportKeyError={context.onExportKeyError}
                onExportKeyEvent={context.onExportKeyEvent}
              />
            </section>
          ) : null}
          {state.inventory.provisioning ? (
            <section aria-label="NEAR setup" className="seams-signing-key-row">
              <strong>NEAR</strong>
              <p role="status">
                <WalletText copy={provisioningLabel(state.inventory.provisioning)} />
              </p>
              <button
                type="button"
                className="seams-account-action"
                onClick={refresh.bind(null, context)}
              >
                <WalletText copy="Check status" />
              </button>
            </section>
          ) : null}
          {state.inventory.ecdsa.map(renderEcdsa.bind(null, context, identity))}
          {state.inventory.additions.map(renderAddition.bind(null, context))}
        </>
      );
    }
    default:
      return assertNever(state);
  }
}
function renderEcdsa(
  context: Context,
  identity: Inventory['identity'],
  key: EcdsaKey,
): React.ReactNode {
  return (
    <section
      className="seams-signing-key-row"
      aria-label={`ECDSA ${key.target.networkSlug}`}
      key={`${key.id}:${key.target.networkSlug}`}
    >
      <h3>{key.target.networkSlug}</h3>
      <strong>ECDSA</strong>
      <p className="seams-signing-key-account">{identity.thresholdEcdsaEthereumAddress}</p>
      <span>
        <WalletText copy={signingKeyReadinessLabel(key.readiness)} />
      </span>
      <details>
        <summary>
          <WalletText copy="Key details" />
        </summary>
        <p className="seams-signing-key-account">
          <WalletText copy="Key ID" />: {key.id}
        </p>
        {identity.thresholdEcdsaPublicKeyB64u ? (
          <textarea
            className="seams-signing-key-fingerprint"
            aria-label="ECDSA public key (base64url)"
            rows={3}
            readOnly
            value={identity.thresholdEcdsaPublicKeyB64u}
          />
        ) : null}
        <button
          type="button"
          className="seams-account-action"
          onClick={exportEcdsa.bind(null, context, key.target)}
        >
          <WalletText copy="Export key" />
        </button>
      </details>
    </section>
  );
}
async function exportEcdsa(context: Context, target: ThresholdEcdsaChainTarget): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  try {
    await context.seams.keys.exportKey({
      options: { onEvent: context.onExportKeyEvent },
      kind: 'ecdsa',
      walletSession: context.walletId,
      chainTarget: target,
    });
  } catch (error) {
    context.onExportKeyError?.(error instanceof Error ? error : new Error(String(error)));
    fail(context, error);
  } finally {
    context.busy.current = false;
  }
}
function renderAddition(context: Context, selection: AddableSigner): React.ReactNode {
  const label =
    selection.mode === 'ed25519' ? 'Ed25519 · New NEAR account' : 'ECDSA · EVM accounts';
  return (
    <section className="seams-signing-key-row" key={selection.mode}>
      <strong>{label}</strong>
      <button
        type="button"
        className="seams-account-action"
        onClick={addSigner.bind(null, context, selection)}
      >
        <WalletText copy="Add signer" />
      </button>
    </section>
  );
}
async function addSigner(context: Context, selection: AddableSigner): Promise<void> {
  if (context.busy.current) return;
  context.busy.current = true;
  context.setState({ kind: 'working', message: 'Creating your signing key…' });
  try {
    const result = await context.seams.registration.addSigner({
      walletId: toWalletId(context.walletId),
      rpId: resolveWalletRpId(context.seams.configs),
      signerSelection: selection,
    });
    if (!result.success) throw new Error(result.error);
  } catch (error) {
    fail(context, error);
    return;
  } finally {
    context.busy.current = false;
  }
  await refresh(context);
}
function assertNever(value: never): never {
  throw new Error(`Unsupported signing key state: ${String(value)}`);
}

function provisioningLabel(state: NearProvisioningState): string {
  switch (state.status) {
    case 'near_pending':
    case 'near_provisioning':
      return 'Setup in progress';
    case 'near_ready':
      return 'Key metadata is updating. Check status again.';
    case 'near_failed_retryable':
      return state.error;
    default:
      return assertNever(state);
  }
}
