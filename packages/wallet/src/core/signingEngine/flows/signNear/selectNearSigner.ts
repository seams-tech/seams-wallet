import { alphabetizeStringify } from '@shared/utils/digests';
import {
  parseMlDsaSigningSessionPolicy,
  type MlDsaSigningSessionPolicy,
} from '@shared/near/mlDsaSigningSession';
import { resolveWalletRpId } from '@/SeamsWeb/walletIframe/shared/configuration';
import { requireBrowserCapabilityOperation } from '@/SeamsWeb/publicApi/capabilitySelection';
import {
  CAPABILITY_KINDS,
  NEAR_ML_DSA_65_MPC_OPERATION_KINDS,
} from '@shared/authorization/capabilityKinds';
import type { SeamsConfigsReadonly, NearTransactionSignerSelection } from '@/core/types/seams';
import type { NearTransactionSignerRequest } from '@/core/types/nearSigningKeys';
import type { WalletSessionRef, NearAccountRef } from '../../interfaces/ecdsaChainTarget';
import type { TransactionInput } from '@/core/types/actions';
import { toActionArgsWasm } from '@/core/types/actions';
import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { UiConfirmContext } from '../../uiConfirm/uiConfirm.types';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import { readDefaultNearSigner } from '../../walletCustody/nearSignerPreferences';
import { readNearSignerMetadata } from '../../walletCustody/nearSignerMetadata';
import { buildNearDisplayModel } from '../../chains/near/display';
import { mountConfirmUI, type MountedConfirmUIHandle } from '../../uiConfirm/ui/confirm-ui';
import type { SigningKeyChoice } from '../../uiConfirm/ui/confirm-ui-types';

type Choice = {
  readonly id: string;
  readonly label: string;
  readonly signer: NearTransactionSignerSelection;
};
export type NearSignerSelectionInput = {
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef;
  readonly request: NearTransactionSignerRequest;
  readonly transaction: TransactionInput;
  readonly confirmationConfig: Partial<ConfirmationConfig> | null;
  readonly shouldAbort: () => boolean;
  readonly sessionPolicy: MlDsaSigningSessionPolicy | null;
  readonly signerSlot: number | null;
};
type Dependencies = {
  readonly configs: SeamsConfigsReadonly;
  readonly nearClient: NearClient;
  readonly ui: UiConfirmContext;
};

export async function selectNearTransactionSigner(
  deps: Dependencies,
  input: NearSignerSelectionInput,
): Promise<NearSignerSelectionResult> {
  const request = input.request;
  if (request.kind !== 'wallet_default') {
    requireSignerCapability(deps.configs, request);
    return { kind: 'unreviewed', signer: request };
  }
  const preference = await readDefaultNearSigner({
    walletId: input.walletSession.walletId,
    nearAccountId: input.nearAccount.accountId,
    configs: deps.configs,
  });
  const inventory = await readNearSignerMetadata({
    walletId: input.walletSession.walletId,
    relayerUrl: deps.configs.network.relayer.url,
  });
  const choices: Choice[] = [
    { id: 'ed25519', label: 'Ed25519 · Standard signing', signer: { kind: 'ed25519' } },
  ];
  if (inventory.kind === 'inventory') {
    for (const entry of inventory.entries) {
      if (entry.kind !== 'published') continue;
      const signer: NearTransactionSignerSelection = {
        kind: 'near_ml_dsa_65',
        signingKeyId: entry.key.signingKeyId,
        publicKeyB64u: entry.key.publicKeyB64u,
        keyManifestDigestB64u: entry.key.keyManifestDigestB64u,
        materialEpoch: entry.key.materialEpoch,
      };
      const { resumeMlDsaNearEnrollment } = await import('../../walletCustody/mlDsaEnrollment');
      const enrollment = await resumeMlDsaNearEnrollment({
        nearClient: deps.nearClient,
        continuation: {
          kind: 'awaiting_chain',
          request: {
            walletSession: input.walletSession,
            nearAccount: input.nearAccount,
            publication: { walletId: input.walletSession.walletId, signer },
          },
        },
      });
      if (enrollment.kind === 'enrolled')
        choices.push({
          id: signer.signingKeyId,
          label: `ML-DSA-65 · ${signer.signingKeyId}`,
          signer,
        });
    }
  }
  const preferred = preference.kind === 'ed25519' ? 'ed25519' : preference.signingKeyId;
  let selected: Choice | null = null;
  for (const choice of choices) if (choice.id === preferred) selected = choice;
  if (!selected)
    throw new Error(
      'Your default ML-DSA signer is unavailable. Check Signing keys or choose another default.',
    );
  requireSignerCapability(deps.configs, selected.signer);
  if (input.shouldAbort()) throw new Error('Request cancelled');
  const config = {
    ...deps.ui.userPreferencesManager.getConfirmationConfig(),
    ...input.confirmationConfig,
  };
  if (choices.length === 1 || config.behavior === 'skipClick' || config.uiMode === 'none')
    return { kind: 'unreviewed', signer: selected.signer };
  const txSigningRequests = [
    {
      receiverId: input.transaction.receiverId,
      actions: input.transaction.actions.map(toActionArgsWasm),
    },
  ];
  const policy =
    input.sessionPolicy === null ? null : parseMlDsaSigningSessionPolicy(input.sessionPolicy);
  const bindings = new Map<string, string>();
  for (const choice of choices)
    bindings.set(choice.id, transactionReviewBinding(input, choice.signer));
  const handle = await mountConfirmUI({
    ctx: deps.ui,
    summary: {
      title: 'Review transaction',
      body: 'Choose a signing key and approve this transaction.',
    },
    model: buildNearDisplayModel({ txSigningRequests, signerAccount: input.nearAccount.accountId }),
    txSigningRequests,
    uiMode: config.uiMode === 'drawer' ? 'drawer' : 'modal',
    securityContext: { rpId: resolveWalletRpId(deps.configs) },
  });
  const selection = { selected, choices, handle, policy };
  const timer = setInterval(cancelSelectionIfRequested.bind(null, input, handle), 100);
  try {
    updateChoice(selection);
    const decision = await handle.takeDecision();
    if (decision.kind === 'cancelled' || input.shouldAbort()) throw new Error('Request cancelled');
    requireSignerCapability(deps.configs, selection.selected.signer);
    const binding = bindings.get(selection.selected.id);
    if (!binding) throw new Error('The selected key has no transaction review');
    return {
      kind: 'reviewed',
      signer: selection.selected.signer,
      review: new ConfirmedNearTransactionReview(binding),
    };
  } finally {
    clearInterval(timer);
    handle.close(false);
  }
}
type Selection = {
  selected: Choice;
  readonly choices: readonly Choice[];
  readonly handle: MountedConfirmUIHandle;
  readonly policy: MlDsaSigningSessionPolicy | null;
};
function displayChoice(choice: Choice): SigningKeyChoice['options'][number] {
  return { id: choice.id, label: choice.label };
}
function updateChoice(selection: Selection): void {
  selection.handle.update({
    confirmText: 'Approve transaction',
    body: reviewBody(selection),
    signingKeyChoice: {
      selected: selection.selected.id,
      options: selection.choices.map(displayChoice),
      onChange: changeChoice.bind(null, selection),
    },
  });
}
function changeChoice(selection: Selection, id: string): void {
  for (const choice of selection.choices) {
    if (choice.id === id) {
      selection.selected = choice;
      updateChoice(selection);
      return;
    }
  }
  throw new Error('Unknown signing key selection');
}
function cancelSelectionIfRequested(
  input: NearSignerSelectionInput,
  handle: MountedConfirmUIHandle,
): void {
  if (input.shouldAbort()) handle.close(false);
}

function requireSignerCapability(
  configs: SeamsConfigsReadonly,
  signer: NearTransactionSignerSelection,
): void {
  requireBrowserCapabilityOperation(configs, {
    capabilityKind:
      signer.kind === 'near_ml_dsa_65'
        ? CAPABILITY_KINDS.nearMlDsa65MpcSigning
        : CAPABILITY_KINDS.nearEd25519MpcSigning,
    operationKind: NEAR_ML_DSA_65_MPC_OPERATION_KINDS.signTransaction,
  });
}

function reviewBody(selection: Selection): string {
  if (selection.selected.signer.kind !== 'near_ml_dsa_65' || selection.policy === null)
    return 'Approve this transaction with the selected signing key. Authentication follows when required.';
  return `Approve this transaction and, if needed, a signing session for this key: up to ${selection.policy.maxOperations} operations over up to ${Math.ceil(selection.policy.durationMs / 1000)} seconds. Failed operations consume one use. Authentication follows when required.`;
}

type ReviewedTransactionInput = Pick<
  NearSignerSelectionInput,
  'walletSession' | 'nearAccount' | 'transaction' | 'sessionPolicy' | 'signerSlot'
>;
function transactionReviewBinding(
  input: ReviewedTransactionInput,
  signer: NearTransactionSignerSelection,
): string {
  return alphabetizeStringify({
    walletSession: input.walletSession,
    nearAccount: input.nearAccount,
    signer,
    signerSlot: input.signerSlot,
    sessionPolicy: input.sessionPolicy,
    receiverId: input.transaction.receiverId,
    actions: input.transaction.actions.map(toActionArgsWasm),
  });
}
/** A host-only, single-use semantic review. It grants no signing or factor authority. */
class ConfirmedNearTransactionReview {
  private state: 'available' | 'consumed' = 'available';
  constructor(private readonly binding: string) {}

  consume(
    input: ReviewedTransactionInput & {
      readonly signer: NearTransactionSignerSelection;
      readonly confirmationConfig: Partial<ConfirmationConfig> | null;
    },
  ): Partial<ConfirmationConfig> {
    if (this.state !== 'available') throw new Error('This transaction review was already consumed');
    this.state = 'consumed';
    if (transactionReviewBinding(input, input.signer) !== this.binding)
      throw new Error('The transaction or signing key changed after approval');
    // Reuse the existing confirmation path. Its OTP and platform activation rules
    // remain authoritative; only the already completed semantic review is omitted.
    return { ...input.confirmationConfig, behavior: 'skipClick', autoProceedDelay: 0 };
  }
}
export type NearSignerSelectionResult =
  | {
      readonly kind: 'unreviewed';
      readonly signer: NearTransactionSignerSelection;
      readonly review?: never;
    }
  | {
      readonly kind: 'reviewed';
      readonly signer: NearTransactionSignerSelection;
      readonly review: ConfirmedNearTransactionReview;
    };
