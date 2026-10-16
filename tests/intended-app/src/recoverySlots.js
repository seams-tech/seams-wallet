import { mountAuthMenuSurface } from '../../../packages/wallet/dist/esm/SeamsWeb/walletIframe/host/ui/auth-menu/mountAuthMenuSurface.js';
import { LIGHT_THEME } from '../../../packages/wallet/dist/esm/base-styles.js';
import '../../../packages/wallet/dist/esm/sdk/wallet-ui.css';

const display = {
  kind: 'recovery',
  mode: 'login',
  recoveryCodeError: null,
  appearance: {
    theme: { id: 'default', mode: 'light', colors: LIGHT_THEME },
    palette: 'default',
  },
  hostname: 'example.com',
  closeLabel: 'Back',
  heading: 'Recover wallet',
  showProgress: false,
  enabledExternalProviders: ['google'],
  status: { kind: 'idle', interaction: 'actionable' },
};
function codeEntry(code) {
  return {
    ...display,
    stage: 'enter_code',
    recoveryCode: code,
    subtitle: 'Enter a recovery code to recover your wallet.',
    ctaLabel: 'Continue',
  };
}
function methodChoice(code) {
  return {
    ...display,
    stage: 'choose_method',
    recoveryCode: code,
    subtitle: 'Choose how you will sign in to this wallet from now on.',
    ctaLabel: 'Create a passkey',
  };
}
let model = codeEntry('');
function show(next) {
  model = next;
  handle.update(model);
}
function onIntent(intent) {
  if (intent.kind === 'recovery_code_changed') show(codeEntry(intent.recoveryCode));
  if (intent.kind === 'recovery_code_submit') show(methodChoice(model.recoveryCode));
  if (intent.kind === 'back' && model.stage === 'choose_method')
    show(codeEntry(model.recoveryCode));
}
const root = document.getElementById('root');
if (!root) throw new Error('Recovery input requires a root element.');
const handle = mountAuthMenuSurface({ parent: root, viewModel: model, onIntent });
