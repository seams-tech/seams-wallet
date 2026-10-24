const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
const streams: MediaStream[] = [];
const originalPut = IDBObjectStore.prototype.put;
let cancelEnrollmentSave = false;

function observedPut(
  this: IDBObjectStore,
  value: unknown,
  key?: IDBValidKey,
): IDBRequest<IDBValidKey> {
  const request =
    key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
  if (
    cancelEnrollmentSave &&
    this.name === 'app_state' &&
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    value.key === 'voiceid-browser-enrollment-v1'
  ) {
    cancelEnrollmentSave = false;
    queueMicrotask(cancelEnrollment);
  }
  return request;
}
function cancelEnrollment(): void {
  const button = Array.from(document.querySelectorAll('button')).find(isEnrollmentCancel);
  if (!button) throw new Error('Enrollment cancellation control is unavailable');
  button.click();
}
function isEnrollmentCancel(button: HTMLButtonElement): boolean {
  return button.textContent === 'Cancel enrollment';
}
function cancelNextEnrollmentSave(): void {
  cancelEnrollmentSave = true;
}

async function observedGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const stream = await originalGetUserMedia(constraints);
  streams.push(stream);
  return stream;
}

function microphoneStates(): MediaStreamTrackState[] {
  return streams.flatMap(streamStates);
}
function streamStates(stream: MediaStream): MediaStreamTrackState[] {
  return stream.getTracks().map(trackState);
}
function trackState(track: MediaStreamTrack): MediaStreamTrackState {
  return track.readyState;
}

declare global {
  interface Window {
    voiceIdMicrophoneStates: typeof microphoneStates;
    voiceIdCancelNextEnrollmentSave: typeof cancelNextEnrollmentSave;
  }
}
navigator.mediaDevices.getUserMedia = observedGetUserMedia;
window.voiceIdMicrophoneStates = microphoneStates;
window.voiceIdCancelNextEnrollmentSave = cancelNextEnrollmentSave;
IDBObjectStore.prototype.put = observedPut;
export {};
