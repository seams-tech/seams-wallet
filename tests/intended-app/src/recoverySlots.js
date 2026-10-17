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
function codeEntry(code, recoveryCodeError = null) {
  return {
    ...display,
    stage: 'enter_code',
    recoveryCode: code,
    recoveryCodeError,
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
  // The same format check as the session: Continue stays enabled and names what is missing.
  if (intent.kind === 'recovery_code_submit') {
    const code = model.recoveryCode;
    if (code.length === 0) show(codeEntry(code, 'Enter a recovery code.'));
    else if (code.length < 32)
      show(codeEntry(code, 'Enter all 32 characters of the recovery code.'));
    else show(methodChoice(code));
  }
  if (intent.kind === 'back' && model.stage === 'choose_method')
    show(codeEntry(model.recoveryCode));
}
const root = document.getElementById('root');
if (!root) throw new Error('Recovery input requires a root element.');
const handle = mountAuthMenuSurface({ parent: root, viewModel: model, onIntent });
