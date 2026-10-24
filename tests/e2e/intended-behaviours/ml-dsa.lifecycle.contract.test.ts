import { intendedTest as test } from './harness';
import { runMlDsaBrowserLifecycle, runMlDsaDeviceOwnerParity } from './ml-dsa-lifecycle-scenario';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test(
  'ML-DSA survives full browser recovery and QR linking under separate owners',
  runMlDsaBrowserLifecycle,
);

test(
  'ML-DSA device owner export parity survives onward linking and recovery',
  runMlDsaDeviceOwnerParity,
);
