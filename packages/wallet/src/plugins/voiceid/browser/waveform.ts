import type { VoiceActivityEvent } from './microphone';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// The recorder judges 32 ms frames.
const FRAME_MS = 32;
// The 340 by 64 frame. While listening, time runs left to right; the scale
// shrinks only when the capture outgrows SPAN_MIN.
const WIDTH = 340;
const MID = 32;
const PAD = 6;
const SPAN_MIN = 3_400;
const SPAN_TAIL = 300;
// The dotted time ahead starts to close after the first sixth of the end pause.
const PAUSE_GRACE = 1 / 6;
// Ambient sound: -66 dBFS lies flat and -30 dBFS reaches the cap, so a loud room
// still draws only a faint ripple.
const RIPPLE_FLOOR_DB = -66;
const RIPPLE_RANGE_DB = 36;
const RIPPLE_MAX = 3.5;
const CONTOUR_SCALE = 30;
// Frames kept on each side of the speech when a finished capture trims.
const TRIM_FRAMES = 3;
const SETTLE_MS = 380;
const CHECK_MS = 320;
// Reduced motion redraws a live capture every 160 ms.
const REDUCED_FRAMES = 5;

type TracePhase = 'rest' | 'live' | 'checking' | 'accepted' | 'retry';
type Frame = Readonly<{ rms: number; speech: boolean }>;
type Point = readonly [x: number, y: number];
type Place = (index: number) => number;
// Per frame: the ripple's y, and the half height of the speech contours.
type Shape = Readonly<{ ripple: number[]; contour: number[] }>;

// While the Wallet checks a capture, the trace only dims.
const OPACITY: Readonly<Record<TracePhase, number>> = {
  rest: 1,
  live: 1,
  checking: 0.5,
  accepted: 1,
  retry: 0.35,
};

export function voiceDisplayLevel(rms: number): number {
  const signal = Math.max(0, rms - 0.003);
  return Math.pow(signal / (signal + 0.08), 0.7);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// The ease of the site's line figures: cubic-bezier(0.5, 0, 0.1, 1).
function ease(x: number): number {
  const curve = (a: number, b: number, t: number): number =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 22; step += 1) {
    const middle = (low + high) / 2;
    if (curve(0.5, 0.1, middle) < x) low = middle;
    else high = middle;
  }
  return curve(0, 1, (low + high) / 2);
}

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ripplePx(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return RIPPLE_MAX * clamp((db - RIPPLE_FLOOR_DB) / RIPPLE_RANGE_DB);
}

// A fixed wave per frame: the ripple records the room and never flickers.
function wave(index: number): number {
  return 0.6 * Math.sin(index * 1.66 + 1.7) + 0.4 * Math.sin(index * 0.58 + 4.1);
}

function smooth(values: readonly number[]): number[] {
  return values.map(
    (value, index) =>
      (values[Math.max(0, index - 1)] +
        2 * value +
        values[Math.min(values.length - 1, index + 1)]) /
      4,
  );
}

function shapeOf(frames: readonly Frame[]): Shape {
  const ripple = smooth(frames.map((frame) => ripplePx(frame.rms)));
  const level = smooth(frames.map((frame) => voiceDisplayLevel(frame.rms)));
  return {
    ripple: ripple.map((height, index) => MID + height * wave(index)),
    contour: level.map((value, index) =>
      Math.min(MID - 3, Math.max(ripple[index], CONTOUR_SCALE * value ** 1.4)),
    ),
  };
}

function live(span: number): Place {
  return (index: number): number => PAD + ((index * FRAME_MS) / span) * (WIDTH - 2 * PAD);
}

// A smooth line through the midpoints between frame points.
function curve(points: readonly Point[], command: 'M' | 'L'): string {
  if (points.length === 0) return '';
  let path = `${command}${round(points[0][0])},${round(points[0][1])}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const [x, y] = points[index];
    const [nextX, nextY] = points[index + 1];
    path += `Q${round(x)},${round(y)} ${round((x + nextX) / 2)},${round((y + nextY) / 2)}`;
  }
  if (points.length > 1) {
    const [x, y] = points[points.length - 1];
    path += `L${round(x)},${round(y)}`;
  }
  return path;
}

// The ripple runs through the frames that are not speech.
function ripplePath(
  frames: readonly Frame[],
  shape: Shape,
  from: number,
  to: number,
  place: Place,
): string {
  let path = '';
  let points: Point[] = [];
  for (let index = from; index <= to + 1; index += 1) {
    if (index <= to && !frames[index].speech) {
      points.push([place(index), shape.ripple[index]]);
      continue;
    }
    path += curve(points, 'M');
    points = [];
  }
  return path;
}

// Each speech run opens into two contours that close on the ripple at both ends.
function speechPath(
  frames: readonly Frame[],
  shape: Shape,
  from: number,
  to: number,
  place: Place,
): { stroke: string; fill: string } {
  let stroke = '';
  let fill = '';
  let index = from;
  while (index <= to) {
    if (!frames[index].speech) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < to && frames[end + 1].speech) end += 1;
    const top: Point[] = [];
    const bottom: Point[] = [];
    for (let frame = Math.max(from, index - 1); frame <= Math.min(to, end + 1); frame += 1) {
      const x = place(frame);
      const edge = !frames[frame].speech;
      top.push([x, edge ? shape.ripple[frame] : MID - shape.contour[frame]]);
      bottom.push([x, edge ? shape.ripple[frame] : MID + shape.contour[frame]]);
    }
    stroke += curve(top, 'M') + curve(bottom, 'M');
    fill += `${curve(top, 'M')}${curve([...bottom].reverse(), 'L')}Z`;
    index = end + 1;
  }
  return { stroke, fill };
}

function svgPart<K extends 'path' | 'circle' | 'g'>(
  document: Document,
  name: K,
  className: string,
  parent: Element,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  element.setAttribute('class', className);
  parent.append(element);
  return element;
}

/**
 * Presentation only: it draws the recorder's activity frames and never touches the
 * microphone. Ambient sound draws a faint ripple and speech opens into contours.
 */
export class VoiceTrace {
  readonly element: SVGSVGElement;
  private readonly future: SVGPathElement;
  private readonly capture: SVGGElement;
  private readonly outside: SVGPathElement;
  private readonly ripple: SVGPathElement;
  private readonly body: SVGPathElement;
  private readonly contour: SVGPathElement;
  private readonly check: SVGPathElement;
  private readonly pen: SVGCircleElement;
  private frames: Frame[] = [];
  private first = -1;
  private last = -1;
  private pause = 0;
  private phase: TracePhase = 'rest';
  private endedAt = -Infinity;
  private acceptedAt = -Infinity;
  private frame = 0;

  constructor(document: Document) {
    this.element = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.element.classList.add('seams-voiceid-trace');
    this.element.setAttribute('viewBox', `0 0 ${WIDTH} 64`);
    this.element.setAttribute('aria-hidden', 'true');
    this.future = svgPart(document, 'path', 'seams-voiceid-trace-future', this.element);
    this.capture = svgPart(document, 'g', 'seams-voiceid-trace-capture', this.element);
    this.outside = svgPart(document, 'path', 'seams-voiceid-trace-ripple', this.capture);
    this.ripple = svgPart(document, 'path', 'seams-voiceid-trace-ripple', this.capture);
    this.body = svgPart(document, 'path', 'seams-voiceid-trace-body', this.capture);
    this.contour = svgPart(document, 'path', 'seams-voiceid-trace-contour', this.capture);
    this.check = svgPart(document, 'path', 'seams-voiceid-trace-check', this.element);
    this.check.setAttribute('pathLength', '1');
    this.pen = svgPart(document, 'circle', 'seams-voiceid-trace-pen', this.element);
    this.pen.setAttribute('r', '2.25');
    this.draw(0);
  }

  /** A new capture has opened the microphone. */
  listen(): void {
    this.frames = [];
    this.first = -1;
    this.last = -1;
    this.pause = 0;
    this.show('live');
  }

  add(event: VoiceActivityEvent): void {
    if (this.phase !== 'live') return;
    const index = this.frames.length;
    this.frames.push({ rms: event.rms, speech: event.speech });
    if (event.speech) {
      if (this.first < 0) this.first = index;
      this.last = index;
    }
    this.pause = event.pause;
    if (!reducedMotion() || this.frames.length % REDUCED_FRAMES === 0) this.schedule();
  }

  /** The capture ended: trim to its speech and dim while the Wallet checks it. */
  checking(): void {
    this.endedAt = this.phase === 'live' ? performance.now() : -Infinity;
    this.show('checking');
  }

  accept(): void {
    this.acceptedAt = performance.now();
    this.show('accepted');
  }

  /** Waiting for Record: an accepted capture keeps its check, any other one dims. */
  ready(): void {
    if (this.frames.length === 0) this.show('rest');
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

  private readonly draw = (time: number): void => {
    this.frame = 0;
    const reduced = reducedMotion();
    const settling = reduced ? 1 : clamp((time - this.endedAt) / SETTLE_MS);
    const checking = reduced ? 1 : clamp((time - this.acceptedAt) / CHECK_MS);
    for (const path of [
      this.future,
      this.outside,
      this.ripple,
      this.body,
      this.contour,
      this.check,
    ])
      path.setAttribute('d', '');
    this.capture.style.opacity = String(OPACITY[this.phase]);
    this.pen.style.opacity = '0';
    if (this.phase === 'rest' || this.frames.length === 0) this.rest();
    else if (this.phase === 'live') this.listening();
    else this.settled(settling, this.phase === 'accepted' ? checking : 1);
    if (this.phase !== 'live' && (settling < 1 || (this.phase === 'accepted' && checking < 1)))
      this.schedule();
  };

  private rest(): void {
    this.future.setAttribute('d', `M${PAD + 6},${MID}H${WIDTH - PAD}`);
    this.pen.setAttribute('cx', String(PAD));
    this.pen.setAttribute('cy', String(MID));
    this.pen.style.opacity = '0.45';
  }

  private listening(): void {
    const frames = this.frames;
    const shape = shapeOf(frames);
    const last = frames.length - 1;
    const place = live(Math.max(SPAN_MIN, frames.length * FRAME_MS + SPAN_TAIL));
    this.ripple.setAttribute('d', ripplePath(frames, shape, 0, last, place));
    const speech = speechPath(frames, shape, 0, last, place);
    this.body.setAttribute('d', speech.fill);
    this.contour.setAttribute('d', speech.stroke);
    const closing = clamp((this.pause - PAUSE_GRACE) / (1 - PAUSE_GRACE));
    const head = place(last);
    const ahead = lerp(WIDTH - PAD, head + 5, closing * closing);
    if (ahead > head + 6)
      this.future.setAttribute('d', `M${round(head + 5)},${MID}H${round(ahead)}`);
    this.pen.setAttribute('cx', String(round(head)));
    this.pen.setAttribute('cy', String(round(frames[last].speech ? MID : shape.ripple[last])));
    this.pen.style.opacity = '1';
  }

  // A finished capture trims to its speech, widens and centres under the phrase.
  private settled(settling: number, checking: number): void {
    const frames = this.frames;
    const shape = shapeOf(frames);
    const last = frames.length - 1;
    const from = this.first < 0 ? 0 : Math.max(0, this.first - TRIM_FRAMES);
    const to = this.first < 0 ? last : Math.min(last, this.last + TRIM_FRAMES);
    const before = live(Math.max(SPAN_MIN, frames.length * FRAME_MS + SPAN_TAIL));
    const width = Math.min(270, Math.max(160, (to - from) * FRAME_MS * 0.18));
    const left = WIDTH / 2 - 6 - width / 2;
    const amount = ease(settling);
    const place: Place = (index) =>
      lerp(before(index), left + ((index - from) / Math.max(1, to - from)) * width, amount);
    const outside =
      ripplePath(frames, shape, 0, from, place) + ripplePath(frames, shape, to, last, place);
    this.outside.setAttribute('d', amount < 1 ? outside : '');
    this.outside.style.opacity = String(1 - amount);
    this.ripple.setAttribute('d', ripplePath(frames, shape, from, to, place));
    const speech = speechPath(frames, shape, from, to, place);
    this.body.setAttribute('d', speech.fill);
    this.contour.setAttribute('d', speech.stroke);
    this.pen.setAttribute('cx', String(round(place(last))));
    this.pen.setAttribute('cy', String(MID));
    this.pen.style.opacity = String(1 - amount);
    if (this.phase !== 'accepted') return;
    this.check.setAttribute('d', `M${round(place(to) + 9)},${MID}l3.5,3.5l6.5,-7.5`);
    this.check.style.strokeDashoffset = String(1 - ease(checking));
  }
}
