import React, { useEffect, useRef } from 'react';
import { END_PAUSE_MS, FRAME_MS, type VoiceCapture } from './voiceCapture';

export type TracePhase = 'rest' | 'live' | 'captured' | 'checking' | 'approved' | 'retry';
type CaptureSource = () => VoiceCapture | null;
type Place = (index: number) => number;
// Per frame: the ripple's y, and the half height of the speech contours.
type Shape = Readonly<{ ripple: number[]; contour: number[] }>;

// The 340 by 64 frame. While listening, time runs left to right; the scale
// shrinks only when the capture outgrows SPAN_MIN.
const WIDTH = 340;
const MID = 32;
const PAD = 6;
const SPAN_MIN = 3_400;
const SPAN_TAIL = 300;
// The dotted time ahead starts to close after this much of the end pause.
const PAUSE_GRACE_MS = 250;
// Ambient sound: -66 dBFS lies flat and -30 dBFS reaches the cap, so a loud room
// still draws only a faint ripple.
const RIPPLE_FLOOR_DB = -66;
const RIPPLE_RANGE_DB = 36;
const RIPPLE_MAX = 3.5;
const CONTOUR_SCALE = 30;
const SETTLE_MS = 380;
const CHECK_MS = 320;
const REDUCED_FRAMES = 160 / FRAME_MS;
// While the glow shows the check, the trace only dims.
const OPACITY: Readonly<Record<TracePhase, number>> = {
  rest: 1,
  live: 1,
  captured: 1,
  checking: 0.5,
  approved: 1,
  retry: 0.35,
};

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const curve = (a: number, b: number, t: number): number =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number): number => {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 22; step += 1) {
      const middle = (low + high) / 2;
      if (curve(x1, x2, middle) < x) low = middle;
      else high = middle;
    }
    return curve(y1, y2, (low + high) / 2);
  };
}

// The site's hairline figures use this ease.
const ease = bezier(0.5, 0, 0.1, 1);

function ripplePx(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return RIPPLE_MAX * clamp((db - RIPPLE_FLOOR_DB) / RIPPLE_RANGE_DB);
}

// A fixed wave per frame: the ripple records the room and never flickers.
function wave(index: number): number {
  return (
    0.5 * Math.sin(index * 0.83 + 1.7) +
    0.3 * Math.sin(index * 0.29 + 4.1) +
    0.2 * Math.sin(index * 1.93 + 0.6)
  );
}

function smooth(values: readonly number[]): number[] {
  const weights = [1, 2, 3, 2, 1];
  return values.map((_, index) => {
    let sum = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const neighbour = values[Math.min(values.length - 1, Math.max(0, index + offset))];
      sum += weights[offset + 2] * neighbour;
    }
    return sum / 9;
  });
}

function shapeOf(capture: VoiceCapture): Shape {
  const ripple = smooth(capture.frames.map((frame) => ripplePx(frame.rms)));
  const level = smooth(capture.frames.map((frame) => frame.level));
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

// The ripple runs through the frames that are not speech.
function ripplePath(
  capture: VoiceCapture,
  shape: Shape,
  from: number,
  to: number,
  place: Place,
): string {
  let path = '';
  let open = false;
  for (let index = from; index <= to; index += 1) {
    if (capture.frames[index].voiced) {
      open = false;
      continue;
    }
    path += `${open ? 'L' : 'M'}${round(place(index))},${round(shape.ripple[index])}`;
    open = true;
  }
  return path;
}

// Each speech run opens into two contours that close on the ripple at both ends.
function speechPath(
  capture: VoiceCapture,
  shape: Shape,
  from: number,
  to: number,
  place: Place,
): { stroke: string; fill: string } {
  let stroke = '';
  let fill = '';
  let index = from;
  while (index <= to) {
    if (!capture.frames[index].voiced) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < to && capture.frames[end + 1].voiced) end += 1;
    const first = Math.max(from, index - 1);
    const last = Math.min(to, end + 1);
    let top = '';
    let bottom = '';
    let back = '';
    for (let frame = first; frame <= last; frame += 1) {
      const x = round(place(frame));
      const edge = !capture.frames[frame].voiced;
      const upper = round(edge ? shape.ripple[frame] : MID - shape.contour[frame]);
      const lower = round(edge ? shape.ripple[frame] : MID + shape.contour[frame]);
      top += `${frame === first ? 'M' : 'L'}${x},${upper}`;
      bottom += `${frame === first ? 'M' : 'L'}${x},${lower}`;
      back = `L${x},${lower}${back}`;
    }
    stroke += top + bottom;
    fill += `${top}${back}Z`;
    index = end + 1;
  }
  return { stroke, fill };
}

function part<T extends Element>(svg: SVGSVGElement, selector: string): T {
  const element = svg.querySelector<T>(selector);
  if (!element) throw new Error(`Trace part is unavailable: ${selector}`);
  return element;
}

/** Presentation only: it reads a capture and never touches the microphone. */
class TraceAnimation {
  private frame = 0;
  private phase: TracePhase = 'rest';
  private previous: TracePhase = 'rest';
  private changedAt = 0;
  private drawn = '';
  private source: CaptureSource = noCapture;
  private readonly future: SVGPathElement;
  private readonly group: SVGGElement;
  private readonly outside: SVGPathElement;
  private readonly ripple: SVGPathElement;
  private readonly body: SVGPathElement;
  private readonly contour: SVGPathElement;
  private readonly check: SVGPathElement;
  private readonly pen: SVGCircleElement;

  constructor(svg: SVGSVGElement) {
    this.future = part(svg, '.trace-future');
    this.group = part(svg, '.trace-capture');
    this.outside = part(svg, '[data-part="outside"]');
    this.ripple = part(svg, '[data-part="ripple"]');
    this.body = part(svg, '.trace-body');
    this.contour = part(svg, '.trace-contour');
    this.check = part(svg, '.trace-check');
    this.pen = part(svg, '.trace-pen');
    this.frame = requestAnimationFrame(this.draw);
  }

  show(source: CaptureSource, phase: TracePhase): void {
    this.source = source;
    if (phase !== this.phase) {
      this.previous = this.phase;
      this.phase = phase;
      this.changedAt = performance.now();
    }
    this.drawn = '';
  }

  readonly stop = (): void => {
    cancelAnimationFrame(this.frame);
  };

  private readonly draw = (time: number): void => {
    this.frame = requestAnimationFrame(this.draw);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const capture = this.phase === 'rest' ? null : this.source();
    const elapsed = time - this.changedAt;
    const settling = this.previous === 'live' && !reduced ? clamp(elapsed / SETTLE_MS) : 1;
    const checking = this.phase === 'approved' && !reduced ? clamp(elapsed / CHECK_MS) : 1;
    let count = capture?.frames.length ?? 0;
    if (reduced && this.phase === 'live') count -= count % REDUCED_FRAMES;
    const key = `${this.phase}:${count}:${settling}:${checking}`;
    if (key === this.drawn) return;
    this.drawn = key;
    for (const path of [
      this.future,
      this.outside,
      this.ripple,
      this.body,
      this.contour,
      this.check,
    ])
      path.setAttribute('d', '');
    this.group.style.opacity = String(OPACITY[this.phase]);
    this.outside.style.opacity = '1';
    this.pen.style.opacity = '0';
    if (!capture || count === 0) this.rest();
    else if (this.phase === 'live') this.listen(capture, count);
    else this.settle(capture, settling, checking);
  };

  private rest(): void {
    this.future.setAttribute('d', `M${PAD + 6},${MID}H${WIDTH - PAD}`);
    this.pen.setAttribute('cx', String(PAD));
    this.pen.setAttribute('cy', String(MID));
    this.pen.style.opacity = '0.45';
  }

  private listen(capture: VoiceCapture, count: number): void {
    const shape = shapeOf(capture);
    const last = count - 1;
    const place = live(Math.max(SPAN_MIN, count * FRAME_MS + SPAN_TAIL));
    this.ripple.setAttribute('d', ripplePath(capture, shape, 0, last, place));
    const speech = speechPath(capture, shape, 0, last, place);
    this.body.setAttribute('d', speech.fill);
    this.contour.setAttribute('d', speech.stroke);
    const pause = clamp((capture.silenceMs() - PAUSE_GRACE_MS) / (END_PAUSE_MS - PAUSE_GRACE_MS));
    const head = place(last);
    const ahead = lerp(WIDTH - PAD, head + 5, pause * pause);
    if (ahead > head + 6)
      this.future.setAttribute('d', `M${round(head + 5)},${MID}H${round(ahead)}`);
    const voiced = capture.frames[last].voiced;
    this.pen.setAttribute('cx', String(round(head)));
    this.pen.setAttribute('cy', String(round(voiced ? MID : shape.ripple[last])));
    this.pen.style.opacity = '1';
  }

  // The finished capture trims to its speech span, widens and centres over the glow.
  private settle(capture: VoiceCapture, settling: number, checking: number): void {
    const shape = shapeOf(capture);
    const last = capture.frames.length - 1;
    const from = capture.first < 0 ? 0 : Math.max(0, capture.first - 6);
    const to = capture.first < 0 ? last : Math.min(last, capture.last + 6);
    const before = live(Math.max(SPAN_MIN, capture.frames.length * FRAME_MS + SPAN_TAIL));
    const width = Math.min(270, Math.max(160, (to - from) * FRAME_MS * 0.18));
    const left = WIDTH / 2 - 6 - width / 2;
    const amount = ease(settling);
    const place: Place = (index) =>
      lerp(before(index), left + ((index - from) / Math.max(1, to - from)) * width, amount);
    const outside =
      ripplePath(capture, shape, 0, from, place) + ripplePath(capture, shape, to, last, place);
    this.outside.setAttribute('d', outside);
    this.outside.style.opacity = String(1 - amount);
    this.ripple.setAttribute('d', ripplePath(capture, shape, from, to, place));
    const speech = speechPath(capture, shape, from, to, place);
    this.body.setAttribute('d', speech.fill);
    this.contour.setAttribute('d', speech.stroke);
    this.pen.setAttribute('cx', String(round(place(last))));
    this.pen.setAttribute('cy', String(MID));
    this.pen.style.opacity = String(1 - amount);
    if (this.phase !== 'approved') return;
    this.check.setAttribute('d', `M${round(place(to) + 9)},${MID}l3.5,3.5l6.5,-7.5`);
    this.check.style.strokeDashoffset = String(1 - ease(checking));
  }
}

function noCapture(): null {
  return null;
}

function mount(
  ref: React.RefObject<SVGSVGElement | null>,
  animation: React.RefObject<TraceAnimation | null>,
): () => void {
  if (!ref.current) throw new Error('Waveform element is unavailable');
  const trace = new TraceAnimation(ref.current);
  animation.current = trace;
  return trace.stop;
}

function show(
  animation: React.RefObject<TraceAnimation | null>,
  capture: CaptureSource,
  phase: TracePhase,
): void {
  animation.current?.show(capture, phase);
}

export function Waveform({
  capture,
  phase,
}: {
  capture: CaptureSource;
  phase: TracePhase;
}): React.ReactNode {
  const ref = useRef<SVGSVGElement>(null);
  const animation = useRef<TraceAnimation | null>(null);
  useEffect(mount.bind(null, ref, animation), []);
  useEffect(show.bind(null, animation, capture, phase), [capture, phase]);
  return (
    <svg ref={ref} className="waveform" viewBox={`0 0 ${WIDTH} 64`} aria-hidden="true">
      <path className="trace-future" />
      <g className="trace-capture">
        <path className="trace-ripple" data-part="outside" />
        <path className="trace-ripple" data-part="ripple" />
        <path className="trace-body" />
        <path className="trace-contour" />
      </g>
      <path className="trace-check" pathLength={1} />
      <circle className="trace-pen" r={2.25} cy={MID} />
    </svg>
  );
}
