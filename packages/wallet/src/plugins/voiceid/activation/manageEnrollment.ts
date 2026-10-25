import type { RegistrationWebContext } from '@/SeamsWeb/signingSurface/types';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { enrollBrowserVoice } from '../browser/enrollment';
import {
  commitVoiceEnrollment,
  readVoiceEnrollment,
  readImportableVoiceBaseline,
  type VoiceEnrollmentScope,
  type VoiceEnrollmentSnapshot,
} from '../browser/enrollmentStore';
import { ConfirmedVoiceChange, prepareVoiceOwner } from './ownerConfirmation';
import { toError } from '@shared/utils/errors';

type ManagementAction = 'replace' | 'improve' | 'reset' | 'import';

export async function manageVoiceEnrollment(
  context: RegistrationWebContext,
  scope: VoiceEnrollmentScope,
  signal: AbortSignal,
): Promise<void> {
  const parent = document.querySelector('.seams-voiceid-activation-surface');
  if (!(parent instanceof HTMLElement)) throw new Error('Open VoiceID management in the Wallet.');
  const surface = new VoiceEnrollmentManagement(parent, context, scope, signal);
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
  private readonly status = document.createElement('p');
  private readonly improve: HTMLButtonElement;
  private readonly reset: HTMLButtonElement;
  private readonly importButton: HTMLButtonElement;
  private busy = false;
  private closed = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly context: RegistrationWebContext,
    private readonly scope: VoiceEnrollmentScope,
    private readonly signal: AbortSignal,
  ) {
    this.element.className = 'seams-voiceid-prompt seams-voiceid-management';
    const heading = document.createElement('h2');
    heading.textContent = 'Manage voice';
    const description = document.createElement('p');
    description.textContent =
      'Experimental improvements use three new samples and preserve your original voice. They expire after 24 hours or 32 voice checks. Each change requires your passkey.';
    this.status.setAttribute('role', 'status');
    this.element.append(heading, description);
    this.improve = this.action('Improve voice recognition', 'improve');
    this.reset = this.action('Reset voice improvements', 'reset');
    this.importButton = this.action('Use existing voice enrollment', 'import');
    this.action('Record voice again', 'replace');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', this.cancel);
    this.element.append(this.status, cancel);
    this.parent.replaceChildren(this.element);
    this.signal.addEventListener('abort', this.cancel, { once: true });
    void this.refresh();
    cancel.focus();
  }

  private action(label: string, action: ManagementAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'seams-voiceid-record';
    button.disabled = true;
    button.addEventListener('click', this.begin.bind(this, action));
    this.element.append(button);
    return button;
  }

  private async refresh(): Promise<void> {
    try {
      const enrollment = await readVoiceEnrollment(this.scope);
      const previous = enrollment ? null : await readImportableVoiceBaseline();
      if (this.closed) return;
      for (const button of this.element.querySelectorAll('button')) button.disabled = false;
      this.improve.disabled = enrollment === null;
      this.reset.disabled = enrollment === null || enrollment.adaptation.kind === 'baseline';
      this.importButton.hidden = previous === null;
    } catch (error) {
      this.completion.reject(toError(error));
    }
  }

  private begin(action: ManagementAction): void {
    if (this.busy || this.closed) return;
    this.busy = true;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>(
      'button.seams-voiceid-record',
    ))
      button.disabled = true;
    this.status.textContent = 'Confirm this change with your passkey.';
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
      const confirmation = await ConfirmedVoiceChange.request(
        this.context,
        this.scope,
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
          );
          break;
        case 'replace':
          await enrollBrowserVoice(
            { kind: 'replace', scope: this.scope, guard, snapshot, confirmation },
            this.signal,
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
      this.status.textContent =
        error instanceof Error ? error.message : 'VoiceID could not be updated.';
      await this.refresh();
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
