import {
  voiceEnrollmentStorage,
  type VoiceEnrollment,
  type VoiceEnrollmentScope,
  type VoiceTemplateAccess,
  type VoiceEnrollmentChange,
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
const storage = voiceEnrollmentStorage({ model: VOICE_MODEL_ID, parseEnrollment });
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

export async function commitVoiceEnrollment(change: VoiceEnrollmentChange): Promise<void> {
  const { scope, signal } = change;
  switch (change.kind) {
    case 'activate':
      return storage.commit({
        kind: 'activate',
        scope,
        signal,
        guard: change.guard,
        snapshot: change.snapshot,
        baseline: vector(change.baseline),
      });
    case 'import':
      return storage.commit({
        kind: 'import',
        scope,
        signal,
        guard: change.guard,
        snapshot: change.snapshot,
        confirmation: change.confirmation,
        baseline: vector(change.baseline),
      });
    case 'replace':
      return storage.commit({
        kind: 'replace',
        scope,
        signal,
        guard: change.guard,
        snapshot: change.snapshot,
        confirmation: change.confirmation,
        baseline: vector(change.baseline),
      });
    case 'improve':
      requireBoundedSamples(change.snapshot.enrollment.baseline, change.samples);
      return storage.commit({
        kind: 'improve',
        scope,
        signal,
        guard: change.guard,
        snapshot: change.snapshot,
        confirmation: change.confirmation,
        samples: change.samples,
      });
    case 'reset':
      return storage.commit({
        kind: 'reset',
        scope,
        signal,
        guard: change.guard,
        snapshot: change.snapshot,
        confirmation: change.confirmation,
      });
    default:
      return assertNever(change);
  }
}

function assertNever(_change: never): never {
  throw new Error('Unsupported VoiceID enrollment change.');
}
