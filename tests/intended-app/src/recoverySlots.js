import { mountAuthMenuSurface } from '../../../packages/wallet/dist/esm/SeamsWeb/walletIframe/host/ui/auth-menu/mountAuthMenuSurface.js';
import { LIGHT_THEME } from '../../../packages/wallet/dist/esm/base-styles.js';
import '../../../packages/wallet/dist/esm/sdk/wallet-ui.css';

const slotCount = new URLSearchParams(location.search).get('slots') === '16' ? 16 : 32;
function recoveryModel(code) {
  const model = {
    kind: 'recovery',
    mode: 'login',
    stage: 'enter_code',
    recoveryCode: code,
    recoveryCodeError: null,
    appearance: {
      theme: { id: 'default', mode: 'light', colors: LIGHT_THEME },
      palette: 'default',
    },
    hostname: 'example.com',
    closeLabel: 'Back',
    heading: 'Recover wallet',
    subtitle: 'Use your recovery code to restore access.',
    ctaLabel: 'Recover with Passkey',
    showProgress: false,
    status: { kind: 'idle', interaction: 'actionable' },
  };
  if (slotCount === 16) model.recoveryCodeSlotCount = 16;
  return model;
}
function onIntent(intent) {
  if (intent.kind === 'recovery_code_changed') handle.update(recoveryModel(intent.recoveryCode));
}
const root = document.getElementById('root');
if (!root) throw new Error('Recovery input requires a root element.');
const handle = mountAuthMenuSurface({ parent: root, viewModel: recoveryModel(''), onIntent });
