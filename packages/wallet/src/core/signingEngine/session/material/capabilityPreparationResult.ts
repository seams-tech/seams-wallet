import type { ExclusiveUnion } from '@shared/utils/variant';

export type CapabilityPreparationResult<Ready, Resume, Requirement, Replacement, Failure> =
  ExclusiveUnion<
    | { kind: 'ready'; value: Ready }
    | { kind: 'pending'; resume: Resume }
    | { kind: 'authorization_required'; requirement: Requirement }
    | { kind: 'superseded'; replacement: Replacement }
    | { kind: 'failed'; failure: Failure }
  >;
