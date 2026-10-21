import { transfer } from './actionBuilders';
import { ether, near, yoctoNear } from './amounts';

void transfer(near('1'));
void transfer(yoctoNear('1000000000000000000000000'));

// @ts-expect-error A unit string is not a yoctoNEAR amount.
void transfer('1 NEAR');

// @ts-expect-error A raw string must go through near or yoctoNear first.
void transfer('1000000000000000000000000');

const wei: bigint = ether('0.5');
void wei;
