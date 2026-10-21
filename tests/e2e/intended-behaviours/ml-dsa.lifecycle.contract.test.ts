import { intendedTest as test } from './harness';
import { runMlDsaBrowserLifecycle } from './ml-dsa-lifecycle-scenario';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test(
  'ML-DSA survives full browser recovery and QR linking under separate owners',
  runMlDsaBrowserLifecycle,
);
