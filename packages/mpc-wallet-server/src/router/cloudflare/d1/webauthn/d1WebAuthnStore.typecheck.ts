import type { WebAuthnLoginChallengeRecord } from '../../../../core/WebAuthnLoginChallengeStore';
import type { CloudflareD1WebAuthnStore } from './d1WebAuthnStore';

type ChallengeWrite = Parameters<CloudflareD1WebAuthnStore['writeChallenge']>[0];
declare const login: Extract<ChallengeWrite, { readonly challengeKind: 'login' }>;
declare const sync: Extract<ChallengeWrite, { readonly challengeKind: 'sync' }>;

// @ts-expect-error A shared sync record cannot be written as a wallet login challenge.
const wrongRecord: ChallengeWrite = { ...login, record: sync.record };
// @ts-expect-error A broad spread cannot relabel a login record as a recovery challenge.
const wrongKind: ChallengeWrite = { ...login, challengeKind: 'recovery_registration' };
// @ts-expect-error Login ownership must be validated at the boundary.
const rawOwner: WebAuthnLoginChallengeRecord = { ...login.record, userId: 'unparsed-wallet' };
void wrongRecord;
void wrongKind;
void rawOwner;
