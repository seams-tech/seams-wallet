const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const BAR_COUNT = 45;

export function voiceDisplayLevel(rms: number): number {
  const signal = Math.max(0, rms - 0.003);
  return Math.pow(signal / (signal + 0.08), 0.7);
}

/** Presentation only. This observer never requests or stops microphone tracks. */
export class VoiceWaveform {
  readonly element: SVGSVGElement;
  private readonly bars: SVGRectElement[] = [];
  private readonly history = new Float32Array(BAR_COUNT);
  private frame = 0;
  private previousTime = 0;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples = new Float32Array(512);

  constructor(document: Document) {
    this.element = document.createElementNS(SVG_NAMESPACE, 'svg');
    this.element.classList.add('seams-voiceid-waveform');
    this.element.setAttribute('viewBox', '0 0 227 64');
    this.element.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < BAR_COUNT; index += 1) {
      const bar = document.createElementNS(SVG_NAMESPACE, 'rect');
      bar.setAttribute('x', String(index * 5 + 2));
      bar.setAttribute('width', '2.5');
      bar.setAttribute('rx', '1.25');
      bar.setAttribute('height', '56');
      bar.setAttribute('y', '4');
      this.element.appendChild(bar);
      this.bars.push(bar);
    }
    this.paint();
  }

  start(stream: MediaStream): void {
    this.stop();
    this.previousTime = 0;
    this.element.dataset.listening = 'true';
    try {
      const context = new AudioContext();
      this.context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = this.samples.length;
      context.createMediaStreamSource(stream).connect(analyser);
      this.analyser = analyser;
      void context.resume().catch(this.resumeFailed.bind(this, context));
      this.frame = requestAnimationFrame(this.draw);
    } catch {
      // Recording and verification remain available if the visual meter cannot start.
      this.stop();
    }
  }

  private resumeFailed(context: AudioContext): void {
    if (this.context === context) this.stop();
  }

  readonly stop = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.analyser = null;
    this.element.dataset.listening = 'false';
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(ignoreClosedContext);
    this.samples.fill(0);
    this.history.fill(0);
    this.paint();
  };

  private readonly draw = (time: number): void => {
    const analyser = this.analyser;
    if (!analyser) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const interval = reducedMotion ? 160 : 32;
    if (time - this.previousTime >= interval) {
      this.previousTime = time;
      analyser.getFloatTimeDomainData(this.samples);
      let energy = 0;
      for (const sample of this.samples) energy += sample * sample;
      const level = voiceDisplayLevel(Math.sqrt(energy / this.samples.length));
      if (reducedMotion) {
        this.history.fill(level * 0.25);
      } else {
        this.history.copyWithin(0, 1);
        this.history[BAR_COUNT - 1] = level;
      }
      this.paint();
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  private paint(): void {
    for (let index = 0; index < BAR_COUNT; index += 1) {
      const height = 4 + this.history[index] * 52;
      this.bars[index].style.transform = `scaleY(${height / 56})`;
    }
  }
}

function ignoreClosedContext(): void {}
