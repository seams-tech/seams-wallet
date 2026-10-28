export type Cohort = 'calibration' | 'evaluation';
export type Source = 'human_microphone' | 'synthetic_fixture';
export type Reading = 'as_shown' | 'stumbled' | 'different_words';

export type Attempt = Readonly<{
  id: string;
  participant: string;
  cohort: Cohort;
  session: string;
  phrase: string;
  role: 'enrollment' | 'probe';
  reading: Reading;
  embedding?: never;
  samples?: never;
  result: Readonly<{ embedding?: never; samples?: never; template?: never }> & (
    | { readonly kind: 'captured'; readonly phraseMatched: boolean; readonly voicedMs: number; readonly modelInputMs: number }
    | { readonly kind: 'insufficient_audio'; readonly phraseMatched?: never; readonly voicedMs: number; readonly modelInputMs?: never }
    | { readonly kind: 'failed'; readonly phraseMatched?: never; readonly voicedMs?: never; readonly modelInputMs?: never }
  );
}>;

export type SpeakerScore = Readonly<{
  attempt: string;
  probeParticipant: string;
  enrolledParticipant: string;
  cohort: Cohort;
  session: string;
  genuine: boolean;
  score: number;
  embedding?: never;
  template?: never;
}>;

type Counts = Readonly<{
  genuine: number;
  genuineRejected: number;
  otherSpeaker: number;
  otherSpeakerAccepted: number;
}>;

type FrozenCutoff = Readonly<{
  kind: 'frozen';
  threshold: number;
  attemptIds: readonly string[];
  frozenAtMs: number;
}>;

export type CutoffFit =
  | { readonly kind: 'collecting'; readonly threshold?: never; readonly attemptIds?: never; readonly frozenAtMs?: never }
  | FrozenCutoff;

type FreezeResult =
  | { readonly ok: true; readonly fit: FrozenCutoff; readonly error?: never }
  | { readonly ok: false; readonly error: 'missing_comparisons'; readonly fit?: never };

function counts(scores: readonly SpeakerScore[], threshold: number): Counts {
  let genuine = 0;
  let genuineRejected = 0;
  let otherSpeaker = 0;
  let otherSpeakerAccepted = 0;
  for (const trial of scores) {
    if (trial.genuine) {
      genuine += 1;
      if (trial.score < threshold) genuineRejected += 1;
    } else {
      otherSpeaker += 1;
      if (trial.score >= threshold) otherSpeakerAccepted += 1;
    }
  }
  return { genuine, genuineRejected, otherSpeaker, otherSpeakerAccepted };
}

function cohortScores(cohort: Cohort, trial: SpeakerScore): boolean {
  return trial.cohort === cohort;
}

function hasComparisons(scores: readonly SpeakerScore[]): boolean {
  const sample = counts(scores, 0);
  const people = new Set<string>();
  for (const score of scores) people.add(score.probeParticipant);
  return sample.genuine > 0 && sample.otherSpeaker > 0 && people.size >= 2;
}

function calibrationThreshold(scores: readonly SpeakerScore[], current: number): number {
  const baseline = counts(scores, current);
  let chosen = current;
  let rejected = baseline.genuineRejected;
  const candidates = new Set([current]);
  for (const trial of scores) {
    candidates.add(trial.score);
    if (trial.score < 1) candidates.add(Math.min(1, trial.score + 1e-8));
  }
  for (const threshold of candidates) {
    const result = counts(scores, threshold);
    if (result.otherSpeakerAccepted > baseline.otherSpeakerAccepted) continue;
    if (
      result.genuineRejected < rejected ||
      (result.genuineRejected === rejected && Math.abs(threshold - current) < Math.abs(chosen - current))
    ) {
      chosen = threshold;
      rejected = result.genuineRejected;
    }
  }
  return chosen;
}

export function freezeCalibration(scores: readonly SpeakerScore[], current: number): FreezeResult {
  const calibration = scores.filter(cohortScores.bind(null, 'calibration'));
  if (!hasComparisons(calibration)) {
    return { ok: false, error: 'missing_comparisons' };
  }
  const attemptIds = new Set<string>();
  for (const score of calibration) attemptIds.add(score.attempt);
  return {
    ok: true,
    fit: {
      kind: 'frozen',
      threshold: calibrationThreshold(calibration, current),
      attemptIds: [...attemptIds].sort(),
      frozenAtMs: Date.now(),
    },
  };
}

function cutoffReport(source: Source, scores: readonly SpeakerScore[], current: number, fit: CutoffFit) {
  const calibration = scores.filter(cohortScores.bind(null, 'calibration'));
  const evaluation = scores.filter(cohortScores.bind(null, 'evaluation'));
  const baseline = {
    threshold: current,
    calibration: counts(calibration, current),
    evaluation: counts(evaluation, current),
  };
  if (source !== 'human_microphone') return { kind: 'synthetic_only', baseline, fit } as const;
  if (fit.kind === 'collecting') return { kind: 'collecting_calibration', baseline } as const;
  if (!hasComparisons(evaluation)) {
    return { kind: 'needs_human_comparisons', baseline } as const;
  }
  const threshold = fit.threshold;
  const candidate = {
    threshold,
    calibration: counts(calibration, threshold),
    evaluation: counts(evaluation, threshold),
  };
  if (
    candidate.evaluation.otherSpeakerAccepted > baseline.evaluation.otherSpeakerAccepted ||
    candidate.evaluation.genuineRejected > baseline.evaluation.genuineRejected
  ) {
    return { kind: 'held_out_regression', baseline, candidate } as const;
  }
  return { kind: 'candidate_for_review', baseline, candidate } as const;
}

function matchingPhrase(phrase: string, attempt: Attempt): boolean {
  return attempt.role === 'probe' && attempt.phrase === phrase;
}

function asShown(attempt: Attempt): boolean {
  return attempt.reading === 'as_shown';
}

function phraseMatched(attempt: Attempt): boolean {
  return attempt.result.kind === 'captured' && attempt.result.phraseMatched;
}

function phraseResult(scores: readonly SpeakerScore[], threshold: number, attempts: readonly Attempt[], phrase: string) {
  const matching = attempts.filter(matchingPhrase.bind(null, phrase));
  const correct = matching.filter(asShown);
  const natural = matching.filter(naturalReading);
  const different = matching.filter(differentWords);
  const matched = natural.filter(phraseMatched).length;
  let approved = 0;
  for (const attempt of natural) {
    if (!phraseMatched(attempt)) continue;
    for (const score of scores) {
      if (score.attempt === attempt.id && score.genuine && score.score >= threshold) {
        approved += 1;
        break;
      }
    }
  }
  return {
    phrase,
    status: natural.length === 0 ? 'unrated' : 'provisional',
    promptedAttempts: natural.length,
    readCorrectly: correct.length,
    stumbles: natural.length - correct.length,
    correctlyReadPhraseMatched: correct.filter(phraseMatched).length,
    phraseMatched: matched,
    successRate: natural.length === 0 ? null : matched / natural.length,
    voiceApproved: approved,
    approvalRate: natural.length === 0 ? null : approved / natural.length,
    participants: new Set(natural.map(participantId)).size,
    sessions: new Set(natural.map(participantSession)).size,
    differentWords: different.length,
    differentWordsAccepted: different.filter(phraseMatched).length,
  };
}

function differentWords(attempt: Attempt): boolean {
  return attempt.reading === 'different_words';
}

function naturalReading(attempt: Attempt): boolean {
  return attempt.reading !== 'different_words';
}

function participantId(attempt: Attempt): string {
  return attempt.participant;
}

function participantSession(attempt: Attempt): string {
  return `${attempt.participant}:${attempt.session}`;
}

function hardestFirst(left: ReturnType<typeof phraseResult>, right: ReturnType<typeof phraseResult>): number {
  return (left.approvalRate ?? 2) - (right.approvalRate ?? 2) || right.promptedAttempts - left.promptedAttempts;
}

export function calibrationReport(input: {
  readonly source: Source;
  readonly currentThreshold: number;
  readonly phrases: readonly string[];
  readonly attempts: readonly Attempt[];
  readonly scores: readonly SpeakerScore[];
  readonly fit: CutoffFit;
}) {
  return {
    phrases: input.phrases.map(phraseResult.bind(null, input.scores, input.currentThreshold, input.attempts)).sort(hardestFirst),
    speakerCutoff: cutoffReport(input.source, input.scores, input.currentThreshold, input.fit),
    policy: 'Fit on calibration speakers only. Preserve the current cutoff\'s observed different-speaker acceptance count. Freeze the candidate before held-out evaluation. Never apply automatically.',
    limitations: [
      'Speaker and session labels are supplied by participants, not independently verified.',
      'Cross-speaker scores share recordings and templates. Trial counts are correlated.',
      'No observed false accepts does not establish a population false-accept rate.',
      'No replay, imitation, or generated-voice attack qualification is performed.',
      'Phrase rates include quality failures and use participant-reported reading labels.',
    ],
  };
}
