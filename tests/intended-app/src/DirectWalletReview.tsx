import React, { useLayoutEffect } from 'react';
import type { TransactionReviewControls } from '@seams/wallet/react';
import './DirectWalletReview.css';

// Keep the SDK's request binding and deadline while opening its wallet review directly.
export function renderDirectWalletReview(controls: TransactionReviewControls): React.ReactNode {
  return <DirectWalletReview controls={controls} />;
}

function DirectWalletReview({ controls }: { controls: TransactionReviewControls }): null {
  useLayoutEffect(controls.continueToWallet, [controls.continueToWallet]);
  return null;
}
