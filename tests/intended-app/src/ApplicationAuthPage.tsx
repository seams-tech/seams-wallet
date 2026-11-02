import { ActionType, type OwnerNearOperation, type WalletSession } from '@seams/wallet';
import {
  useSeams,
  type TransactionReviewControls,
  type TransactionReviewSurface,
} from '@seams/wallet/react';
import React from 'react';
import { ApplicationAuthExample } from '../../../examples/seams-auth-menu/src/ApplicationAuth';

declare global {
  interface Window {
    ownerAuthApi: ReturnType<typeof useSeams>['seams'] | undefined;
    ownerAuthPrepare: (() => Promise<void>) | undefined;
    ownerAuthPrepareReviewed: (() => void) | undefined;
    ownerAuthReviewSurfaces: string[] | undefined;
    ownerAuthOperation: OwnerNearOperation | undefined;
    ownerAuthSession: (() => Promise<WalletSession>) | undefined;
  }
}

export function ApplicationAuthPage({ walletRpId }: { walletRpId: string }): React.ReactNode {
  const { seams, wallet } = useSeams();
  React.useEffect(exposeSessionReader.bind(null, seams), [seams]);
  React.useEffect(exposeReviewedPreparation.bind(null, wallet), [wallet]);
  return <ApplicationAuthExample walletRpId={walletRpId} />;
}

function exposeSessionReader(seams: ReturnType<typeof useSeams>['seams']): () => void {
  window.ownerAuthApi = seams;
  window.ownerAuthPrepare = prepareApiOperation;
  window.ownerAuthSession = seams.auth.getSession.bind(seams.auth);
  return clearSessionReader;
}

function clearSessionReader(): void {
  window.ownerAuthSession = undefined;
  window.ownerAuthApi = undefined;
  window.ownerAuthOperation = undefined;
}

function exposeReviewedPreparation(wallet: ReturnType<typeof useSeams>['wallet']): () => void {
  if (wallet?.access === 'external' && wallet.near)
    window.ownerAuthPrepareReviewed = prepareReviewedOperation.bind(null, wallet.near);
  return clearReviewedPreparation;
}

function clearReviewedPreparation(): void {
  window.ownerAuthPrepareReviewed = undefined;
}

function prepareReviewedOperation(
  near: NonNullable<Extract<ReturnType<typeof useSeams>['wallet'], { access: 'external' }>['near']>,
): void {
  window.ownerAuthOperation = near.prepareOwnerTransaction({
    transaction: {
      receiverId: near.accountId,
      actions: [{ type: ActionType.Transfer, amount: '1' }],
    },
    review: {
      title: 'Review deposit',
      validity: { kind: 'unbounded' },
      origin: { x: 16, y: 16, width: 160, height: 48 },
      onVisible: recordReviewSurface,
      render: renderDepositReview,
    },
  });
}

function recordReviewSurface(surface: TransactionReviewSurface): void {
  window.ownerAuthReviewSurfaces = [...(window.ownerAuthReviewSurfaces ?? []), surface.stage];
}

function renderDepositReview(controls: TransactionReviewControls): React.ReactNode {
  return <DepositReview controls={controls} />;
}

function DepositReview({ controls }: { controls: TransactionReviewControls }): React.ReactNode {
  const [marks, setMarks] = React.useState(0);
  return (
    <>
      <p>Marks: {marks}</p>
      <button type="button" onClick={setMarks.bind(null, marks + 1)}>
        Add mark
      </button>
      <button type="button" onClick={controls.continueToWallet}>
        Continue to wallet
      </button>
      <button type="button" onClick={controls.cancel}>
        Cancel review
      </button>
    </>
  );
}

async function prepareApiOperation(): Promise<void> {
  const seams = window.ownerAuthApi;
  if (!seams) throw new Error('Missing application API.');
  const session = await seams.auth.getSession();
  if (
    session.authentication.kind !== 'external_authenticated' ||
    session.appIdentity.kind !== 'resolved' ||
    !session.appIdentity.nearAccountId
  ) {
    throw new Error('Missing readable NEAR wallet.');
  }
  const nearAccountId = session.appIdentity.nearAccountId;
  window.ownerAuthOperation = seams.near.prepareOwnerTransaction({
    authentication: session.authentication,
    nearAccountId,
    transaction: {
      receiverId: nearAccountId,
      actions: [{ type: ActionType.Transfer, amount: '1' }],
    },
  });
}
