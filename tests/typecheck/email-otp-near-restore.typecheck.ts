import type { EmailOtpWorkerOperationMap } from '../../packages/wallet/src/core/signingEngine/workerManager/workerTypes';

type Restore = EmailOtpWorkerOperationMap['rehydrateActiveEmailOtpEd25519YaoSessionMaterial'];
type EcdsaRequest = Restore['payload']['ecdsa'];
type EcdsaResult = Restore['result']['ecdsa'];
declare const combined: Extract<EcdsaRequest, { kind: 'required' }>;
declare const activated: Extract<EcdsaResult, { kind: 'activated' }>;

const nearOnly: EcdsaRequest = { kind: 'absent' };
// @ts-expect-error combined restoration requires its exact binding, scope, and policy.
const missingMaterial: EcdsaRequest = { kind: 'required' };
// @ts-expect-error a NEAR-only branch rejects a combined branch's material through a spread.
const mixed: EcdsaRequest = { ...combined, kind: 'absent' };
// @ts-expect-error direct NEAR-only requests cannot carry an ECDSA policy.
const mixedLiteral: EcdsaRequest = { kind: 'absent', sessionPolicy: combined.sessionPolicy };
// @ts-expect-error NEAR-only results cannot contain an ECDSA activation.
const mixedResult: EcdsaResult = { ...activated, kind: 'absent' };
// @ts-expect-error incompatible branch assertions do not convert required material into absence.
const unsafe = combined as Extract<EcdsaRequest, { kind: 'absent' }>;

void [nearOnly, missingMaterial, mixed, mixedLiteral, mixedResult, unsafe];
