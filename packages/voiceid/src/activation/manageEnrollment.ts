import type { VoiceOwnerConfirmation } from '@seams/wallet/voiceid-host';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';
import { WorkerDeferred } from '@seams/wallet/voiceid-host';
import { enrollBrowserVoice } from '../browser/enrollment';
import {
  commitVoiceEnrollment,
  readVoiceEnrollment,
  readImportableVoiceBaseline,
} from '../browser/enrollmentStore';
import {
  type VoiceEnrollment,
  type VoiceEnrollmentScope,
  type VoiceEnrollmentSnapshot,
} from '@seams/wallet/voiceid-host';
import { prepareVoiceOwner } from '@seams/wallet/voiceid-host';
import { toError } from '@seams/wallet/voiceid-host';

type ManagementAction = 'replace' | 'improve' | 'reset' | 'import';
// `frame` carries the pending or error state; `detail` shows its message.
type ActionView = Readonly<{
  button: HTMLButtonElement;
  title: HTMLElement;
  detail: HTMLElement;
  frame: HTMLElement;
}>;

const SVG_NS = 'http://www.w3.org/2000/svg';
const PASSKEY_PROMPT = 'Confirm with your passkey to continue.';

export async function manageVoiceEnrollment(
  confirmChange: VoiceOwnerConfirmation,
  scope: VoiceEnrollmentScope,
  signal: AbortSignal,
  model: VoiceIdTranscriptionModel,
): Promise<void> {
  const parent = document.querySelector('.seams-voiceid-activation-surface');
  if (!(parent instanceof HTMLElement)) throw new Error('Open VoiceID management in the Wallet.');
  const surface = new VoiceEnrollmentManagement(parent, confirmChange, scope, signal, model);
  try {
    await surface.result;
  } finally {
    surface.dispose();
  }
}

class VoiceEnrollmentManagement {
  private readonly completion = new WorkerDeferred<void>();
  readonly result = this.completion.promise;
  private readonly element = document.createElement('div');
  private readonly enrollment = document.createElement('div');
  private readonly enrollmentValue = document.createElement('span');
  private readonly startOver = document.createElement('p');
  private readonly status = document.createElement('p');
  private readonly actions: Readonly<Record<ManagementAction, ActionView>>;
  private busy = false;
  private closed = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly confirmChange: VoiceOwnerConfirmation,
    private readonly scope: VoiceEnrollmentScope,
    private readonly signal: AbortSignal,
    private readonly model: VoiceIdTranscriptionModel,
  ) {
    this.element.className = 'seams-voiceid-prompt seams-voiceid-management';
    const header = document.createElement('div');
    header.className = 'seams-voiceid-management-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'seams-voiceid-management-back';
    back.setAttribute('aria-label', 'Back');
    back.append(chevron('M15 6l-6 6 6 6', 20));
    back.addEventListener('click', this.cancel);
    const heading = document.createElement('h2');
    heading.textContent = 'Manage voice';
    header.append(back, heading);
    const intro = document.createElement('p');
    intro.className = 'seams-voiceid-management-intro';
    intro.textContent = 'Voice unlock on this device. Each change asks for your passkey.';
    this.element.append(header, intro, this.enrollmentRow());
    this.actions = {
      reset: this.resetAction(),
      improve: this.action('improve', 'Improve recognition', true),
      import: this.action('import', 'Use saved enrollment', false),
      replace: this.startOverAction(),
    };
    this.status.setAttribute('role', 'status');
    this.element.append(this.status);
    this.enrollmentValue.textContent = 'Checking…';
    this.actions.import.button.hidden = true;
    this.render(null, false, false);
    this.parent.replaceChildren(this.element);
    this.signal.addEventListener('abort', this.cancel, { once: true });
    void this.refresh();
    back.focus();
  }

  private enrollmentRow(): HTMLElement {
    this.enrollment.className = 'seams-voiceid-management-enrollment';
    const label = document.createElement('span');
    label.textContent = 'Enrollment';
    this.enrollmentValue.className = 'seams-voiceid-management-value';
    const summary = document.createElement('span');
    summary.className = 'seams-voiceid-management-summary';
    summary.append(this.enrollmentValue);
    this.enrollment.append(label, summary);
    return this.enrollment;
  }

  private resetAction(): ActionView {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seams-voiceid-management-reset';
    button.textContent = 'Reset';
    button.setAttribute('aria-label', 'Reset improvements');
    button.addEventListener('click', this.begin.bind(this, 'reset'));
    const detail = document.createElement('span');
    detail.className = 'seams-voiceid-management-enrollment-detail';
    this.enrollment.querySelector('.seams-voiceid-management-summary')?.append(detail);
    this.enrollment.append(button);
    return { button, title: button, detail, frame: this.enrollment };
  }

  private startOverAction(): ActionView {
    this.startOver.className = 'seams-voiceid-management-section';
    this.startOver.textContent = 'Start over';
    this.element.append(this.startOver);
    return this.action('replace', 'Record voice again', false);
  }

  private action(action: ManagementAction, label: string, experimental: boolean): ActionView {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seams-voiceid-management-action';
    const text = document.createElement('span');
    const heading = document.createElement('span');
    heading.className = 'seams-voiceid-management-action-heading';
    const title = document.createElement('span');
    title.id = `seams-voiceid-management-${action}-title`;
    title.textContent = label;
    heading.append(title);
    const described: string[] = [];
    if (experimental) {
      const chip = document.createElement('span');
      chip.id = `seams-voiceid-management-${action}-chip`;
      chip.className = 'seams-voiceid-management-chip';
      chip.textContent = 'Experimental';
      heading.append(chip);
      described.push(chip.id);
    }
    const detail = document.createElement('span');
    detail.id = `seams-voiceid-management-${action}-detail`;
    detail.className = 'seams-voiceid-management-action-detail';
    described.push(detail.id);
    text.append(heading, detail);
    button.append(text, chevron('M9 6l6 6-6 6', 16));
    button.setAttribute('aria-labelledby', title.id);
    button.setAttribute('aria-describedby', described.join(' '));
    button.disabled = true;
    button.addEventListener('click', this.begin.bind(this, action));
    this.element.append(button);
    return { button, title, detail, frame: button };
  }

  private async refresh(): Promise<void> {
    try {
      const enrollment = await readVoiceEnrollment(this.scope);
      const previous = enrollment ? null : await readImportableVoiceBaseline();
      if (this.closed) return;
      this.render(enrollment, previous !== null, true);
    } catch (error) {
      this.completion.reject(toError(error));
    }
  }

  private render(enrollment: VoiceEnrollment | null, importable: boolean, ready: boolean): void {
    const adaptation = enrollment?.adaptation ?? null;
    const { improve, reset, import: importAction, replace } = this.actions;
    if (ready) {
      this.enrollment.dataset.enrollment = adaptation?.kind ?? 'missing';
      this.enrollmentValue.textContent =
        adaptation === null
          ? 'Not on this device'
          : adaptation.kind === 'adapted'
            ? 'Improved'
            : 'Original';
      improve.button.hidden = enrollment === null;
      importAction.button.hidden = !importable;
    }
    reset.button.hidden = adaptation?.kind !== 'adapted';
    reset.detail.textContent = adaptation?.kind === 'adapted' ? 'Saved on this device' : '';
    improve.title.textContent =
      adaptation?.kind === 'adapted' ? 'Improve again' : 'Improve recognition';
    improve.detail.textContent =
      adaptation?.kind === 'adapted'
        ? 'Replace the added samples. Your original enrollment stays.'
        : 'Add three samples. They stay until you replace or reset them.';
    importAction.detail.textContent = 'Import the voice enrollment saved in this browser.';
    replace.detail.textContent =
      adaptation?.kind === 'adapted'
        ? 'Replace your enrollment and remove improvements.'
        : 'Replace your enrollment with three new samples.';
    this.startOver.hidden = improve.button.hidden && importAction.button.hidden;
    for (const view of Object.values(this.actions)) {
      delete view.frame.dataset.state;
      view.button.disabled = !ready;
    }
    this.status.textContent = '';
    delete this.status.dataset.placement;
  }

  // Shows a message in the action's own row and announces it. A hidden row
  // leaves the message visible in the dialog's status line instead.
  private show(action: ManagementAction, state: 'pending' | 'error', message: string): void {
    const view = this.actions[action];
    this.status.textContent = message;
    if (view.button.hidden) {
      this.status.dataset.placement = 'dialog';
      return;
    }
    view.frame.dataset.state = state;
    view.detail.textContent = message;
  }

  private begin(action: ManagementAction): void {
    if (this.busy || this.closed) return;
    this.busy = true;
    for (const view of Object.values(this.actions)) view.button.disabled = true;
    this.show(action, 'pending', PASSKEY_PROMPT);
    void this.perform(action);
  }

  private async perform(action: ManagementAction): Promise<void> {
    try {
      const guard = await prepareVoiceOwner(this.scope, 'enrolled');
      const enrollment = await readVoiceEnrollment(this.scope);
      const snapshot: VoiceEnrollmentSnapshot = enrollment
        ? { kind: 'present', enrollment }
        : { kind: 'missing' };
      if (action === 'improve' && snapshot.kind === 'missing')
        throw new Error('Record or import your original voice first.');
      const previous = action === 'import' ? await readImportableVoiceBaseline() : null;
      if (action === 'import' && (!previous || snapshot.kind !== 'missing'))
        throw new Error('The previous enrollment is unavailable.');
      const confirmation = await this.confirmChange(
        guard,
        snapshot,
        action,
        this.signal,
      );
      this.signal.throwIfAborted();
      switch (action) {
        case 'improve':
          if (snapshot.kind !== 'present')
            throw new Error('Original voice enrollment is unavailable.');
          await enrollBrowserVoice(
            { kind: 'improve', scope: this.scope, guard, snapshot, confirmation },
            this.signal,
            this.model,
          );
          break;
        case 'replace':
          await enrollBrowserVoice(
            { kind: 'replace', scope: this.scope, guard, snapshot, confirmation },
            this.signal,
            this.model,
          );
          break;
        case 'reset':
          await commitVoiceEnrollment(
            this.scope,
            guard,
            snapshot,
            { kind: 'reset', confirmation },
            this.signal,
          );
          break;
        case 'import':
          if (!previous) throw new Error('Previous voice enrollment is unavailable.');
          await commitVoiceEnrollment(
            this.scope,
            guard,
            snapshot,
            { kind: 'import', baseline: previous, confirmation },
            this.signal,
          );
          break;
      }
      if (!this.closed) this.completion.resolve();
    } catch (error) {
      if (this.closed) return;
      this.parent.replaceChildren(this.element);
      await this.refresh();
      if (!this.closed)
        this.show(
          action,
          'error',
          error instanceof Error ? error.message : 'VoiceID could not be updated.',
        );
    } finally {
      this.busy = false;
    }
  }

  private readonly cancel = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.parent.dispatchEvent(new Event('cancel', { bubbles: true }));
    this.completion.reject(new Error('VoiceID management was cancelled.'));
  };

  dispose(): void {
    this.closed = true;
    this.signal.removeEventListener('abort', this.cancel);
    this.element.remove();
  }
}

function chevron(path: string, size: number): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', String(size));
  icon.setAttribute('height', String(size));
  icon.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', path);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.75');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  icon.append(line);
  return icon;
}
