import { transfer } from './actionBuilders';
import { parseEther, parseNear, yoctoNear } from './amounts';

void transfer('1 NEAR');
void transfer('0.5 NEAR');
void transfer('1000 yoctoNEAR');
void transfer(parseNear('1'));
void transfer(yoctoNear('1000000000000000000000000'));

// @ts-expect-error A string without a unit could mean NEAR or yoctoNEAR.
void transfer('1');

// @ts-expect-error The unit must be NEAR or yoctoNEAR.
void transfer('1 near');

// @ts-expect-error The amount must be a number.
void transfer('one NEAR');

const amountInput: string = '1';
// @ts-expect-error A computed string goes through parseNear or yoctoNear.
void transfer(amountInput);

const wei: bigint = parseEther('0.5');
void wei;
