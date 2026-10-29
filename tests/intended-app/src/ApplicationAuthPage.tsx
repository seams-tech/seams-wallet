import { ActionType, type OwnerNearOperation, type WalletSession } from '@seams/wallet';
import { useSeams } from '@seams/wallet/react';
import React from 'react';
import { ApplicationAuthExample } from '../../../examples/seams-auth-menu/src/ApplicationAuth';

declare global {
  interface Window {
    ownerAuthApi: ReturnType<typeof useSeams>['seams'] | undefined;
    ownerAuthPrepare: (() => Promise<void>) | undefined;
    ownerAuthOperation: OwnerNearOperation | undefined;
    ownerAuthSession: (() => Promise<WalletSession>) | undefined;
  }
}

export function ApplicationAuthPage({ walletRpId }: { walletRpId: string }): React.ReactNode {
  const { seams } = useSeams();
  React.useEffect(exposeSessionReader.bind(null, seams), [seams]);
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
