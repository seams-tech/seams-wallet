import { transfer } from './actionBuilders';
import { parseEther, parseNear, yoctoNear } from './amounts';

void transfer(parseNear('1'));
void transfer(yoctoNear('1000000000000000000000000'));

// @ts-expect-error A unit string is not a yoctoNEAR amount.
void transfer('1 NEAR');

// @ts-expect-error A raw string must go through near or yoctoNear first.
void transfer('1000000000000000000000000');

const wei: bigint = parseEther('0.5');
void wei;
