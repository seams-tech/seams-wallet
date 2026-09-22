import '@seams/wallet/react/styles';
import '@wallet-preview/sdk/wallet-ui.css';
import './confirmation-preview.css';
import { mountConfirmUI } from '@wallet-preview/core/signingEngine/uiConfirm/ui/confirm-ui';
import { walletIframeRequestIdFromBoundary } from '@wallet-preview/core/types/walletIframeIdentity';
import type { WalletIframeSurfaceMeasurement } from '@wallet-preview/SeamsWeb/walletIframe/shared/messages';

function postMeasurement(measurement: WalletIframeSurfaceMeasurement): void {
  window.parent.postMessage({ type: 'preview-measurement', measurement }, window.location.origin);
}

function returnToReview(): void {
  window.parent.postMessage({ type: 'preview-back' }, window.location.origin);
}

async function showConfirmation(): Promise<void> {
  if (window.parent === window) return;
  const handle = await mountConfirmUI({
    ctx: {
      surfaceMeasurementBinding: {
        kind: 'wallet_iframe',
        requestId: walletIframeRequestIdFromBoundary('prediction-preview'),
        postMeasurement,
      },
    },
    summary: {
      title: 'Preview transaction',
      body: 'UI preview only. Approving closes this demo; nothing is signed or sent.',
    },
    model: {
      chain: 'near',
      operations: [
        {
          id: 'preview-transfer',
          kind: 'generic.contractCall',
          label: 'Demo self-transfer',
          fields: [
            { label: 'Receiver', value: 'prediction-preview.testnet' },
            { label: 'Amount', value: '0 NEAR' },
            { label: 'Network', value: 'NEAR testnet' },
          ],
        },
      ],
    },
    securityContext: { rpId: window.location.hostname },
    loading: false,
    theme: 'light',
    uiMode: 'modal',
  });
  handle.element.setAttribute('data-seams-review-frame', '');
  handle.update({ onBack: returnToReview });
  const decision = await handle.takeDecision();
  handle.close(decision.kind === 'confirmed');
  window.parent.postMessage(
    { type: 'preview-finished', confirmed: decision.kind === 'confirmed' },
    window.location.origin,
  );
}

function reportFailure(error: unknown): void {
  window.parent.postMessage(
    {
      type: 'preview-error',
      message: error instanceof Error ? error.message : 'Unable to open the confirmation preview.',
    },
    window.location.origin,
  );
}

void showConfirmation().catch(reportFailure);
