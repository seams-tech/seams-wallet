import { reviseVoiceEnrollment } from '@seams/wallet/voiceid-host';
import {
  voiceEnrollmentStorage,
  type VoiceEnrollment,
  type VoiceEnrollmentScope,
  type VoiceEnrollmentSnapshot,
  type VoiceOwnerGuard,
  type VoiceTemplateAccess,
  type ConfirmedVoiceChange,
  requireRecord,
  isFiniteNumber,
} from '@seams/wallet/voiceid-host';
import {
  normalizeVoiceVector,
  voiceSimilarity,
  VOICE_MODEL_ID,
  VOICE_MATCH_THRESHOLD,
} from './model';
const SUPPLEMENT_WEIGHT = 0.2;
const MINIMUM_BASELINE_COSINE = 0.98;
const storage = voiceEnrollmentStorage(parseEnrollment);
function vector(raw: unknown): number[] {
  if (!Array.isArray(raw) || !raw.every(isFiniteNumber))
    throw new Error('VoiceID template is invalid.');
  const normalized = normalizeVoiceVector(raw);
  for (let index = 0; index < raw.length; index += 1) {
    if (Math.abs(raw[index] - normalized[index]) > 1e-6)
      throw new Error('VoiceID template is not normalized.');
  }
  return raw.slice();
}

function parseEnrollment(raw: unknown, scope: VoiceEnrollmentScope): VoiceEnrollment | null {
  if (raw === undefined) return null;
  const record = requireRecord(raw, 'VoiceID enrollment');
  const storedScope = requireRecord(record.scope, 'VoiceID enrollment scope');
  if (
    record.kind !== 'browser_voiceid_enrollment_v2' ||
    storedScope.walletId !== scope.walletId ||
    storedScope.authorityId !== scope.authorityId ||
    storedScope.walletAuthMethodId !== scope.walletAuthMethodId ||
    storedScope.deviceKeyId !== scope.deviceKeyId ||
    typeof record.generation !== 'string' ||
    !record.generation ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0
  )
    throw new Error('VoiceID enrollment identity is invalid.');
  if (record.model !== VOICE_MODEL_ID) return null;
  const baseline = vector(record.baseline);
  let adaptation: VoiceEnrollment['adaptation'] = { kind: 'baseline' };
  // Invalid supplements cannot affect matching. A corrupt baseline fails above.
  // Retired lifetime fields are dropped when stored records are normalized.
  try {
    const candidate = requireRecord(record.adaptation, 'VoiceID improvements');
    if (
      candidate.kind === 'adapted' &&
      Array.isArray(candidate.samples) &&
      candidate.samples.length === 3
    ) {
      const samples = candidate.samples.map(vector);
      requireBoundedSamples(baseline, samples);
      adaptation = {
        kind: 'adapted',
        samples,
      };
    }
  } catch {
    adaptation = { kind: 'baseline' };
  }
  return {
    kind: 'browser_voiceid_enrollment_v2',
    scope,
    model: VOICE_MODEL_ID,
    generation: record.generation,
    revision: record.revision,
    baseline,
    adaptation,
  };
}

function effectiveTemplate(
  baseline: readonly number[],
  samples: readonly (readonly number[])[],
): number[] {
  const mean = new Array<number>(192).fill(0);
  for (const sample of samples) {
    for (let index = 0; index < mean.length; index += 1)
      mean[index] += sample[index] / samples.length;
  }
  const supplement = normalizeVoiceVector(mean);
  for (let index = 0; index < mean.length; index += 1) {
    mean[index] = (1 - SUPPLEMENT_WEIGHT) * baseline[index] + SUPPLEMENT_WEIGHT * supplement[index];
  }
  return normalizeVoiceVector(mean);
}

function requireBoundedSamples(
  baseline: readonly number[],
  samples: readonly (readonly number[])[],
): void {
  if (samples.length !== 3)
    throw new Error('Record three samples before saving voice improvements.');
  for (const sample of samples) {
    if (voiceSimilarity(baseline, sample) < VOICE_MATCH_THRESHOLD)
      throw new Error(
        'This sample differs from your original voice. Try again or re-record your enrollment.',
      );
  }
  if (voiceSimilarity(baseline, effectiveTemplate(baseline, samples)) < MINIMUM_BASELINE_COSINE) {
    throw new Error(
      'These samples differ too much from your original voice. Re-record your enrollment instead.',
    );
  }
}

export function readVoiceEnrollment(scope: VoiceEnrollmentScope): Promise<VoiceEnrollment | null> {
  return storage.read(scope);
}
export async function readVoiceTemplate(
  access: VoiceTemplateAccess,
  signal: AbortSignal,
): Promise<{ template: number[]; baseline: number[]; kind: 'baseline' | 'adapted' }> {
  const enrollment = await storage.readTemplate(access, signal);
  const adaptation = enrollment.adaptation;
  const template =
    adaptation.kind === 'adapted'
      ? effectiveTemplate(enrollment.baseline, adaptation.samples)
      : [...enrollment.baseline];
  return { template, baseline: [...enrollment.baseline], kind: adaptation.kind };
}
export async function readImportableVoiceBaseline(): Promise<readonly number[] | null> {
  const raw = await storage.readImportable();
  if (raw === undefined) return null;
  const record = requireRecord(raw, 'Previous VoiceID enrollment');
  if (record.kind !== 'browser_voiceid_enrollment_v1' || record.model !== VOICE_MODEL_ID)
    return null;
  return vector(record.template);
}

export type VoiceEnrollmentChange =
  | {
      readonly kind: 'activate';
      readonly baseline: readonly number[];
      readonly samples?: never;
      readonly confirmation?: never;
    }
  | {
      readonly kind: 'replace' | 'import';
      readonly baseline: readonly number[];
      readonly samples?: never;
      readonly confirmation: ConfirmedVoiceChange;
    }
  | {
      readonly kind: 'improve';
      readonly samples: readonly (readonly number[])[];
      readonly baseline?: never;
      readonly confirmation: ConfirmedVoiceChange;
    }
  | {
      readonly kind: 'reset';
      readonly samples?: never;
      readonly baseline?: never;
      readonly confirmation: ConfirmedVoiceChange;
    };

export async function commitVoiceEnrollment(
  scope: VoiceEnrollmentScope,
  guard: VoiceOwnerGuard,
  snapshot: VoiceEnrollmentSnapshot,
  change: VoiceEnrollmentChange,
  signal: AbortSignal,
): Promise<void> {
  let next: VoiceEnrollment;
  if (change.kind === 'activate') {
    if (guard.target !== 'activating' || snapshot.kind !== 'missing')
      throw new Error('VoiceID activation cannot replace an enrollment.');
  } else {
    if (guard.target !== 'enrolled')
      throw new Error('VoiceID changes require a confirmation guard.');
  }
  if (change.kind === 'import' && (guard.target !== 'enrolled' || snapshot.kind !== 'missing')) {
    throw new Error('Import requires an existing method without a scoped enrollment.');
  }
  if (change.kind === 'replace' || change.kind === 'activate' || change.kind === 'import') {
    next = {
      kind: 'browser_voiceid_enrollment_v2',
      scope,
      model: VOICE_MODEL_ID,
      generation: crypto.randomUUID(),
      revision: 0,
      baseline: vector(change.baseline),
      adaptation: { kind: 'baseline' },
    };
  } else {
    if (snapshot.kind !== 'present') throw new Error('Record or import your original voice first.');
    if (change.kind === 'improve') {
      requireBoundedSamples(snapshot.enrollment.baseline, change.samples);
      next = reviseVoiceEnrollment(snapshot.enrollment, {
        kind: 'adapted',
        samples: change.samples,
      });
    } else {
      next = reviseVoiceEnrollment(snapshot.enrollment, { kind: 'baseline' });
    }
  }
  switch (change.kind) {
    case 'activate':
      if (guard.target !== 'activating' || snapshot.kind !== 'missing')
        throw new Error('Invalid activation scope.');
      return storage.commit({ kind: 'activate', scope, guard, snapshot, next, signal });
    case 'import':
      if (guard.target !== 'enrolled' || snapshot.kind !== 'missing')
        throw new Error('Invalid import scope.');
      return storage.commit({
        kind: 'import',
        scope,
        guard,
        snapshot,
        next,
        signal,
        confirmation: change.confirmation,
      });
    case 'replace':
      if (guard.target !== 'enrolled') throw new Error('Invalid replacement scope.');
      return storage.commit({
        kind: 'replace',
        scope,
        guard,
        snapshot,
        next,
        signal,
        confirmation: change.confirmation,
      });
    case 'improve':
    case 'reset':
      if (guard.target !== 'enrolled' || snapshot.kind !== 'present')
        throw new Error('Invalid improvement scope.');
      return storage.commit({
        kind: change.kind,
        scope,
        guard,
        snapshot,
        next,
        signal,
        confirmation: change.confirmation,
      });
  }
}