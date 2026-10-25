import type { VoiceActivityEvent } from './microphone';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// One bar per 32 ms recorder frame. The newest frame enters at the right edge and
// older frames move left, so the row holds the last 1.4 s.
const BAR_COUNT = 44;
const PITCH = 7;
const BAR_WIDTH = 2.5;
const WIDTH = BAR_COUNT * PITCH;
const MID = 32;
// Quiet frames are round dots; speech bars run from 4 px to 56 px.
const DOT = BAR_WIDTH;
const SPEECH_MIN = 4;
const SPEECH_RANGE = 52;
// Ambient sound: -66 dBFS stays a dot and -30 dBFS reaches 7 px, so a loud room
// still draws only short, dim bars.
const AMBIENT_FLOOR_DB = -66;
const AMBIENT_RANGE_DB = 36;
const AMBIENT_RISE = 4.5;
// Older frames fade out over the left fifth of the row.
const FADE_WIDTH = WIDTH * 0.2;
// Reduced motion redraws a live capture every 160 ms.
const REDUCED_FRAMES = 5;

type TracePhase = 'rest' | 'live' | 'checking' | 'accepted' | 'retry';
type Bar = Readonly<{ kind: 'speech' | 'ambient' | 'rest'; height: number }>;

// A finished capture stays in place: it dims while the Wallet checks it, returns
// to full strength when accepted, and stays dim for a retry.
const OPACITY: Readonly<Record<TracePhase, number>> = {
  rest: 1,
  live: 1,
  checking: 0.5,
  accepted: 1,
  retry: 0.35,
};
const REST_BAR: Bar = { kind: 'rest', height: DOT };
let traceCount = 0;

export function voiceDisplayLevel(rms: number): number {
  const signal = Math.max(0, rms - 0.003);
  return Math.pow(signal / (signal + 0.08), 0.7);
}

function barFor(event: VoiceActivityEvent): Bar {
  if (event.speech)
    return { kind: 'speech', height: SPEECH_MIN + voiceDisplayLevel(event.rms) * SPEECH_RANGE };
  const db = 20 * Math.log10(Math.max(event.rms, 1e-6));
  const rise = Math.min(1, Math.max(0, (db - AMBIENT_FLOOR_DB) / AMBIENT_RANGE_DB));
  return { kind: 'ambient', height: DOT + AMBIENT_RISE * rise };
}

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Presentation only: it draws the recorder's activity frames as a scrolling row of
 * rounded bars and never touches the microphone. Speech frames draw full bars;
 * ambient sound draws short, dim bars.
 */
export class VoiceTrace {
  readonly element: SVGSVGElement;
  private readonly row: SVGGElement;
  private readonly bars: SVGRectElement[] = [];
  private history: Bar[] = [];
  private phase: TracePhase = 'rest';
  private frame = 0;

  constructor(document: Document) {
    const fadeId = `seams-voiceid-trace-fade-${(traceCount += 1)}`;
    this.element = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.element.classList.add('seams-voiceid-trace');
    this.element.setAttribute('viewBox', `0 0 ${WIDTH} 64`);
    this.element.setAttribute('aria-hidden', 'true');
    const gradient = document.createElementNS(SVG_NAMESPACE, 'linearGradient');
    gradient.id = `${fadeId}-gradient`;
    gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    gradient.setAttribute('x2', String(FADE_WIDTH));
    for (const [offset, opacity] of [
      ['0', '0'],
      ['1', '1'],
    ]) {
      const stop = document.createElementNS(SVG_NAMESPACE, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', '#fff');
      stop.setAttribute('stop-opacity', opacity);
      gradient.append(stop);
    }
    const mask = document.createElementNS(SVG_NAMESPACE, 'mask');
    mask.id = fadeId;
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('width', String(WIDTH));
    mask.setAttribute('height', '64');
    const area = document.createElementNS(SVG_NAMESPACE, 'rect');
    area.setAttribute('width', String(WIDTH));
    area.setAttribute('height', '64');
    area.setAttribute('fill', `url(#${gradient.id})`);
    mask.append(area);
    const defs = document.createElementNS(SVG_NAMESPACE, 'defs');
    defs.append(gradient, mask);
    this.row = document.createElementNS(SVG_NAMESPACE, 'g');
    this.row.setAttribute('class', 'seams-voiceid-trace-row');
    this.row.setAttribute('mask', `url(#${fadeId})`);
    this.element.append(defs, this.row);
    for (let index = 0; index < BAR_COUNT; index += 1) {
      const bar = document.createElementNS(SVG_NAMESPACE, 'rect');
      bar.setAttribute('x', String((PITCH - BAR_WIDTH) / 2 + index * PITCH));
      bar.setAttribute('width', String(BAR_WIDTH));
      bar.setAttribute('rx', String(BAR_WIDTH / 2));
      this.row.append(bar);
      this.bars.push(bar);
    }
    this.draw();
  }

  /** A new capture has opened the microphone. */
  listen(): void {
    this.history = [];
    this.show('live');
  }

  add(event: VoiceActivityEvent): void {
    if (this.phase !== 'live') return;
    this.history.push(barFor(event));
    if (this.history.length > BAR_COUNT) this.history.shift();
    if (!reducedMotion() || this.history.length % REDUCED_FRAMES === 0) this.schedule();
  }

  /** The capture ended: the row stops and dims while the Wallet checks it. */
  checking(): void {
    this.show('checking');
  }

  accept(): void {
    this.show('accepted');
  }

  /** Waiting for Record: an accepted capture stays at full strength, any other one dims. */
  ready(): void {
    if (this.history.length === 0) this.show('rest');
    else if (this.phase !== 'accepted') this.show('retry');
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private show(phase: TracePhase): void {
    this.phase = phase;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame === 0) this.frame = requestAnimationFrame(this.draw);
  }

  // The newest frame sits at the right edge; places without a frame yet are dots.
  private readonly draw = (): void => {
    this.frame = 0;
    this.row.style.opacity = String(OPACITY[this.phase]);
    const empty = BAR_COUNT - this.history.length;
    this.bars.forEach((element, index) => {
      const bar = index < empty ? REST_BAR : this.history[index - empty];
      element.setAttribute('class', `seams-voiceid-trace-${bar.kind}`);
      element.setAttribute('y', String(Math.round((MID - bar.height / 2) * 10) / 10));
      element.setAttribute('height', String(Math.round(bar.height * 10) / 10));
    });
  };
}
