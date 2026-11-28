// The co-signer accepts the evidence kind of the lane's backend, and only that one: its check
// holds one kind, never a list, and the Gateway passes the kind that its backend signs.

import {
  BACKEND_EVIDENCE_KIND,
  evidenceChecker,
  type SpokenEvidenceKind,
} from '@shared/speakToSign/evidence';
import type { SpeakToSignBackendId } from '@shared/speakToSign/backend';
import type { SpeakToSignVoiceVerdictCheck } from '../../packages/mpc-wallet-server/src/router/domains/speakToSign/voiceVerdictAdmission';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const kindChecks: [
  Expect<Equal<SpeakToSignVoiceVerdictCheck['evidenceKind'], SpokenEvidenceKind>>,
  Expect<Equal<SpokenEvidenceKind, 'sayso_verdict_v1' | 'voice_verdict_v2'>>,
  Expect<Equal<SpeakToSignBackendId, 'sayso' | 'outlayer'>>,
  Expect<Equal<keyof typeof BACKEND_EVIDENCE_KIND, SpeakToSignBackendId>>,
] = [true, true, true, true];
void kindChecks;

declare const ledger: SpeakToSignVoiceVerdictCheck['ledger'];
declare const backend: SpeakToSignBackendId;

// The Gateway builds the check from its one backend.
const lane: SpeakToSignVoiceVerdictCheck = { evidenceKind: BACKEND_EVIDENCE_KIND[backend], ledger };
void lane;

const kinds = ['sayso_verdict_v1', 'voice_verdict_v2'] as const;
// @ts-expect-error A lane accepts one kind, not a list of kinds.
const both: SpeakToSignVoiceVerdictCheck = { evidenceKind: kinds, ledger };
// @ts-expect-error A backend id is not an evidence kind.
const id: SpeakToSignVoiceVerdictCheck = { evidenceKind: 'sayso', ledger };
// @ts-expect-error No backend signs this kind.
const unknown: SpeakToSignVoiceVerdictCheck = { evidenceKind: 'tee_verdict_v1', ledger };
void [both, id, unknown];

// Each kind has one checker, which names its own kind.
const checker = evidenceChecker('sayso_verdict_v1');
const sameKind: Expect<Equal<typeof checker.kind, SpokenEvidenceKind>> = true;
void sameKind;
