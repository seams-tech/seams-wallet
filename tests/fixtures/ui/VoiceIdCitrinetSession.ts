import { recordVoice, voiceQualityMessage } from '@voiceid/browser/microphone';
import { voiceActivityModel } from '@voiceid/browser/voiceActivity';
import { VoicePrompt } from '@voiceid/capture/prompt';
import type { SpokenPhrase } from '@voiceid/browser/phrase';
import { isPlainObject } from '@seams/wallet/voiceid-host';
import {
  compareRecording,
  prepareComparison,
  type Comparison,
  type ModelResult,
} from '../../../tests/scripts/voiceid-citrinet/recognition';

type Assignment =
  | { kind: 'correct'; expected: SpokenPhrase; say?: never }
  | { kind: 'control'; expected: SpokenPhrase; say: string };
type Observation =
  | { kind: 'compared'; comparison: Comparison }
  | { kind: 'insufficient_audio'; comparison?: never }
  | { kind: 'failed'; comparison?: never };
type Phase =
  | { kind: 'unprepared' }
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'recording'; controller: AbortController }
  | { kind: 'labeling'; observation: Observation }
  | { kind: 'complete' }
  | { kind: 'closed' };
type Reading = 'as_shown' | 'stumbled';
type Attempt = Readonly<{ assignment: Assignment; reading: Reading; observation: Observation }>;
type Configuration = Readonly<{
  source: 'human_microphone' | 'synthetic_fixture';
  revision: string;
  sourceHash: string;
  hashes: Record<string, string>;
}>;

const assignments: readonly Assignment[] = [
  { kind: 'correct', expected: 'please sign this trade now' },
  { kind: 'correct', expected: 'if you panic panic early' },
  { kind: 'correct', expected: 'check my order today' },
  { kind: 'correct', expected: 'please confirm my purchase' },
  { kind: 'correct', expected: 'no crying in the casino' },
  { kind: 'control', expected: 'please review my order', say: 'Please never review my order.' },
  {
    kind: 'control',
    expected: 'approve this transfer at once',
    say: 'No approve this transfer at once.',
  },
  {
    kind: 'control',
    expected: 'i check the latest quote',
    say: 'Cancel my wallet and tell me the time.',
  },
];

function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T {
  const found = document.getElementById(id);
  if (!(found instanceof constructor)) throw new Error(`Missing comparison control: ${id}`);
  return found;
}

class ComparisonSession {
  private phase: Phase = { kind: 'unprepared' };
  private readonly attempts: Attempt[] = [];
  private readonly collectionId = crypto.randomUUID();
  private readonly consent = element('consent', HTMLInputElement);
  private readonly prepare = element('prepare', HTMLButtonElement);
  private readonly status = element('status', HTMLParagraphElement);
  private readonly summary = element('summary', HTMLParagraphElement);
  private readonly correct = element('correct', HTMLButtonElement);
  private readonly stumbled = element('stumbled', HTMLButtonElement);
  private readonly exportButton = element('export', HTMLButtonElement);
  private readonly prompt = new VoicePrompt(
    document,
    'Aurora and Citrinet comparison',
    assignments[0].expected,
  );

  constructor(private readonly configuration: Configuration) {
    element('capture', HTMLDivElement).append(this.prompt.element);
    this.prompt.record.disabled = true;
    this.prepare.addEventListener('click', this.startPreparation);
    this.prompt.record.addEventListener('click', this.startCapture);
    this.prompt.cancel.addEventListener('click', this.cancel);
    this.correct.addEventListener('click', this.label.bind(this, 'as_shown'));
    this.stumbled.addEventListener('click', this.label.bind(this, 'stumbled'));
    this.exportButton.addEventListener('click', this.export);
    window.addEventListener('pagehide', this.close);
    this.render();
  }

  private readonly startPreparation = (): void => {
    void this.load();
  };
  private async load(): Promise<void> {
    if (this.phase.kind !== 'unprepared' || !this.consent.checked) {
      this.status.textContent = 'Confirm participation before preparing the speech models.';
      return;
    }
    const preparing: Phase = { kind: 'preparing' };
    this.phase = preparing;
    this.render();
    this.status.textContent = 'Downloading and preparing Aurora, Citrinet, and speech detection…';
    try {
      await prepareComparison();
      await voiceActivityModel.prepare();
      if (this.phase !== preparing) return;
      this.phase = { kind: 'ready' };
      this.assign();
    } catch (error) {
      if (this.phase !== preparing) return;
      this.phase = { kind: 'unprepared' };
      this.status.textContent = message(error);
      this.render();
    }
  }

  private assignment(): Assignment {
    const assignment = assignments[this.attempts.length];
    if (!assignment) throw new Error('This comparison batch is complete');
    return assignment;
  }

  private assign(): void {
    const assignment = this.assignment();
    this.prompt.setPhrase(assignment.expected);
    this.prompt.title.textContent =
      assignment.kind === 'correct' ? 'Read aloud' : 'Wrong-phrase control · Read these words';
    if (assignment.kind === 'control') this.prompt.phrase.textContent = assignment.say;
    this.prompt.ready('Read naturally, then pause.');
    this.status.textContent = `Recording ${this.attempts.length + 1} of ${assignments.length}. Each recording goes through both models.`;
    this.render();
  }

  private readonly startCapture = (): void => {
    if (this.phase.kind !== 'ready' || !this.consent.checked) return;
    void this.capture(this.assignment());
  };

  private async capture(assignment: Assignment): Promise<void> {
    const controller = new AbortController();
    const recording: Phase = { kind: 'recording', controller };
    this.phase = recording;
    this.render();
    let observation: Observation;
    try {
      const clip = await recordVoice(controller.signal, this.prompt.capture);
      if (clip.kind === 'insufficient_audio') {
        observation = { kind: 'insufficient_audio' };
        this.prompt.status.textContent = voiceQualityMessage(clip.quality);
      } else {
        try {
          const first = this.attempts.length % 2 === 0 ? 'aurora' : 'citrinet';
          const comparison = await compareRecording(clip.samples, assignment.expected, first);
          observation = { kind: 'compared', comparison };
          this.prompt.status.textContent = 'Comparison complete. Label your reading.';
        } finally {
          clip.samples.fill(0);
        }
      }
    } catch (error) {
      observation = { kind: 'failed' };
      this.prompt.status.textContent = message(error);
    }
    if (this.phase !== recording) return;
    if (controller.signal.aborted) {
      this.phase = { kind: 'ready' };
      this.assign();
      return;
    }
    this.phase = { kind: 'labeling', observation };
    this.prompt.record.hidden = true;
    this.status.textContent = 'Did you read the displayed words correctly? Label failures too.';
    this.render();
  }

  private label(reading: Reading): void {
    if (this.phase.kind !== 'labeling') return;
    const { observation } = this.phase;
    this.attempts.push({ assignment: this.assignment(), reading, observation });
    if (this.attempts.length === assignments.length) {
      this.phase = { kind: 'complete' };
      this.prompt.title.textContent = 'Batch complete · 8 of 8';
      this.prompt.record.hidden = true;
      this.prompt.status.textContent = 'All recordings are complete.';
      this.status.textContent = 'Finished. Export your comparison scores.';
      this.render();
      return;
    }
    this.phase = { kind: 'ready' };
    this.assign();
  }

  private render(): void {
    this.prepare.disabled = this.phase.kind !== 'unprepared';
    this.prepare.hidden = this.phase.kind !== 'unprepared' && this.phase.kind !== 'preparing';
    this.prompt.record.disabled = this.phase.kind !== 'ready';
    this.correct.hidden = this.phase.kind !== 'labeling';
    this.stumbled.hidden = this.phase.kind !== 'labeling';
    this.exportButton.disabled =
      this.attempts.length === 0 ||
      this.phase.kind === 'recording' ||
      this.phase.kind === 'labeling' ||
      this.phase.kind === 'closed';
    this.consent.disabled = this.phase.kind !== 'unprepared';
    const totals = {
      trials: 0,
      aurora: 0,
      citrinet: 0,
      controls: 0,
      auroraFalseAccepts: 0,
      citrinetFalseAccepts: 0,
      naturalTrials: 0,
      auroraNatural: 0,
      citrinetNatural: 0,
    };
    for (const attempt of this.attempts) {
      if (attempt.assignment.kind === 'correct') {
        totals.naturalTrials += 1;
        if (attempt.observation.kind === 'compared') {
          if (matched(attempt.observation.comparison.aurora)) totals.auroraNatural += 1;
          if (matched(attempt.observation.comparison.citrinet)) totals.citrinetNatural += 1;
        }
        if (attempt.reading !== 'as_shown') continue;
        totals.trials += 1;
        if (attempt.observation.kind === 'compared') {
          if (matched(attempt.observation.comparison.aurora)) totals.aurora += 1;
          if (matched(attempt.observation.comparison.citrinet)) totals.citrinet += 1;
        }
      } else {
        if (attempt.reading !== 'as_shown') continue;
        totals.controls += 1;
        if (attempt.observation.kind === 'compared') {
          if (matched(attempt.observation.comparison.aurora)) totals.auroraFalseAccepts += 1;
          if (matched(attempt.observation.comparison.citrinet)) totals.citrinetFalseAccepts += 1;
        }
      }
    }
    this.summary.textContent = `Correct readings: Aurora ${totals.aurora}/${totals.trials}, Citrinet ${totals.citrinet}/${totals.trials}. Including stumbles: Aurora ${totals.auroraNatural}/${totals.naturalTrials}, Citrinet ${totals.citrinetNatural}/${totals.naturalTrials}. Wrong-phrase controls accepted: Aurora ${totals.auroraFalseAccepts}/${totals.controls}, Citrinet ${totals.citrinetFalseAccepts}/${totals.controls}.`;
    document.body.dataset.phase = this.phase.kind;
  }

  private readonly export = (): void => {
    const report = {
      schema: 'voiceid-stt-comparison-v1',
      source: this.configuration.source,
      collectionId: this.collectionId,
      browser: navigator.userAgent,
      configuration: this.configuration,
      attempts: this.attempts.map(publicAttempt),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `voiceid-stt-${this.collectionId}.json`;
    link.click();
    setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
  };
  private readonly cancel = (): void => {
    if (this.phase.kind === 'recording') this.phase.controller.abort();
  };
  private readonly close = (): void => {
    this.cancel();
    this.phase = { kind: 'closed' };
    this.attempts.length = 0;
    this.prompt.dispose();
    this.render();
  };
}

function publicScore(result: ModelResult) {
  if (result.kind === 'failed')
    return { matched: false, milliseconds: result.milliseconds, kind: 'failed' };
  const recognition = result.check.recognition;
  if (recognition.kind === 'empty')
    return { matched: false, milliseconds: result.milliseconds, kind: 'empty' };
  return {
    matched: result.check.kind === 'matched',
    milliseconds: result.milliseconds,
    kind: recognition.kind,
    difference: recognition.difference,
    margin: recognition.margin,
    candidate: recognition.kind === 'recognized' ? recognition.phrase : recognition.candidate,
  };
}
function matched(result: ModelResult): boolean {
  return result.kind === 'processed' && result.check.kind === 'matched';
}
function publicAttempt(attempt: Attempt) {
  const { assignment, reading, observation } = attempt;
  if (observation.kind !== 'compared')
    return { assignment, reading, result: { kind: observation.kind } };
  const comparison = observation.comparison;
  return {
    assignment,
    reading,
    result: {
      kind: 'compared',
      durationMs: comparison.durationMs,
      first: comparison.first,
      aurora: publicScore(comparison.aurora),
      citrinet: publicScore(comparison.citrinet),
    },
  };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
async function start(): Promise<void> {
  try {
    const response = await fetch('/configuration.json');
    const raw: unknown = await response.json();
    if (
      !isPlainObject(raw) ||
      (raw.source !== 'human_microphone' && raw.source !== 'synthetic_fixture') ||
      typeof raw.revision !== 'string' ||
      typeof raw.sourceHash !== 'string' ||
      !isPlainObject(raw.hashes)
    ) {
      throw new Error('Comparison metadata is invalid');
    }
    const hashes: Record<string, string> = {};
    for (const [name, hash] of Object.entries(raw.hashes)) {
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
        throw new Error('Comparison asset digest is invalid');
      hashes[name] = hash;
    }
    new ComparisonSession({
      source: raw.source,
      revision: raw.revision,
      sourceHash: raw.sourceHash,
      hashes,
    });
  } catch (error) {
    element('status', HTMLParagraphElement).textContent = message(error);
  }
}
void start();
