import { walletAssetTest as test } from './wallet-asset-fixture';
import { runMlDsaBrowserLifecycle, runMlDsaDeviceOwnerParity } from './ml-dsa-lifecycle-scenario';
import {
  runMlDsaActiveScopeRegistration,
  runMlDsaActiveScopeWindow,
} from './ml-dsa-registration-reserve-scenario';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test(
  'ML-DSA survives full browser recovery and QR linking under separate owners',
  runMlDsaBrowserLifecycle,
);

test(
  'ML-DSA device owner export parity survives onward linking and recovery',
  runMlDsaDeviceOwnerParity,
);

test('ML-DSA Signing keys keeps one generic job ready', runMlDsaActiveScopeRegistration);

test.describe('local window trace', () => {
  test.skip(!process.env.SEAMS_INTENDED_ML_DSA_WINDOW_TRACE, 'This local trace takes two hours');
  test('ML-DSA active scope renews until its window ends', runMlDsaActiveScopeWindow);
});
