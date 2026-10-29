import { recordVoice } from '@voiceid/browser/microphone';
import { prepareVoiceModelWithProgress } from '@voiceid/browser/progress';
import { checkSpokenPhrase, type PhraseCheck, type SpokenPhrase } from '@voiceid/browser/phrase';
import { SPOKEN_PHRASES } from '@voiceid/browser/phraseVocabulary';
import { normalizeVoiceVector, voiceEmbedding, voiceSimilarity, VOICE_MODEL_ID, VOICE_MATCH_THRESHOLD } from '@voiceid/browser/model';
import { VoicePrompt } from '@voiceid/capture/prompt';
import { isPlainObject } from '@seams/wallet/voiceid-host';
import { calibrationReport, freezeCalibration, type CutoffFit, type Attempt, type Cohort, type Reading, type Source, type SpeakerScore, type PhraseObservation } from '../../../tests/scripts/voiceid-human-calibration/report';

type Participant = Readonly<{ id: string; cohort: Cohort; enrollmentSession: string }> & (
  | { kind: 'enrolling'; samples: number[][]; template?: never }
  | { kind: 'enrolled'; template: number[]; samples?: never }
);
type Assignment = Readonly<{
  participant: Participant;
  session: string;
  phrase: SpokenPhrase;
  role: 'enrollment' | 'probe';
}>;
type Observation =
  | { kind: 'captured'; embedding: number[]; phrase: PhraseObservation; voicedMs: number; modelInputMs: number }
  | { kind: 'insufficient_audio'; voicedMs: number; embedding?: never }
  | { kind: 'failed'; embedding?: never };
type Phase =
  | { kind: 'unprepared' }
  | { kind: 'preparing'; controller: AbortController }
  | { kind: 'selecting' }
  | { kind: 'ready'; assignment: Assignment }
  | { kind: 'recording'; assignment: Assignment; controller: AbortController }
  | { kind: 'labeling'; assignment: Assignment; observation: Observation }
  | { kind: 'closed' };
type Probe = Readonly<{ attempt: Attempt; embedding: number[] }>;
type Metadata = Readonly<{ source: Source; revision: string; sourceHash: string; modelHashes: Record<string, string> }>;

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof constructor)) throw new Error(`Missing calibration control: ${id}`);
  return value;
}

function identity(input: HTMLInputElement, label: string): string {
  const value = input.value.trim();
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(value)) throw new Error(`${label}: use 1–40 letters, numbers, dashes, or underscores.`);
  return value;
}

async function metadata(): Promise<Metadata> {
  const response = await fetch('/configuration.json');
  const raw: unknown = await response.json();
  if (!isPlainObject(raw) || !isPlainObject(raw.modelHashes) || typeof raw.revision !== 'string' || typeof raw.sourceHash !== 'string') {
    throw new Error('Calibration server metadata is invalid.');
  }
  if (raw.source !== 'human_microphone' && raw.source !== 'synthetic_fixture') {
    throw new Error('Calibration source is invalid.');
  }
  const modelHashes: Record<string, string> = {};
  for (const [name, hash] of Object.entries(raw.modelHashes)) {
    if (typeof hash !== 'string') throw new Error('Calibration model hash is invalid.');
    modelHashes[name] = hash;
  }
  return { source: raw.source, revision: raw.revision, sourceHash: raw.sourceHash, modelHashes };
}

class HumanCalibration {
  private readonly participants = new Map<string, Participant>();
  private readonly attempts: Attempt[] = [];
  private readonly probes: Probe[] = [];
  private readonly collectionId = crypto.randomUUID();
  private phase: Phase = { kind: 'unprepared' };
  private fit: CutoffFit = { kind: 'collecting' };
  private readonly participant = element('participant', HTMLInputElement);
  private readonly session = element('session', HTMLInputElement);
  private readonly cohort = element('cohort', HTMLSelectElement);
  private readonly consent = element('consent', HTMLInputElement);
  private readonly prepare = element('prepare', HTMLButtonElement);
  private readonly select = element('select', HTMLButtonElement);
  private readonly correct = element('correct', HTMLButtonElement);
  private readonly different = element('different', HTMLButtonElement);
  private readonly stumbled = element('stumbled', HTMLButtonElement);
  private readonly exportButton = element('export', HTMLButtonElement);
  private readonly freezeButton = element('freeze', HTMLButtonElement);
  private readonly status = element('status', HTMLParagraphElement);
  private readonly results = element('results', HTMLDivElement);
  private readonly prompt = new VoicePrompt(document, 'Local VoiceID calibration', SPOKEN_PHRASES[0]);

  constructor(private readonly metadata: Metadata) {
    const revision = metadata.revision.slice(0, 9);
    document.title = `VoiceID calibration · ${revision}`;
    element('build', HTMLParagraphElement).textContent = `Build ${revision} · ${SPOKEN_PHRASES.length} phrases · cutoff ${VOICE_MATCH_THRESHOLD}`;
    element('capture', HTMLDivElement).append(this.prompt.element);
    this.prompt.record.disabled = true;
    this.prompt.record.textContent = 'Record';
    this.prompt.phrase.textContent = 'Prepare VoiceID to begin.';
    this.prepare.addEventListener('click', this.prepareModels);
    this.select.addEventListener('click', this.selectParticipant);
    this.prompt.record.addEventListener('click', this.record);
    this.prompt.cancel.addEventListener('click', this.cancel);
    this.correct.addEventListener('click', this.label.bind(this, 'as_shown'));
    this.different.addEventListener('click', this.label.bind(this, 'different_words'));
    this.stumbled.addEventListener('click', this.label.bind(this, 'stumbled'));
    this.exportButton.addEventListener('click', this.export);
    this.freezeButton.addEventListener('click', this.freeze);
    this.consent.addEventListener('change', this.consentChanged);
    window.addEventListener('pagehide', this.wipe);
    this.render();
  }

  private readonly prepareModels = (): void => {
    void this.load();
  };

  private async load(): Promise<void> {
    if (this.phase.kind !== 'unprepared' || !this.consent.checked) {
      this.status.textContent = 'Confirm local participation before preparing VoiceID.';
      return;
    }
    const controller = new AbortController();
    const preparing: Phase = { kind: 'preparing', controller };
    this.phase = preparing;
    this.prompt.progress.replaceChildren();
    this.render();
    this.prepare.disabled = true;
    try {
      await prepareVoiceModelWithProgress(this.prompt.progress, controller.signal);
      if (this.phase !== preparing) return;
      this.prompt.progress.replaceChildren();
      this.phase = { kind: 'selecting' };
      this.status.textContent = 'Select a participant and session. Enrollment needs three usable recordings.';
      this.select.disabled = false;
      this.prepare.hidden = true;
      this.render();
    } catch (error) {
      if (this.phase !== preparing) return;
      this.phase = { kind: 'unprepared' };
      this.prepare.disabled = false;
      this.status.textContent = message(error);
      this.render();
    }
  }

  private readonly selectParticipant = (): void => {
    if (this.phase.kind !== 'selecting' && this.phase.kind !== 'ready') return;
    try {
      const id = identity(this.participant, 'Participant code');
      const session = identity(this.session, 'Session label');
      const cohort = this.cohort.value;
      if (cohort !== 'calibration' && cohort !== 'evaluation') throw new Error('Choose a cohort.');
      if (cohort === 'evaluation' && this.fit.kind !== 'frozen') {
        throw new Error('Freeze calibration before adding evaluation speakers.');
      }
      if (cohort === 'calibration' && this.fit.kind === 'frozen') {
        throw new Error('Calibration is frozen. Start a new collection to change it.');
      }
      let participant = this.participants.get(id);
      if (!participant) {
        participant = { kind: 'enrolling', id, cohort, enrollmentSession: session, samples: [] };
        this.participants.set(id, participant);
      }
      if (participant.cohort !== cohort) throw new Error('A participant must stay in one cohort.');
      if (participant.kind === 'enrolled' && participant.enrollmentSession === session) {
        throw new Error('Use a new session label for probe recordings. Keep the page open between sessions.');
      }
      if (participant.kind === 'enrolling' && participant.enrollmentSession !== session) {
        throw new Error('Finish all three enrollment recordings in the same session.');
      }
      this.assign(participant, session);
    } catch (error) {
      this.status.textContent = message(error);
    }
  };

  private assign(participant: Participant, session: string): void {
    const role = participant.kind === 'enrolling' ? 'enrollment' : 'probe';
    const phrase = this.nextPhrase(participant.id, role);
    this.phase = { kind: 'ready', assignment: { participant, session, phrase, role } };
    this.prompt.setPhrase(phrase);
    this.prompt.title.textContent = participant.kind === 'enrolling'
      ? `Enrollment · ${participant.samples.length} of 3`
      : 'Read aloud';
    this.prompt.ready('Read naturally, then pause. Label the reading afterward.');
    this.status.textContent = `${participant.id} · ${participant.cohort} · ${session} · ${role}`;
    this.render();
  }

  private nextPhrase(participant: string, role: Assignment['role']): SpokenPhrase {
    let minimum = Infinity;
    let candidates: SpokenPhrase[] = [];
    for (const phrase of SPOKEN_PHRASES) {
      let count = 0;
      for (const attempt of this.attempts) {
        if (attempt.participant === participant && attempt.role === role && attempt.phrase === phrase) count += 1;
      }
      if (count < minimum) {
        minimum = count;
        candidates = [];
      }
      if (count === minimum) candidates.push(phrase);
    }
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    return candidates[random % candidates.length];
  }

  private readonly record = (): void => {
    if (this.phase.kind !== 'ready') return;
    if (!this.consent.checked) {
      this.status.textContent = 'Confirm participation before recording.';
      return;
    }
    void this.capture(this.phase.assignment);
  };

  private async capture(assignment: Assignment): Promise<void> {
    const controller = new AbortController();
    const recording: Phase = { kind: 'recording', assignment, controller };
    this.phase = recording;
    this.render();
    this.prompt.record.disabled = true;
    this.select.disabled = true;
    let observation: Observation;
    try {
      const clip = await recordVoice(controller.signal, this.prompt.capture);
      if (clip.kind === 'insufficient_audio') {
        observation = { kind: 'insufficient_audio', voicedMs: clip.quality.voicedMs };
      } else {
        try {
          const phrase = await checkSpokenPhrase(clip.samples, assignment.phrase);
          const embedding = await voiceEmbedding(clip.samples);
          observation = { kind: 'captured', embedding, phrase: phraseObservation(phrase), voicedMs: clip.quality.voicedMs, modelInputMs: clip.samples.length / 16 };
        } finally {
          clip.samples.fill(0);
        }
      }
    } catch (error) {
      observation = { kind: 'failed' };
      this.prompt.status.textContent = message(error);
    }
    if (this.phase !== recording) {
      if (observation.kind === 'captured') observation.embedding.fill(0);
      return;
    }
    if (controller.signal.aborted) {
      if (observation.kind === 'captured') observation.embedding.fill(0);
      this.assign(assignment.participant, assignment.session);
      this.status.textContent = 'Capture cancelled. No labeled attempt was saved.';
      return;
    }
    this.phase = { kind: 'labeling', assignment, observation };
    this.prompt.record.hidden = true;
    this.status.textContent = 'Did you read the displayed words correctly? Label every attempt, including failures.';
    this.render();
  }

  private label(reading: Reading): void {
    if (this.phase.kind !== 'labeling') return;
    const { assignment, observation } = this.phase;
    const attempt: Attempt = {
      id: crypto.randomUUID(), participant: assignment.participant.id,
      cohort: assignment.participant.cohort, session: assignment.session,
      phrase: assignment.phrase, role: assignment.role, reading,
      result: publicObservation(observation),
    };
    this.attempts.push(attempt);
    let participant = assignment.participant;
    if (observation.kind === 'captured') {
      if (participant.kind === 'enrolling' && reading === 'as_shown') {
        participant.samples.push(observation.embedding);
        if (participant.samples.length === 3) {
          const template = enrollmentTemplate(participant.samples);
          for (const sample of participant.samples) sample.fill(0);
          participant = { kind: 'enrolled', id: participant.id, cohort: participant.cohort, enrollmentSession: participant.enrollmentSession, template };
          this.participants.set(participant.id, participant);
        }
      } else if (participant.kind === 'enrolled' && reading !== 'different_words') {
        this.probes.push({ attempt, embedding: observation.embedding });
      } else observation.embedding.fill(0);
    }
    this.select.disabled = false;
    if (participant.kind === 'enrolled' && participant.enrollmentSession === assignment.session) {
      this.phase = { kind: 'selecting' };
      this.prompt.title.textContent = 'Enrollment complete · 3 of 3';
      this.prompt.ready('Use a new session label for fresh comparison recordings.');
      this.prompt.record.hidden = true;
      this.prompt.record.disabled = true;
      this.status.textContent = 'Enrollment complete. Take a break, then use a new session label for probes. Keep this page open.';
      this.render();
    } else this.assign(participant, assignment.session);
  }

  private scores(): SpeakerScore[] {
    const scores: SpeakerScore[] = [];
    for (const probe of this.probes) {
      for (const participant of this.participants.values()) {
        if (participant.kind !== 'enrolled' || participant.cohort !== probe.attempt.cohort) continue;
        scores.push({ attempt: probe.attempt.id, probeParticipant: probe.attempt.participant, enrolledParticipant: participant.id, cohort: participant.cohort, session: probe.attempt.session, genuine: participant.id === probe.attempt.participant, score: voiceSimilarity(probe.embedding, participant.template) });
      }
    }
    return scores;
  }

  private report() {
    const scores = this.scores();
    return {
      schema: 'voiceid-human-calibration-v2', collectionId: this.collectionId,
      source: this.metadata.source, revision: this.metadata.revision,
      sourceHash: this.metadata.sourceHash,
      model: VOICE_MODEL_ID, modelHashes: this.metadata.modelHashes,
      browser: navigator.userAgent, currentThreshold: VOICE_MATCH_THRESHOLD,
      attempts: this.attempts, scores,
      fit: this.fit,
      summary: calibrationReport({ source: this.metadata.source, currentThreshold: VOICE_MATCH_THRESHOLD, phrases: SPOKEN_PHRASES, attempts: this.attempts, scores, fit: this.fit }),
    };
  }

  private render(): void {
    const labeling = this.phase.kind === 'labeling';
    const busy = labeling || this.phase.kind === 'recording' || this.phase.kind === 'preparing' || this.phase.kind === 'closed';
    this.participant.disabled = busy;
    this.session.disabled = busy;
    this.cohort.disabled = busy;
    this.select.disabled = busy || this.phase.kind === 'unprepared';
    this.correct.hidden = !labeling;
    this.different.hidden = !labeling;
    this.stumbled.hidden = !labeling;
    this.exportButton.disabled = this.attempts.length === 0 || busy;
    this.freezeButton.disabled = busy || this.phase.kind === 'unprepared' || this.fit.kind === 'frozen';
    const report = this.report();
    const summary = document.createElement('p');
    const fitted = this.fit.kind === 'frozen' ? ` Frozen candidate: ${this.fit.threshold.toFixed(4)}.` : '';
    summary.textContent = `${this.attempts.length} labeled attempts · ${this.probes.length} probes · speaker cutoff: ${report.summary.speakerCutoff.kind}.${fitted} Current cutoff remains ${VOICE_MATCH_THRESHOLD}. All rates are provisional.`;
    const baseline = report.summary.speakerCutoff.baseline;
    const speakerCounts = document.createElement('p');
    speakerCounts.textContent = `At ${VOICE_MATCH_THRESHOLD}: calibration rejected ${baseline.calibration.genuineRejected}/${baseline.calibration.genuine} genuine probes and accepted ${baseline.calibration.otherSpeakerAccepted}/${baseline.calibration.otherSpeaker} different-speaker probes. Held-out evaluation: ${baseline.evaluation.genuineRejected}/${baseline.evaluation.genuine} genuine rejected; ${baseline.evaluation.otherSpeakerAccepted}/${baseline.evaluation.otherSpeaker} different-speaker accepted.`;
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    for (const label of ['Phrase', 'Phrase matched', 'Both checks passed', 'Pass rate', 'Stumbles', 'People', 'Sessions', 'Different words accepted']) {
      const cell = document.createElement('th');
      cell.textContent = label;
      header.append(cell);
    }
    for (const phrase of report.summary.phrases) {
      const row = table.insertRow();
      for (const value of [phrase.phrase, `${phrase.phraseMatched} / ${phrase.promptedAttempts}`, `${phrase.voiceApproved} / ${phrase.promptedAttempts}`, phrase.approvalRate === null ? 'Unrated' : `${Math.round(phrase.approvalRate * 100)}%`, phrase.stumbles, phrase.participants, phrase.sessions, `${phrase.differentWordsAccepted} / ${phrase.differentWords}`]) {
        row.insertCell().textContent = String(value);
      }
    }
    this.results.replaceChildren(summary, speakerCounts, table);
    document.body.dataset.phase = this.phase.kind;
    document.body.dataset.attempts = String(this.attempts.length);
  }

  private readonly export = (): void => {
    if (this.attempts.length === 0 || (this.phase.kind !== 'ready' && this.phase.kind !== 'selecting')) return;
    const report = this.report();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `voiceid-scores-${this.collectionId}.json`;
    anchor.click();
    setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
  };

  private readonly freeze = (): void => {
    if (this.fit.kind === 'frozen' || (this.phase.kind !== 'ready' && this.phase.kind !== 'selecting')) return;
    const result = freezeCalibration(this.scores(), VOICE_MATCH_THRESHOLD);
    if (!result.ok) {
      this.status.textContent = 'Collect calibration probes from at least two enrolled people before freezing.';
      return;
    }
    this.fit = result.fit;
    this.phase = { kind: 'selecting' };
    this.prompt.record.disabled = true;
    this.cohort.value = 'evaluation';
    this.status.textContent = 'Calibration is frozen. Add different people to the evaluation cohort.';
    this.render();
  };

  private readonly cancel = (): void => {
    if (this.phase.kind === 'recording' || this.phase.kind === 'preparing') this.phase.controller.abort();
  };

  private readonly consentChanged = (): void => {
    if (!this.consent.checked) this.cancel();
  };

  private readonly wipe = (): void => {
    this.cancel();
    for (const participant of this.participants.values()) {
      if (participant.kind === 'enrolled') participant.template.fill(0);
      else for (const sample of participant.samples) sample.fill(0);
    }
    for (const probe of this.probes) probe.embedding.fill(0);
    if (this.phase.kind === 'labeling' && this.phase.observation.kind === 'captured') this.phase.observation.embedding.fill(0);
    this.phase = { kind: 'closed' };
    this.prompt.record.disabled = true;
    this.status.textContent = 'This recording session was cleared. Reload to start a new session.';
    this.render();
  };
}

function publicObservation(observation: Observation): Attempt['result'] {
  switch (observation.kind) {
    case 'captured': return { kind: 'captured', phrase: observation.phrase, voicedMs: observation.voicedMs, modelInputMs: observation.modelInputMs };
    case 'insufficient_audio': return { kind: 'insufficient_audio', voicedMs: observation.voicedMs };
    case 'failed': return { kind: 'failed' };
    default: return assertNever(observation);
  }
}

function assertNever(value: never): never { throw new Error(`Unexpected calibration state: ${String(value)}`); }

function phraseObservation(check: PhraseCheck): PhraseObservation {
  const recognition = check.recognition;
  switch (recognition.kind) {
    case 'recognized':
      if (check.kind === 'matched') {
        return {
          kind: 'matched',
          candidate: recognition.phrase,
          difference: recognition.difference,
          margin: recognition.margin,
        };
      }
      return {
        kind: 'rejected',
        candidate: recognition.phrase,
        difference: recognition.difference,
        margin: recognition.margin,
        reason: 'different_phrase',
      };
    case 'uncertain':
      return {
        kind: 'rejected',
        candidate: recognition.candidate,
        difference: recognition.difference,
        margin: recognition.margin,
        reason: recognition.reason,
      };
    case 'empty':
      return { kind: 'empty' };
    default:
      return assertNever(recognition);
  }
}

function enrollmentTemplate(samples: readonly (readonly number[])[]): number[] {
  const mean = new Array<number>(192).fill(0);
  for (const sample of samples) for (let index = 0; index < mean.length; index += 1) mean[index] += sample[index] / 3;
  return normalizeVoiceVector(mean);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function start(): Promise<void> {
  try {
    new HumanCalibration(await metadata());
  } catch (error) {
    element('status', HTMLParagraphElement).textContent = `${message(error)} Reload this page to retry.`;
  }
}
void start();
